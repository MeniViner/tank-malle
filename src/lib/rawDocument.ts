import { Timestamp, runTransaction, type DocumentReference, type Firestore } from 'firebase/firestore';
import type { OutboxOpType, OutboxPayload } from './outbox';
import { FillupConflictError } from './writesConditional';

// This key is outside the private price-rule root whitelist. Every user map,
// including maps that look like codec tags, is represented by a tagged map node.
const ENVELOPE_KEY = '__tankMalehRawDocument';
const CODEC_VERSION = 1;
const MAX_DEPTH = 100;

/** Presence includes malformed envelopes: they must never fall back to legacy writes. */
export function hasRawDocumentEnvelope(value: unknown): value is OutboxPayload {
  return value !== null && typeof value === 'object' && Object.hasOwn(value, ENVELOPE_KEY);
}

type RawNode = null | boolean | string | number
  | { type: 'timestamp'; seconds: number; nanoseconds: number }
  | { type: 'number'; value: 'NaN' | 'Infinity' | '-Infinity' | '-0' }
  | { type: 'map'; entries: [string, RawNode][] }
  | { type: 'array'; values: RawNode[] };

function codecError(): Error & { code: string } {
  return Object.assign(new Error('לא ניתן לאמת את תמונת הרשומה השמורה — הפעולה נשמרה לבדיקה'), {
    code: 'raw-document-unverified',
  });
}

function isMap(value: unknown): value is OutboxPayload {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function keysAre(value: OutboxPayload, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isDenseArray(value: unknown[]): boolean {
  if (Object.keys(value).length !== value.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function encodeValue(value: unknown, ancestors: Set<object>, depth: number): RawNode {
  if (depth > MAX_DEPTH) throw codecError();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { type: 'number', value: 'NaN' };
    if (value === Infinity) return { type: 'number', value: 'Infinity' };
    if (value === -Infinity) return { type: 'number', value: '-Infinity' };
    if (Object.is(value, -0)) return { type: 'number', value: '-0' };
    return value;
  }
  if (value instanceof Timestamp) {
    if (!Number.isInteger(value.seconds) || !Number.isInteger(value.nanoseconds)) throw codecError();
    return { type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (!value || typeof value !== 'object' || ancestors.has(value)) throw codecError();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (!isDenseArray(value)) throw codecError();
      return { type: 'array', values: value.map(child => encodeValue(child, ancestors, depth + 1)) };
    }
    if (!isMap(value)) throw codecError();
    return { type: 'map', entries: Object.entries(value).map(([key, child]) => [key, encodeValue(child, ancestors, depth + 1)]) };
  } finally {
    ancestors.delete(value);
  }
}

function decodeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) throw codecError();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw codecError();
    return value;
  }
  if (!isMap(value)) throw codecError();
  if (value.type === 'timestamp' && keysAre(value, ['type', 'seconds', 'nanoseconds'])) {
    if (typeof value.seconds !== 'number' || typeof value.nanoseconds !== 'number' ||
        !Number.isInteger(value.seconds) || !Number.isInteger(value.nanoseconds)) throw codecError();
    try { return new Timestamp(value.seconds, value.nanoseconds); }
    catch { throw codecError(); }
  }
  if (value.type === 'number' && keysAre(value, ['type', 'value'])) {
    switch (value.value) {
      case 'NaN': return NaN;
      case 'Infinity': return Infinity;
      case '-Infinity': return -Infinity;
      case '-0': return -0;
      default: throw codecError();
    }
  }
  if (value.type === 'array' && keysAre(value, ['type', 'values']) && Array.isArray(value.values)) {
    if (!isDenseArray(value.values)) throw codecError();
    return value.values.map(child => decodeValue(child, depth + 1));
  }
  if (value.type === 'map' && keysAre(value, ['type', 'entries']) && Array.isArray(value.entries)) {
    if (!isDenseArray(value.entries)) throw codecError();
    const seen = new Set<string>();
    const entries = value.entries.map(entry => {
      if (!Array.isArray(entry) || !isDenseArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || seen.has(entry[0])) throw codecError();
      seen.add(entry[0]);
      return [entry[0], decodeValue(entry[1], depth + 1)] as const;
    });
    // fromEntries keeps __proto__ as an own data property instead of changing
    // the output's prototype.
    return Object.fromEntries(entries);
  }
  throw codecError();
}

/** Private outbox snapshot; no encoded field is ever sent directly to Firestore. */
export function encodeRawDocument(raw: OutboxPayload): OutboxPayload {
  if (!isMap(raw)) throw codecError();
  return { [ENVELOPE_KEY]: { version: CODEC_VERSION, document: encodeValue(raw, new Set(), 0) } };
}

function decodeLegacy(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) throw codecError();
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (value instanceof Timestamp) return new Timestamp(value.seconds, value.nanoseconds);
  if (Array.isArray(value)) {
    if (!isDenseArray(value)) throw codecError();
    return value.map(child => decodeLegacy(child, depth + 1));
  }
  if (!isMap(value)) throw codecError();
  // Older IndexedDB snapshots erased Timestamp prototypes. A bare map with
  // those fields is ambiguous: never guess that it is a Timestamp, or replay
  // a former Timestamp as a map. New encoded maps preserve this shape safely.
  if (Object.hasOwn(value, 'seconds') && Object.hasOwn(value, 'nanoseconds')) throw codecError();
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decodeLegacy(child, depth + 1)]));
}

/** Hydrate a typed snapshot, or read an unambiguous pre-codec plain document. */
export function decodeRawDocument(stored: OutboxPayload): OutboxPayload {
  if (!isMap(stored)) throw codecError();
  if (!Object.hasOwn(stored, ENVELOPE_KEY)) return decodeLegacy(stored, 0) as OutboxPayload;
  const envelope = stored[ENVELOPE_KEY];
  if (!keysAre(stored, [ENVELOPE_KEY]) || !isMap(envelope) || !keysAre(envelope, ['version', 'document']) ||
      envelope.version !== CODEC_VERSION) throw codecError();
  const decoded = decodeValue(envelope.document, 0);
  if (!isMap(decoded)) throw codecError();
  return decoded;
}

/** Exact actual data: Timestamp type, nanoseconds and absent keys all matter. */
export function rawDocumentMatches(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Timestamp || right instanceof Timestamp) {
    return left instanceof Timestamp && right instanceof Timestamp &&
      left.seconds === right.seconds && left.nanoseconds === right.nanoseconds;
  }
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && Object.is(left.getTime(), right.getTime());
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  } else if (!isMap(left) || !isMap(right)) return false;
  const a = left as OutboxPayload, b = right as OutboxPayload;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && rawDocumentMatches(a[key], b[key]));
}

/** Invalid/ambiguous snapshots cannot establish equality during reconciliation. */
export function storedRawDocumentMatches(stored: OutboxPayload, actual: OutboxPayload): boolean {
  try { return rawDocumentMatches(decodeRawDocument(stored), actual); }
  catch { return false; }
}

export function assertMutationScope(stillCurrent: () => boolean): void {
  if (!stillCurrent()) throw Object.assign(new Error('הרכב או החשבון התחלפו — הפעולה נשמרה לבדיקה'), { code: 'scope-changed' });
}

/** Private, exact-image writes. An offline transaction retains its journal input. */
export async function conditionalRawWrite(
  db: Firestore,
  ref: DocumentReference,
  opType: OutboxOpType,
  payload: OutboxPayload | null,
  before: OutboxPayload | null,
  stillCurrent: () => boolean,
): Promise<void> {
  assertMutationScope(stillCurrent);
  const hydratedPayload = payload === null ? null : decodeRawDocument(payload);
  const hydratedBefore = before === null ? null : decodeRawDocument(before);
  return runTransaction(db, async transaction => {
    assertMutationScope(stillCurrent);
    const snapshot = await transaction.get(ref);
    assertMutationScope(stillCurrent);
    const server = snapshot.exists() ? snapshot.data() : null;
    const conflict = () => new FillupConflictError(server === null ? null : encodeRawDocument(server));
    if (opType === 'delete') {
      if (!server) return;
      if (!hydratedBefore || !rawDocumentMatches(hydratedBefore, server)) throw conflict();
      transaction.delete(ref);
      return;
    }
    if (!hydratedPayload) throw new Error('missing private document payload');
    if (server && rawDocumentMatches(hydratedPayload, server)) return;
    if (server ? !hydratedBefore || !rawDocumentMatches(hydratedBefore, server) : hydratedBefore !== null || opType === 'update') {
      throw conflict();
    }
    transaction.set(ref, hydratedPayload);
  });
}
