import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeoPoint, Timestamp, type Firestore } from 'firebase/firestore';
import { Outbox, type OutboxOperation, type OutboxPayload } from './outbox';
import { decodeRawDocument, encodeRawDocument, rawDocumentMatches } from './rawDocument';
import { captureVehicleDocumentImages, createVehicleDocumentCapture, readVehicleDocumentCapture,
  vehicleDocumentIntent, isVehicleDocumentOperation, writeVehicleDocumentOperation, reconcileVehicleDocumentOperation,
  canRebaseVehicleDocumentOperation, rebaseVehicleDocumentOperation, vehicleDocumentDisplay } from './vehicleDocumentPersistence';
import { vehicleSelectionBase, vehicleSelectionIntent, isVehicleSelectionOperation, writeVehicleSelectionOperation,
  reconcileVehicleSelectionOperation, vehicleSelectionDisplay } from './vehicleSelection';
import { presentOutboxOperation, outboxDifferences, outboxFieldText } from './outboxPresentation';
import type { Vehicle } from './types';
import type { VehicleDocKey, VehicleDocumentSnapshot } from './vehicle/documents';

const sdk = vi.hoisted(() => ({ data: new Map<string, Record<string, unknown>>(), writes: [] as { path: string; patch: Record<string, unknown> }[],
  pendingPaths: new Set<string>(), afterRead: null as ((path: string) => Promise<void>) | null, barrier: Promise.resolve(), serverGate: Promise.resolve() }));
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  const snap = (data: Record<string, unknown> | undefined, path: string) => ({ exists: () => data !== undefined, data: () => data,
    metadata: { fromCache: false, hasPendingWrites: sdk.pendingPaths.has(path) } });
  const patched = (raw: Record<string, unknown>, patch: Record<string, unknown>) => {
    const next = { ...raw };
    for (const [key, value] of Object.entries(patch)) {
      const [parent, leaf] = key.split('.');
      if (leaf) next[parent] = { ...(next[parent] as Record<string, unknown> ?? {}), [leaf]: value };
      else next[parent] = value;
    }
    return next;
  };
  return { ...actual, doc: (_db: unknown, path: string) => ({ path }),
    waitForPendingWrites: async () => { await sdk.barrier; },
    getDocFromServer: async (ref: { path: string }) => { const result = snap(sdk.data.get(ref.path), ref.path); await sdk.serverGate; return result; },
    runTransaction: async (_db: unknown, body: (transaction: unknown) => Promise<unknown>) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map<string, Record<string, unknown> | undefined>();
        const writes: { path: string; patch: Record<string, unknown> }[] = [];
        const result = await body({
          get: async (ref: { path: string }) => { const raw = sdk.data.get(ref.path); reads.set(ref.path, raw); await sdk.afterRead?.(ref.path); return snap(raw, ref.path); },
          update: (ref: { path: string }, patch: Record<string, unknown>) => { writes.push({ path: ref.path, patch }); },
        });
        if ([...reads].some(([path, raw]) => sdk.data.get(path) !== raw)) continue;
        for (const write of writes) { sdk.writes.push(write); sdk.data.set(write.path, patched(sdk.data.get(write.path)!, write.patch)); }
        return result;
      }
      throw new Error('transaction retry limit');
    },
  };
});
const db = {} as Firestore, profilePath = 'users/alice', path = `${profilePath}/vehicles/car`;
const current = () => true;
const boxes: Outbox[] = [];
const defaultDocs = () => ({ mandatory: { due: '2026-12-01', cost: 123.456789, insurer: 'א', future: { zero: 0, nullable: null } } });
const rawVehicle = <T = ReturnType<typeof defaultDocs>>(docs: T = defaultDocs() as T) => ({
  make: 'Toyota', model: 'Yaris', fuelType: '95', createdAt: new Timestamp(1700000000, 123456789), docs,
});
const profile = () => ({ createdAt: new Timestamp(1600000000, 987654321), settings: { activeVehicleId: null, theme: 'dark', future: { x: 7 } } });
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function open() {
  const options = { indexedDB: new IDBFactory(), storage: null, channel: null };
  const outbox = await Outbox.open('alice', 'test', options); boxes.push(outbox); return { outbox, options };
}
async function documentWrite(outbox: Outbox, raw = rawVehicle() as OutboxPayload, key: VehicleDocKey = 'mandatory', changes: OutboxPayload = { due: '2027-01-02' }) {
  return outbox.enqueue({ kind: 'vehicle.update', path, vehicleId: 'car', opType: 'update',
    payload: vehicleDocumentIntent(key, changes), beforeImage: captureVehicleDocumentImages(raw)[key]! });
}
async function selectionWrite(outbox: Outbox, raw = profile() as OutboxPayload, sourceId: string | null = null, targetId: string | null = 'car') {
  return outbox.enqueue({ kind: 'settings.update', path: profilePath, vehicleId: null, opType: 'update',
    payload: vehicleSelectionIntent(targetId ? { vehicleId: targetId, raw: sdk.data.get(`${profilePath}/vehicles/${targetId}`)! } : null, sourceId),
    beforeImage: vehicleSelectionBase(raw) });
}
beforeEach(() => { sdk.data.clear(); sdk.data.set(path, rawVehicle()); sdk.data.set(profilePath, profile()); sdk.writes = [];
  sdk.pendingPaths.clear(); sdk.afterRead = null; sdk.barrier = Promise.resolve(); sdk.serverGate = Promise.resolve(); });
afterEach(() => { boxes.splice(0).forEach(outbox => outbox.close()); vi.restoreAllMocks(); });

describe('opaque document opening capture', () => {
  it('binds the exact rendered object and original lifetime but survives unrelated later renders', () => {
    const raw = rawVehicle(), record = { id: 'car', ...raw } as unknown as Vehicle;
    let live = true;
    const capture = createVehicleDocumentCapture({ records: [record], images: new Map([['car', captureVehicleDocumentImages(raw)]]), pendingIds: new Set(), vehicleId: 'car' }, () => live);
    expect(capture({ ...record }, 'mandatory')).toBeNull();
    const token = capture(record, 'mandatory')!;
    expect(readVehicleDocumentCapture(token, 'car', 'mandatory').beforeImage).toBeTruthy();
    const replacement = { ...record };
    expect(createVehicleDocumentCapture({ records: [replacement], images: new Map(), pendingIds: new Set(), vehicleId: 'car' }, () => live)(replacement, 'mandatory')).toBeNull();
    expect(readVehicleDocumentCapture(token, 'car', 'mandatory').beforeImage).toBeTruthy();
    expect(() => readVehicleDocumentCapture({ ...token } as VehicleDocumentSnapshot<'mandatory'>, 'car', 'mandatory')).toThrow();
    live = false;
    expect(() => readVehicleDocumentCapture(token, 'car', 'mandatory')).toThrow();
  });
  it('isolates key captures and refuses unsupported selected values or pending rows', () => {
    const raw = rawVehicle({ mandatory: { due: '2026-12-01' }, coverage: new GeoPoint(1, 2), future: new GeoPoint(3, 4) });
    const images = captureVehicleDocumentImages(raw);
    expect(images.mandatory).toBeTruthy(); expect(images.coverage).toBeUndefined();
    const record = { id: 'car', ...raw } as unknown as Vehicle;
    expect(createVehicleDocumentCapture({ records: [record], images: new Map([['car', images]]), pendingIds: new Set(['car']), vehicleId: 'car' }, current)(record, 'mandatory')).toBeNull();
    expect(captureVehicleDocumentImages(rawVehicle({ mandatory: { future: new GeoPoint(1, 2) } })).mandatory).toBeUndefined();
  });
});

describe('selected document conditional writes', () => {
  it('preserves unknown siblings, selected children, Timestamp precision and decimal cost through reload', async () => {
    const { outbox, options } = await open(); const raw = rawVehicle();
    const operation = await documentWrite(outbox, raw);
    const concurrent = { ...raw, nickname: 'נוסף', docs: { ...raw.docs, test: { due: '2027-03-01', raw: new GeoPoint(1, 2) }, future: new GeoPoint(3, 4) } };
    sdk.data.set(path, concurrent); outbox.close();
    const reopened = await Outbox.open('alice', 'test', options); boxes.push(reopened);
    await writeVehicleDocumentOperation(db, reopened, (await reopened.get(operation.opId))!, current);
    expect(sdk.writes[0].patch).toEqual({ 'docs.mandatory': { ...raw.docs.mandatory, due: '2027-01-02' } });
    const stored = sdk.data.get(path)!;
    expect(stored.createdAt).toBe(raw.createdAt); expect(stored.nickname).toBe('נוסף');
    expect((stored.docs as typeof concurrent.docs).future).toBe(concurrent.docs.future);
    expect((stored.docs as typeof concurrent.docs).mandatory.cost).toBe(123.456789);
    expect(await reopened.list()).toEqual([]);
  });
  it.each(['missing', 'null', 'child-null'] as const)('keeps %s emptiness exact until an explicit authoring action', async kind => {
    const { outbox } = await open();
    const raw: OutboxPayload = rawVehicle(kind === 'null' ? null : kind === 'child-null' ? { mandatory: null } : {});
    if (kind === 'missing') delete raw.docs;
    sdk.data.set(path, raw);
    const operation = await documentWrite(outbox, raw, 'mandatory', { cost: 0 });
    await writeVehicleDocumentOperation(db, outbox, operation, current);
    expect(sdk.writes[0].patch).toEqual({ 'docs.mandatory': { cost: 0 } });
    expect(decodeRawDocument(operation.beforeImage!).container).toBe(kind === 'null' ? 'null' : kind === 'missing' ? 'missing' : 'map');
  });
  it('allows independent document operations on the same vehicle', async () => {
    const { outbox } = await open(), raw = rawVehicle();
    const first = await documentWrite(outbox, raw), other = await documentWrite(outbox, raw, 'test', { due: '2028-01-02' });
    await writeVehicleDocumentOperation(db, outbox, first, current);
    await writeVehicleDocumentOperation(db, outbox, other, current);
    expect(sdk.writes).toHaveLength(2); expect(await outbox.list()).toEqual([]);
  });
  it.each(['selected-change', 'missing-null', 'parent-identity', 'deleting', 'absent'] as const)('refuses %s and keeps authored payload/base intact', async change => {
    const { outbox } = await open(), raw = rawVehicle(); const operation = await documentWrite(outbox, raw);
    const beforeBytes = JSON.stringify(operation.beforeImage), payloadBytes = JSON.stringify(operation.payload);
    if (change === 'absent') sdk.data.delete(path);
    else if (change === 'deleting') sdk.data.set(path, { ...raw, deletionPending: true });
    else if (change === 'parent-identity') sdk.data.set(path, { ...raw, createdAt: new Timestamp(raw.createdAt.seconds, raw.createdAt.nanoseconds + 1) });
    else sdk.data.set(path, { ...raw, docs: { mandatory: change === 'missing-null' ? null : { ...raw.docs.mandatory, cost: 123.456788 } } });
    await expect(writeVehicleDocumentOperation(db, outbox, operation, current)).rejects.toMatchObject({ code: 'conflict' });
    const kept = (await outbox.get(operation.opId))!;
    expect(JSON.stringify(kept.beforeImage)).toBe(beforeBytes); expect(JSON.stringify(kept.payload)).toBe(payloadBytes); expect(sdk.writes).toEqual([]);
  });
  it('does not mistake desired known values plus a new unknown child for an already-applied target', async () => {
    const { outbox } = await open(), raw = rawVehicle(); const operation = await documentWrite(outbox, raw);
    sdk.data.set(path, { ...raw, docs: { mandatory: { ...raw.docs.mandatory, due: '2027-01-02', futureAdded: 3 } } });
    expect(await reconcileVehicleDocumentOperation(db, outbox, operation, current)).toBe(true);
    const conflict = (await outbox.get(operation.opId))!;
    expect(conflict.status).toBe('conflict'); expect(canRebaseVehicleDocumentOperation(conflict)).toBe(true);
    expect(vehicleDocumentDisplay(conflict).mine.futureAdded).toBe(3);
  });
  it('rechecks the actual attempt after both a transaction read and awaited neighbor inspection', async () => {
    const { outbox } = await open(); const operation = await documentWrite(outbox);
    sdk.afterRead = async () => { await outbox.markConflict(operation.opId, operation.version, operation.beforeImage); };
    await expect(writeVehicleDocumentOperation(db, outbox, operation, current)).rejects.toMatchObject({ code: 'vehicle-operation-changed' });
    expect(sdk.writes).toEqual([]);
  });
  it('invalidates account/vehicle ABA before SDK mutation without discarding the operation', async () => {
    const { outbox } = await open(), barrier = gate(); const operation = await documentWrite(outbox); sdk.barrier = barrier.promise;
    let live = true; const running = writeVehicleDocumentOperation(db, outbox, operation, () => live);
    live = false; barrier.resolve(); await expect(running).rejects.toThrow(); expect(sdk.writes).toEqual([]);
    expect(await outbox.get(operation.opId)).not.toBeNull();
  });
  it('reconciles only fixed target equality and leaves newer journal attempts untouched', async () => {
    const { outbox } = await open(), raw = rawVehicle(), read = gate(); const operation = await documentWrite(outbox, raw);
    sdk.data.set(path, { ...raw, docs: { mandatory: { ...raw.docs.mandatory, due: '2027-01-02' } } });
    sdk.serverGate = read.promise;
    const running = reconcileVehicleDocumentOperation(db, outbox, operation, current);
    await outbox.fail(operation.opId, operation.version, { code: 'offline', message: '', at: 1 });
    const newer = await outbox.claimRetry(operation.opId); read.resolve(); await running;
    expect((await outbox.get(operation.opId))?.version).toBe(newer!.version);
    sdk.serverGate = Promise.resolve();
    expect(await reconcileVehicleDocumentOperation(db, outbox, newer!, current)).toBe(true); expect(await outbox.get(operation.opId)).toBeNull();
  });
});

describe('field-only automatic selection', () => {
  it('selects this account even when an inactive account keeps the SDK-wide barrier pending', async () => {
    const { outbox } = await open(); const operation = await selectionWrite(outbox);
    sdk.barrier = new Promise<void>(() => {});
    await writeVehicleSelectionOperation(db, outbox, operation, current);
    expect((sdk.data.get(profilePath)!.settings as Record<string, unknown>).activeVehicleId).toBe('car');
    expect(await outbox.list()).toEqual([]);
  });
  it.each([profilePath, path])('retains selection without writing when %s has a pending local overlay', async pendingPath => {
    const { outbox } = await open(); const operation = await selectionWrite(outbox);
    sdk.pendingPaths.add(pendingPath);
    await expect(writeVehicleSelectionOperation(db, outbox, operation, current)).rejects.toMatchObject({ code: 'vehicle-selection-pending' });
    expect(sdk.writes).toEqual([]); expect(await outbox.get(operation.opId)).not.toBeNull();
  });
  it('reconciles this account without awaiting an inactive account batch', async () => {
    const { outbox } = await open(); const operation = await selectionWrite(outbox);
    sdk.barrier = new Promise<void>(() => {});
    sdk.data.set(profilePath, { ...profile(), settings: { activeVehicleId: 'car' } });
    expect(await reconcileVehicleSelectionOperation(db, outbox, operation, current)).toBe(true);
    expect(await outbox.get(operation.opId)).toBeNull();
  });
  it('does not replace an eligible explicit choice when a cached empty catalog suggests first creation', async () => {
    const { outbox } = await open();
    // The wizard can open before the vehicle listener has populated its cache.
    // Its verified raw preference still names B, which must guard the new intent.
    const raw = { ...profile(), settings: { activeVehicleId: 'existing-b', theme: 'dark' } };
    sdk.data.set(profilePath, raw); sdk.data.set(`${profilePath}/vehicles/existing-b`, rawVehicle());
    const operation = await selectionWrite(outbox, raw, 'existing-b');
    await expect(writeVehicleSelectionOperation(db, outbox, operation, current)).rejects.toMatchObject({ code: 'vehicle-selection-obsolete' });
    expect(sdk.data.get(profilePath)).toEqual(raw); expect(sdk.writes).toEqual([]);
  });
  it('preserves every other setting and raw account timestamp', async () => {
    const { outbox } = await open(), raw = profile(); const operation = await selectionWrite(outbox, raw);
    const other = { ...raw, settings: { ...raw.settings, theme: 'light', future: { precise: 1.23456789 } } }; sdk.data.set(profilePath, other);
    await writeVehicleSelectionOperation(db, outbox, operation, current);
    expect(sdk.writes).toEqual([{ path: profilePath, patch: { 'settings.activeVehicleId': 'car' } }]);
    expect(sdk.data.get(profilePath)).toEqual({ ...other, settings: { ...other.settings, activeVehicleId: 'car' } });
    expect(await outbox.list()).toEqual([]);
  });
  it.each(['missing', 'archived', 'deleting', 'replaced'] as const)('blocks a %s target', async state => {
    const { outbox } = await open(); const operation = await selectionWrite(outbox);
    if (state === 'missing') sdk.data.delete(path);
    else sdk.data.set(path, { ...rawVehicle(), ...(state === 'archived' ? { archived: true } : state === 'deleting' ? { deletionPending: true } : { createdAt: new Timestamp(1, 1) }) });
    await expect(writeVehicleSelectionOperation(db, outbox, operation, current)).rejects.toMatchObject({ code: 'vehicle-selection-target' });
    expect(sdk.writes).toEqual([]); expect((await outbox.get(operation.opId))?.payload).toEqual(operation.payload);
  });
  it('refuses a newer preference and a restored source after an archive/delete ACK', async () => {
    const { outbox } = await open(), raw = { ...profile(), settings: { ...profile().settings, activeVehicleId: 'old' } };
    sdk.data.set(profilePath, raw); sdk.data.set(`${profilePath}/vehicles/old`, { ...rawVehicle(), archived: true });
    const operation = await selectionWrite(outbox, raw, 'old');
    sdk.data.set(profilePath, { ...raw, settings: { ...raw.settings, activeVehicleId: 'newer' } });
    await expect(writeVehicleSelectionOperation(db, outbox, operation, current)).rejects.toMatchObject({ code: 'conflict' });
    sdk.data.set(profilePath, raw); sdk.data.set(`${profilePath}/vehicles/old`, rawVehicle());
    await expect(writeVehicleSelectionOperation(db, outbox, operation, current)).rejects.toMatchObject({ code: 'vehicle-selection-obsolete' });
    expect(sdk.writes).toEqual([]);
  });
  it('rechecks source/target reads atomically when a source becomes available before commit', async () => {
    const { outbox } = await open(), raw = { ...profile(), settings: { activeVehicleId: 'old' } };
    sdk.data.set(profilePath, raw); const oldPath = `${profilePath}/vehicles/old`;
    sdk.data.set(oldPath, { ...rawVehicle(), archived: true }); const operation = await selectionWrite(outbox, raw, 'old');
    let first = true; sdk.afterRead = async readPath => { if (readPath === oldPath && first) { first = false; sdk.data.set(oldPath, rawVehicle()); } };
    await expect(writeVehicleSelectionOperation(db, outbox, operation, current)).rejects.toMatchObject({ code: 'vehicle-selection-obsolete' });
    expect(sdk.writes).toEqual([]);
  });
  it('retries the same ID after reload without overwriting a late choice', async () => {
    const { outbox, options } = await open(); const operation = await selectionWrite(outbox);
    await outbox.fail(operation.opId, operation.version, { code: 'unavailable', message: '', at: 1 }); outbox.close();
    const reopened = await Outbox.open('alice', 'test', options); boxes.push(reopened); const retry = (await reopened.claimRetry(operation.opId))!;
    sdk.data.set(profilePath, { ...profile(), settings: { activeVehicleId: 'other' } });
    const error = await writeVehicleSelectionOperation(db, reopened, retry, current).catch(error => error);
    await reopened.markConflict(retry.opId, retry.version, error.serverImage);
    const kept = (await reopened.get(retry.opId))!; expect(kept.payload).toEqual(operation.payload); expect(kept.beforeImage).toEqual(operation.beforeImage);
    expect(presentOutboxOperation(kept).canOverwrite).toBe(false); expect(vehicleSelectionDisplay(kept).server).toEqual({ activeVehicleId: 'other' });
  });
  it('acknowledges an actual fixed desired preference and fails an unapplied orphan honestly', async () => {
    const { outbox } = await open(); const operation = await selectionWrite(outbox);
    expect(await reconcileVehicleSelectionOperation(db, outbox, operation, current)).toBe(true);
    expect((await outbox.get(operation.opId))?.status).toBe('failed');
    const retry = (await outbox.claimRetry(operation.opId))!;
    sdk.data.set(profilePath, { ...profile(), settings: { activeVehicleId: 'car', keep: 1 } });
    expect(await reconcileVehicleSelectionOperation(db, outbox, retry, current)).toBe(true); expect(await outbox.get(operation.opId)).toBeNull();
  });
});

describe('atomic reviewed document conflict rebase', () => {
  it('learns this parent’s selected child, preserves new unknown data, then writes only authored leaves', async () => {
    const { outbox } = await open(), raw = rawVehicle(), operation = await documentWrite(outbox, raw);
    const server = rawVehicle({ mandatory: { ...raw.docs.mandatory, cost: 765.4321987, futureAdded: { untouched: 'new' } } });
    sdk.data.set(path, server);
    await outbox.markConflict(operation.opId, operation.version, captureVehicleDocumentImages(server).mandatory!);
    const reviewed = (await outbox.get(operation.opId))!;
    const rebased = await rebaseVehicleDocumentOperation(outbox, reviewed, current);
    expect(rebased.payload).toEqual(reviewed.payload); expect(rebased.beforeImage).toEqual(reviewed.serverImage);
    const retry = (await outbox.claimRetry(rebased.opId))!;
    await writeVehicleDocumentOperation(db, outbox, retry, current);
    expect(sdk.writes[0].patch).toEqual({ 'docs.mandatory': { ...server.docs.mandatory, due: '2027-01-02' } });
    expect(await outbox.list()).toEqual([]);
  });
  it.each(['same-version-server', 'newer-rebase', 'newer-authored-revision'] as const)('refuses %s inside the IDB mutation and preserves the entire newer entry', async race => {
    const { outbox, options } = await open(), raw = rawVehicle(), operation = await documentWrite(outbox, raw);
    const other = await Outbox.open('alice', 'test', options); boxes.push(other);
    const server = captureVehicleDocumentImages(rawVehicle({ mandatory: { ...raw.docs.mandatory, cost: 999.123456 } })).mandatory!;
    await outbox.markConflict(operation.opId, operation.version, server);
    const reviewed = (await outbox.get(operation.opId))!, realRebase = outbox.rebase.bind(outbox);
    let expected: OutboxOperation | null = null;
    vi.spyOn(outbox, 'rebase').mockImplementation(async (...args) => {
      if (race === 'same-version-server') {
        await other.markConflict(operation.opId, operation.version,
          captureVehicleDocumentImages(rawVehicle({ mandatory: { ...raw.docs.mandatory, cost: 111.123456 } })).mandatory!);
      } else if (race === 'newer-rebase') await other.rebase(operation.opId,
        captureVehicleDocumentImages(rawVehicle({ mandatory: { ...raw.docs.mandatory, insurer: 'נוסף' } })).mandatory!, {});
      else {
        const newer = await other.enqueue({ kind: 'vehicle.update', path, vehicleId: 'car', opType: 'update', replaceOpId: operation.opId,
          payload: vehicleDocumentIntent('mandatory', { insurer: 'חדש', cost: 8.123456789 }), beforeImage: server });
        await other.markConflict(newer.opId, newer.version, server);
      }
      expected = (await other.get(operation.opId))!;
      return realRebase(...args);
    });
    await expect(rebaseVehicleDocumentOperation(outbox, reviewed, current)).rejects.toMatchObject({ code: 'vehicle-conflict-changed' });
    expect(await outbox.get(operation.opId)).toEqual(expected); expect(sdk.writes).toEqual([]);
    expect((await outbox.get(operation.opId))?.status).toBe('conflict');
  });
  it('checks lifetime inside the actual mutation and keeps an invalidated conflict untouched', async () => {
    const { outbox } = await open(), operation = await documentWrite(outbox);
    await outbox.markConflict(operation.opId, operation.version, captureVehicleDocumentImages(rawVehicle()).mandatory!);
    const reviewed = (await outbox.get(operation.opId))!, realRebase = outbox.rebase.bind(outbox);
    let live = true;
    vi.spyOn(outbox, 'rebase').mockImplementation(async (...args) => { live = false; return realRebase(...args); });
    await expect(rebaseVehicleDocumentOperation(outbox, reviewed, () => live)).rejects.toMatchObject({ code: 'vehicle-conflict-changed' });
    expect(await outbox.get(operation.opId)).toEqual(reviewed);
  });
});

describe('new-family fail-closed presentation', () => {
  it.each(['documents', 'selection'] as const)('refuses a valid codec with a wrong inner container type for %s', async family => {
    const { outbox } = await open();
    const valid = family === 'documents' ? await documentWrite(outbox, rawVehicle({})) :
      await selectionWrite(outbox, { createdAt: profile().createdAt, settings: {} });
    const malformedBase = encodeRawDocument({ ...decodeRawDocument(valid.beforeImage!), container: ['map'] });
    const operation = await outbox.enqueue({ kind: valid.kind, path: valid.path, vehicleId: valid.vehicleId, opType: 'update',
      replaceOpId: valid.opId, payload: valid.payload, beforeImage: malformedBase });
    const write = family === 'documents' ? writeVehicleDocumentOperation : writeVehicleSelectionOperation;
    await expect(write(db, outbox, operation, current)).rejects.toThrow();
    expect(presentOutboxOperation(operation)).toMatchObject({ state: 'unverified', canOverwrite: false });
    expect((await outbox.get(operation.opId))?.beforeImage).toEqual(malformedBase); expect(sdk.writes).toEqual([]);
  });
  it('makes a malformed recovered candidate visibly unverified without changing any durable image', async () => {
    const { outbox } = await open();
    for (const original of [await documentWrite(outbox), await selectionWrite(outbox)]) {
      const operation = await outbox.enqueue({ kind: original.kind, path: original.path, vehicleId: original.vehicleId, opType: 'update',
        replaceOpId: original.opId, beforeImage: original.beforeImage, payload: { __tankMalehRawDocument: { version: 99 } } });
      const reconcile = operation.kind === 'vehicle.update' ? reconcileVehicleDocumentOperation : reconcileVehicleSelectionOperation;
      expect(await reconcile(db, outbox, operation, current)).toBe(true);
      const kept = (await outbox.get(operation.opId))!;
      expect(kept.status).toBe('failed'); expect(kept.error?.code).toBe('unverified');
      expect(kept.payload).toEqual(operation.payload); expect(kept.beforeImage).toEqual(operation.beforeImage);
      expect(presentOutboxOperation(kept)).toMatchObject({ state: 'unverified', canOverwrite: false });
    }
    expect(sdk.writes).toEqual([]);
  });
  it('shows annual cost with whole-shekel display, hidden precision differences and no durable byte changes', async () => {
    const { outbox } = await open(), raw = rawVehicle(); const operation = await documentWrite(outbox, raw, 'mandatory', { cost: 123.456789 });
    const serverRaw = rawVehicle({ mandatory: { ...raw.docs.mandatory, cost: 123.456788 } });
    await outbox.markConflict(operation.opId, operation.version, captureVehicleDocumentImages(serverRaw).mandatory!);
    const conflict = (await outbox.get(operation.opId))!, bytes = JSON.stringify(conflict);
    const view = presentOutboxOperation(conflict);
    expect(view.category).toBe('vehicleDocument'); expect(view.title).toBe('ביטוח חובה'); expect(view.canOverwrite).toBe(true);
    expect(outboxFieldText('cost', view.payload!.cost)).toBe('₪123');
    expect(outboxDifferences(view.payload, view.serverImage!).find(diff => diff.key === 'cost')?.beyondDisplayPrecision).toBe(true);
    expect(JSON.stringify(conflict)).toBe(bytes);
  });
  it.each(['payload', 'beforeImage', 'serverImage'] as const)('quarantines malformed %s in both recognized families', async position => {
    const { outbox } = await open(); const candidates = [await documentWrite(outbox), await selectionWrite(outbox)];
    for (const operation of candidates) {
      const broken: OutboxOperation = { ...operation, [position]: { __tankMalehRawDocument: { version: 99 } } };
      expect(isVehicleDocumentOperation(broken) || isVehicleSelectionOperation(broken)).toBe(true);
      expect(presentOutboxOperation(broken)).toMatchObject({ state: 'unverified', canOverwrite: false });
    }
  });
  it('keeps actual Timestamp values different from timestamp-shaped unknown maps', async () => {
    const { outbox } = await open(), raw = rawVehicle({ mandatory: { future: new Timestamp(10, 123456789) } });
    const operation = await documentWrite(outbox, raw);
    const base = decodeRawDocument(operation.beforeImage!);
    expect(rawDocumentMatches((base.selected as { value: OutboxPayload }).value.future, { seconds: 10, nanoseconds: 123456789 })).toBe(false);
    expect(decodeRawDocument(encodeRawDocument(raw))).toEqual(raw);
  });
});
