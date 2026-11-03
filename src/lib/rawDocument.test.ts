import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, type DocumentReference, type Firestore } from 'firebase/firestore';
import { Outbox, type OutboxPayload } from './outbox';
import { FillupConflictError } from './writesConditional';
import {
  conditionalRawWrite,
  decodeRawDocument,
  encodeRawDocument,
  rawDocumentMatches,
  storedRawDocumentMatches,
} from './rawDocument';

const sdk = vi.hoisted(() => ({ runTransaction: vi.fn() }));
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  runTransaction: sdk.runTransaction,
}));

const PATH = 'users/alice/personalPriceRules/rule1';
const REF = { path: PATH } as DocumentReference;
const DB = {} as Firestore;
let databaseId = 0;

function environment() {
  databaseId += 1;
  return { indexedDB: new IDBFactory(), dbName: `raw-document-${databaseId}`, storage: null, channel: null };
}

async function roundTrip(payload: OutboxPayload, beforeImage: OutboxPayload | null = null) {
  const env = environment();
  const box = await Outbox.open('alice', 'test', env);
  const operation = await box.enqueue({ kind: 'priceRule.save', path: PATH, vehicleId: 'v1', payload, beforeImage });
  box.close();
  const reopened = await Outbox.open('alice', 'test', env);
  try {
    const stored = await reopened.get(operation.opId);
    if (!stored) throw new Error('The real Outbox lost its operation');
    return stored;
  } finally {
    reopened.close();
  }
}

function transactionWith(server: OutboxPayload | null, afterRead: () => void = () => {}) {
  const transaction = {
    get: vi.fn(async () => {
      afterRead();
      return { exists: () => server !== null, data: () => server };
    }),
    set: vi.fn(),
    delete: vi.fn(),
  };
  sdk.runTransaction.mockImplementation(async (_db, write) => write(transaction));
  return transaction;
}

beforeEach(() => { sdk.runTransaction.mockReset(); });

describe('raw private snapshot codec', () => {
  it('preserves exact typed timestamps and field presence through Outbox close/reopen', async () => {
    const timestamp = new Timestamp(1_700_000_000, 123_456_789);
    const raw = { discountPerLiter: 0.123456789, migratedAt: timestamp, expiresAt: null };
    const stored = await roundTrip(encodeRawDocument(raw), encodeRawDocument(raw));
    const decoded = decodeRawDocument(stored.payload!);

    expect(decoded.migratedAt).toBeInstanceOf(Timestamp);
    expect((decoded.migratedAt as Timestamp).seconds).toBe(timestamp.seconds);
    expect((decoded.migratedAt as Timestamp).nanoseconds).toBe(timestamp.nanoseconds);
    expect(storedRawDocumentMatches(stored.payload!, raw)).toBe(true);
    expect(storedRawDocumentMatches(stored.beforeImage!, raw)).toBe(true);
    expect(storedRawDocumentMatches(stored.payload!, { ...raw, migratedAt: new Timestamp(timestamp.seconds, timestamp.nanoseconds + 1) })).toBe(false);
    expect(storedRawDocumentMatches(stored.payload!, { discountPerLiter: raw.discountPerLiter, migratedAt: timestamp })).toBe(false);
  });

  it('never aliases an encoded Timestamp and an encoded plain map', async () => {
    const timestamp = new Timestamp(100, 123_456_000);
    const map = { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds };
    const timestampOp = await roundTrip(encodeRawDocument({ migratedAt: timestamp }));
    const mapOp = await roundTrip(encodeRawDocument({ migratedAt: map }));

    expect(storedRawDocumentMatches(timestampOp.payload!, { migratedAt: map })).toBe(false);
    expect(storedRawDocumentMatches(mapOp.payload!, { migratedAt: timestamp })).toBe(false);
    expect(storedRawDocumentMatches(mapOp.payload!, { migratedAt: map })).toBe(true);
    expect(decodeRawDocument(mapOp.payload!).migratedAt).not.toBeInstanceOf(Timestamp);
  });

  it('escapes timestamp tags, outer-envelope lookalikes and special map keys', async () => {
    const raw = {
      __tankMalehRawDocument: { version: 1, document: { type: 'timestamp', seconds: 4, nanoseconds: 5 } },
      migratedAt: { type: 'timestamp', seconds: 7, nanoseconds: 8 },
      nested: [Object.fromEntries([['__proto__', { safe: true }], ['constructor', 'ordinary data']])],
    };
    const stored = await roundTrip(encodeRawDocument(raw));
    const decoded = decodeRawDocument(stored.payload!);

    expect(rawDocumentMatches(decoded, raw)).toBe(true);
    expect(decoded.migratedAt).not.toBeInstanceOf(Timestamp);
    const special = (decoded.nested as OutboxPayload[])[0];
    expect(Object.hasOwn(special, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(special)).toBe(Object.prototype);
  });

  it('also preserves encoded timestamps and exceptional numeric values through JSON', () => {
    const raw = { stamp: new Timestamp(-1, 999_999_999), values: [NaN, Infinity, -Infinity, -0, 0] };
    const transported = JSON.parse(JSON.stringify(encodeRawDocument(raw))) as OutboxPayload;
    expect(rawDocumentMatches(decodeRawDocument(transported), raw)).toBe(true);
  });

  it('accepts legacy scalar rule documents without adding missing fields', async () => {
    const raw = { vehicleId: 'v1', discountPerLiter: 0.31, fixedPricePerLiter: null, reviewed: true, legacy: false };
    const stored = await roundTrip(raw);
    expect(decodeRawDocument(stored.payload!)).toEqual(raw);
    expect(Object.hasOwn(decodeRawDocument(stored.payload!), 'migratedAt')).toBe(false);
    expect(storedRawDocumentMatches(stored.payload!, raw)).toBe(true);
  });

  it('fails closed on pre-codec Timestamp data whose prototype was lost in IndexedDB', async () => {
    const raw = { discountPerLiter: 0.2, migratedAt: new Timestamp(99, 123_456_789) };
    const stored = await roundTrip(raw);
    expect(stored.payload!.migratedAt).not.toBeInstanceOf(Timestamp);
    expect(() => decodeRawDocument(stored.payload!)).toThrow();
    expect(storedRawDocumentMatches(stored.payload!, raw)).toBe(false);
    await expect(conditionalRawWrite(DB, REF, 'set', stored.payload, null, () => true))
      .rejects.toMatchObject({ code: 'raw-document-unverified' });
    expect(sdk.runTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { __tankMalehRawDocument: { version: 2, document: { type: 'map', entries: [] } } },
    { __tankMalehRawDocument: { version: 1, document: { type: 'map', entries: [] } }, extra: true },
    { __tankMalehRawDocument: { version: 1, document: { type: 'map', entries: [['x', 1], ['x', 2]] } } },
    { __tankMalehRawDocument: { version: 1, document: { type: 'timestamp', seconds: 1, nanoseconds: 0 } } },
    { __tankMalehRawDocument: { version: 1, document: { type: 'map', entries: [['x', { type: 'timestamp', seconds: 1, nanoseconds: 1_000_000_000 }]] } } },
  ])('rejects malformed or unknown envelopes without legacy reinterpretation: %j', stored => {
    expect(() => decodeRawDocument(stored)).toThrow();
    expect(storedRawDocumentMatches(stored, {})).toBe(false);
  });

  it('does not erase unsupported values or circular input while encoding', () => {
    const circular: OutboxPayload = {};
    circular.self = circular;
    expect(() => encodeRawDocument({ missing: undefined })).toThrow();
    expect(() => encodeRawDocument({ value: new Map([['a', 1]]) })).toThrow();
    expect(() => encodeRawDocument(circular)).toThrow();
  });
});

describe('strict actual document comparison', () => {
  it('distinguishes absent, null, undefined, timestamp types and complete array contents', () => {
    expect(rawDocumentMatches({}, { migratedAt: null })).toBe(false);
    expect(rawDocumentMatches({}, { migratedAt: undefined })).toBe(false);
    expect(rawDocumentMatches({ migratedAt: null }, { migratedAt: undefined })).toBe(false);
    expect(rawDocumentMatches(new Timestamp(1, 2), { seconds: 1, nanoseconds: 2 })).toBe(false);
    expect(rawDocumentMatches({ values: [1] }, { values: [1, 2] })).toBe(false);
    expect(rawDocumentMatches({ values: [1, null] }, { values: [1, null] })).toBe(true);
    expect(rawDocumentMatches({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(rawDocumentMatches({ x: -0 }, { x: 0 })).toBe(false);
  });
});

describe('conditional raw writes', () => {
  it('hydrates an encoded Outbox payload before handing it to the SDK', async () => {
    const raw = { discountPerLiter: 0.4, migratedAt: new Timestamp(100, 123_456_000) };
    const stored = await roundTrip(encodeRawDocument(raw));
    const transaction = transactionWith(null);

    await conditionalRawWrite(DB, REF, 'set', stored.payload, null, () => true);
    expect(transaction.set).toHaveBeenCalledOnce();
    const outgoing = transaction.set.mock.calls[0][1] as OutboxPayload;
    expect(rawDocumentMatches(outgoing, raw)).toBe(true);
    expect(outgoing.migratedAt).toBeInstanceOf(Timestamp);
    expect(Object.hasOwn(outgoing, '__tankMalehRawDocument')).toBe(false);
  });

  it('replaces only an exact hydrated base and preserves the typed unchanged timestamp', async () => {
    const before = { discountPerLiter: 0.2, migratedAt: new Timestamp(100, 123_456_000) };
    const after = { ...before, discountPerLiter: 0.5 };
    const stored = await roundTrip(encodeRawDocument(after), encodeRawDocument(before));
    const transaction = transactionWith(before);

    await conditionalRawWrite(DB, REF, 'set', stored.payload, stored.beforeImage, () => true);
    expect(rawDocumentMatches(transaction.set.mock.calls[0][1], after)).toBe(true);
  });

  it('recognizes an already-applied exact payload without writing again', async () => {
    const raw = { discountPerLiter: 0.2, migratedAt: new Timestamp(1, 222_333_000) };
    const stored = await roundTrip(encodeRawDocument(raw));
    const transaction = transactionWith(raw);
    await conditionalRawWrite(DB, REF, 'set', stored.payload, null, () => true);
    expect(transaction.set).not.toHaveBeenCalled();
    expect(transaction.delete).not.toHaveBeenCalled();
  });

  it('stores an encoded conflict image that survives Outbox conflict/rebase/reload', async () => {
    const env = environment();
    const box = await Outbox.open('alice', 'test', env);
    const before = { discountPerLiter: 0.2, migratedAt: new Timestamp(100, 123_456_000) };
    const after = { ...before, discountPerLiter: 0.5 };
    const server = { ...before, migratedAt: new Timestamp(100, 123_457_000) };
    const op = await box.enqueue({ kind: 'priceRule.save', path: PATH, vehicleId: 'v1', payload: encodeRawDocument(after), beforeImage: encodeRawDocument(before) });
    const transaction = transactionWith(server);
    const conflict = await conditionalRawWrite(DB, REF, 'set', op.payload, op.beforeImage, () => true).catch(error => error);

    expect(conflict).toBeInstanceOf(FillupConflictError);
    expect(storedRawDocumentMatches(conflict.serverImage, server)).toBe(true);
    expect(transaction.set).not.toHaveBeenCalled();
    await box.markConflict(op.opId, op.version, conflict.serverImage);
    box.close();
    const reopened = await Outbox.open('alice', 'test', env);
    try {
      const saved = (await reopened.get(op.opId))!;
      expect(storedRawDocumentMatches(saved.serverImage!, server)).toBe(true);
      const rebased = (await reopened.rebase(op.opId, saved.serverImage!, {}))!;
      const current = await reopened.get(rebased.opId);
      expect(storedRawDocumentMatches(current!.beforeImage!, server)).toBe(true);
      expect(decodeRawDocument(current!.beforeImage!).migratedAt).toBeInstanceOf(Timestamp);
    } finally {
      reopened.close();
    }
  });

  it('does not confuse a server map with the Timestamp in an encoded before-image', async () => {
    const before = { discountPerLiter: 0.2, migratedAt: new Timestamp(1, 222_333_000) };
    const transaction = transactionWith({ ...before, migratedAt: { seconds: 1, nanoseconds: 222_333_000 } });
    await expect(conditionalRawWrite(DB, REF, 'delete', null, encodeRawDocument(before), () => true))
      .rejects.toBeInstanceOf(FillupConflictError);
    expect(transaction.delete).not.toHaveBeenCalled();
  });

  it('deletes an exact base, and an absent delete stays idempotent', async () => {
    const before = { discountPerLiter: 0.2, migratedAt: new Timestamp(1, 222_333_000) };
    const transaction = transactionWith(before);
    await conditionalRawWrite(DB, REF, 'delete', null, encodeRawDocument(before), () => true);
    expect(transaction.delete).toHaveBeenCalledWith(REF);
    const absent = transactionWith(null);
    await conditionalRawWrite(DB, REF, 'delete', null, encodeRawDocument(before), () => true);
    expect(absent.delete).not.toHaveBeenCalled();
  });

  it('refuses a missing replacement base and preserves scope checks after the read', async () => {
    const raw = { discountPerLiter: 0.2 };
    transactionWith(null);
    await expect(conditionalRawWrite(DB, REF, 'set', encodeRawDocument(raw), encodeRawDocument(raw), () => true))
      .rejects.toMatchObject({ serverImage: null });
    let current = true;
    const transaction = transactionWith(null, () => { current = false; });
    await expect(conditionalRawWrite(DB, REF, 'set', encodeRawDocument(raw), null, () => current))
      .rejects.toMatchObject({ code: 'scope-changed' });
    expect(transaction.set).not.toHaveBeenCalled();
  });
});
