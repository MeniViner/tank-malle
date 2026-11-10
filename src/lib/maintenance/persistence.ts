import { deleteField, runTransaction, type DocumentReference, type FieldValue, type Firestore } from 'firebase/firestore';
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
/**
 * Care payloads are complete records, but optional fields (`excluded` on an
 * expense) are omitted rather than written as false. An update merges, so a
 * field present in the stored image and absent from the new payload must be
 * removed explicitly — otherwise switching an expense back to "included" would
 * leave `excluded: true` on the server.
 */
/** Optional record fields that are written only when true (see normalizeCareRecord). Merge semantics are unchanged for everything else. */
const OMITTED_WHEN_FALSE = ['excluded'] as const;
export function careReplacementPatch(payload: OutboxPayload, stored: OutboxPayload | null): Record<string, unknown | FieldValue> {
  const patch: Record<string, unknown | FieldValue> = { ...payload };
  for (const key of OMITTED_WHEN_FALSE) if (stored && Object.hasOwn(stored, key) && !Object.hasOwn(payload, key)) patch[key] = deleteField();
  return patch;
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
      transaction.update(ref,careReplacementPatch(payload,server));
    } else {
      if (server) throw new FillupConflictError(server);
      transaction.set(ref,payload);
    }
  });
}
