import { runTransaction, type DocumentReference, type Firestore } from 'firebase/firestore';
import { FillupConflictError } from '../writesConditional';
import type { OutboxOpType, OutboxPayload } from '../outbox';

/** Full record equality, including array length. An extra job is a real change. */
export function carePayloadMatches(a: OutboxPayload, b: OutboxPayload): boolean {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
    return JSON.stringify(value);
  };
  return canonical(a) === canonical(b);
}
/** Deletes/retries use a server transaction. Offline failures retain the complete journal entry for explicit retry. */
export function conditionalCareWrite(db: Firestore, ref: DocumentReference, type: OutboxOpType, payload: OutboxPayload | null, before: OutboxPayload | null): Promise<void> {
  return runTransaction(db,async transaction=>{
    const snap=await transaction.get(ref); const server=snap.exists()?snap.data():null;
    if (type==='delete') {
      if (!server) return;
      if (!before || !carePayloadMatches(before,server)) throw new FillupConflictError(server);
      transaction.delete(ref); return;
    }
    if (!payload) throw new Error('missing care payload');
    if (server && carePayloadMatches(payload,server)) return;
    if (type==='update') {
      if (!server || !before || !carePayloadMatches(before,server)) throw new FillupConflictError(server);
      transaction.update(ref,payload);
    } else {
      if (server) throw new FillupConflictError(server);
      transaction.set(ref,payload);
    }
  });
}
