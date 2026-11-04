import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doc, Timestamp, type Firestore } from 'firebase/firestore';
import { Outbox, type OutboxOperation, type OutboxPayload } from './outbox';
import { decodeRawDocument, encodeRawDocument, rawDocumentMatches } from './rawDocument';
import { createRecordUndo } from './recordUndo';
import { decodeVehicleRecord, type VehicleIssue } from './vehicle/model';
import {
  captureCareImage, isRecordUndoOperation, recordConflictPayloadPatch, recordReconciliationVerdicts,
  recordRestoreImage, reconcileRecordOperation, writeRecordOperation,
} from './recordUndoPersistence';
import { conditionalFillupWrite } from './writesConditional';

const sdk = vi.hoisted(() => ({
  data: new Map<string, Record<string, unknown>>(), calls: [] as string[],
  barrier: Promise.resolve(), serverGate: Promise.resolve(), pending: false,
  afterRead: null as ((path: string) => Promise<void>) | null,
  afterCommit: null as (() => Promise<void>) | null,
}));

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  const reference = (path: string) => ({ path, id: path.split('/').at(-1),
    parent: { parent: { path: path.split('/').slice(0, -2).join('/') } } });
  const snapshot = (path: string, data: Record<string, unknown> | undefined, fromCache = false) => ({
    id: path.split('/').at(-1), exists: () => data !== undefined, data: () => data,
    metadata: { fromCache, hasPendingWrites: sdk.pending },
  });
  return {
    ...actual,
    doc: (_db: unknown, path: string) => reference(path),
    waitForPendingWrites: async () => { sdk.calls.push('barrier'); await sdk.barrier; },
    getDocFromCache: async (ref: { path: string }) => {
      sdk.calls.push(`cache:${ref.path}`);
      return snapshot(ref.path, sdk.data.get(ref.path), true);
    },
    getDocFromServer: async (ref: { path: string }) => {
      sdk.calls.push(`server:${ref.path}`);
      const result = snapshot(ref.path, sdk.data.get(ref.path));
      await sdk.serverGate;
      return result;
    },
    runTransaction: async (_db: unknown, body: (transaction: unknown) => Promise<unknown>) => {
      // Re-run the actual callback when a checked document changes before
      // commit, matching Firestore's read-version precondition.
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map<string, Record<string, unknown> | undefined>();
        const writes: { path: string; data: Record<string, unknown> | null }[] = [];
        const result = await body({
          get: async (ref: { path: string }) => {
            const data = sdk.data.get(ref.path);
            reads.set(ref.path, data);
            sdk.calls.push(`read:${ref.path}`);
            await sdk.afterRead?.(ref.path);
            return snapshot(ref.path, data);
          },
          delete: (ref: { path: string }) => { writes.push({ path: ref.path, data: null }); },
          set: (ref: { path: string }, data: Record<string, unknown>) => { writes.push({ path: ref.path, data }); },
          update: (ref: { path: string }, data: Record<string, unknown>) => { writes.push({ path: ref.path, data: { ...sdk.data.get(ref.path), ...data } }); },
        });
        if ([...reads].some(([path, value]) => sdk.data.get(path) !== value)) continue;
        for (const write of writes) {
          sdk.calls.push(`commit:${write.data === null ? 'delete' : 'set'}:${write.path}`);
          if (write.data === null) sdk.data.delete(write.path);
          else sdk.data.set(write.path, write.data);
        }
        await sdk.afterCommit?.();
        return result;
      }
      throw new Error('transaction attempts exhausted');
    },
  };
});

const db = {} as Firestore;
const parent = 'users/alice/vehicles/car';
const readingPath = `${parent}/observations/reading`;
const carePath = `${parent}/vehicleIssues/issue`;
const current = () => true;
const receipt = { id: 'receipt', settled: Promise.resolve(true) };
const opened: Outbox[] = [];
const rawReading = () => ({
  observedAt: new Timestamp(1_700_000_000, 123_456_789),
  recordedAt: new Timestamp(1_700_000_001, 987_654_321),
  kind: 'level', level: 0, levelUncertainty: null, confirmed: true,
});
const rawIssue = () => ({
  schemaVersion: 1, version: 7, day: '2026-09-01', title: 'רעש', symptoms: 'בפנייה', odometer: null,
  importance: 'normal', status: 'resolved', notes: '', serviceEventIds: ['s2', 's1'],
  history: ['{ "note" : "שמן", "day" : "2026-09-01", "status" : "resolved" }'],
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function environment() {
  const options = { indexedDB: new IDBFactory(), storage: null, channel: null };
  const outbox = await Outbox.open('alice', 'test', options);
  opened.push(outbox);
  return { outbox, options };
}

async function deletion(outbox: Outbox, raw = rawReading() as OutboxPayload, path = readingPath) {
  return outbox.enqueue({ kind: path === readingPath ? 'tank.observation.delete' : 'maintenance.delete',
    path, vehicleId: 'car', opType: 'delete', payload: null, beforeImage: encodeRawDocument(raw) });
}

async function restoration(outbox: Outbox, raw = rawReading() as OutboxPayload, path = readingPath) {
  return outbox.enqueue({ kind: path === readingPath ? 'tank.observation' : 'maintenance.save',
    path, vehicleId: 'car', opType: 'set', payload: recordRestoreImage(encodeRawDocument(raw), path === readingPath ? 'observations' : 'vehicleIssues') });
}

beforeEach(() => {
  sdk.data.clear(); sdk.data.set(parent, { archived: false }); sdk.calls = [];
  sdk.barrier = Promise.resolve(); sdk.serverGate = Promise.resolve(); sdk.pending = false;
  sdk.afterRead = null; sdk.afterCommit = null;
});
afterEach(() => {
  opened.splice(0).forEach(outbox => outbox.close());
  vi.restoreAllMocks();
});

describe('reviewed care capture', () => {
  it('validates the selected model but retains history JSON bytes, absence and version', async () => {
    const raw = rawIssue();
    sdk.data.set(carePath, raw);
    const selected = decodeVehicleRecord('vehicleIssues', { ...raw, id: 'issue' }) as VehicleIssue;
    const captured = await captureCareImage(doc(db, carePath), 'vehicleIssues', selected, current);
    expect(rawDocumentMatches(decodeRawDocument(captured), raw)).toBe(true);
    const restored = decodeRawDocument(recordRestoreImage(captured, 'vehicleIssues'));
    expect(restored).toEqual({ ...raw, version: 1 });
    expect((restored.history as string[])[0]).toBe(raw.history[0]);
    expect(restored.serviceEventIds).toEqual(['s2', 's1']);
  });

  it('refuses changed fields, a different version and pending SDK data before journaling', async () => {
    const raw = rawIssue();
    const selected = decodeVehicleRecord('vehicleIssues', { ...raw, id: 'issue' }) as VehicleIssue;
    for (const stored of [{ ...raw, notes: 'new' }, { ...raw, version: 8 }]) {
      sdk.data.set(carePath, stored);
      await expect(captureCareImage(doc(db, carePath), 'vehicleIssues', selected, current))
        .rejects.toMatchObject({ code: 'record-unverified' });
    }
    sdk.data.set(carePath, raw); sdk.pending = true;
    await expect(captureCareImage(doc(db, carePath), 'vehicleIssues', selected, current))
      .rejects.toMatchObject({ code: 'record-unverified' });
    expect(sdk.calls.some(call => call.startsWith('commit:'))).toBe(false);
  });

  it('does not turn an unknown care cost into authored zero', async () => {
    const path = `${parent}/vehicleExpenses/expense`;
    const raw = { schemaVersion: 1, version: 3, day: '2026-09-01', title: 'חניה', category: 'parking', costAgorot: null, notes: '' };
    const selected = { ...raw, id: 'expense', schemaVersion: 1 as const, category: 'parking' as const };
    sdk.data.set(path, raw);
    const image = await captureCareImage(doc(db, path), 'vehicleExpenses', selected, current);
    expect(decodeRawDocument(recordRestoreImage(image, 'vehicleExpenses')).costAgorot).toBeNull();
    sdk.data.set(path, { ...raw, costAgorot: 0 });
    await expect(captureCareImage(doc(db, path), 'vehicleExpenses', selected, current))
      .rejects.toMatchObject({ code: 'record-unverified' });
  });
});

describe('exact raw deletion and restoration', () => {
  it('preserves same ID, Timestamp nanoseconds, explicit null, authored zero and absent fields through reload', async () => {
    const { outbox, options } = await environment();
    const raw = rawReading(); sdk.data.set(readingPath, raw);
    const remove = await deletion(outbox, raw);
    expect(await writeRecordOperation(db, outbox, remove, current)).toBe('deleted');
    expect(await outbox.list()).toEqual([]);
    expect(sdk.data.has(readingPath)).toBe(false);
    const restore = await restoration(outbox, raw);
    outbox.close();
    const reopened = await Outbox.open('alice', 'test', options); opened.push(reopened);
    const recovered = (await reopened.get(restore.opId))!;
    expect(await writeRecordOperation(db, reopened, recovered, current)).toBe('restored');
    const stored = sdk.data.get(readingPath)!;
    expect(rawDocumentMatches(stored, raw)).toBe(true);
    expect(stored.observedAt).toBeInstanceOf(Timestamp);
    expect((stored.observedAt as Timestamp).nanoseconds).toBe(123_456_789);
    expect(stored.level).toBe(0); expect(stored.levelUncertainty).toBeNull();
    for (const absent of ['odometer', 'fillupId', 'phase', 'schemaVersion']) expect(Object.hasOwn(stored, absent)).toBe(false);
    expect([...sdk.data.keys()]).toEqual([parent, readingPath]);
    expect(await reopened.list()).toEqual([]);
  });

  it('restores a care record with only the rules-required version reset', async () => {
    const { outbox } = await environment();
    const raw = rawIssue(); sdk.data.set(carePath, raw);
    const remove = await deletion(outbox, raw, carePath);
    await writeRecordOperation(db, outbox, remove, current);
    const restore = await restoration(outbox, raw, carePath);
    await writeRecordOperation(db, outbox, restore, current);
    expect(sdk.data.get(carePath)).toEqual({ ...raw, version: 1 });
    expect((sdk.data.get(carePath)!.history as string[])[0]).toBe(raw.history[0]);
  });

  it.each(['nanosecond', 'timestamp-map', 'absent-null'] as const)('refuses a concurrent %s change and stores the exact server conflict', async difference => {
    const { outbox } = await environment();
    const raw = rawReading();
    const remove = await deletion(outbox, raw);
    const server: OutboxPayload = difference === 'nanosecond' ? { ...raw, observedAt: new Timestamp(raw.observedAt.seconds, raw.observedAt.nanoseconds + 1) } :
      difference === 'timestamp-map' ? { ...raw, observedAt: { seconds: raw.observedAt.seconds, nanoseconds: raw.observedAt.nanoseconds } } : { ...raw, odometer: null };
    sdk.data.set(readingPath, server);
    const error = await writeRecordOperation(db, outbox, remove, current).catch(value => value);
    expect(error.code).toBe('conflict');
    expect(rawDocumentMatches(decodeRawDocument(error.serverImage), server)).toBe(true);
    expect(sdk.data.get(readingPath)).toBe(server);
    expect((await outbox.get(remove.opId))?.beforeImage).toEqual(remove.beforeImage);
  });

  it('never replaces a concurrent same-ID recreation; identical restoration is idempotent', async () => {
    const { outbox } = await environment();
    const raw = rawReading();
    const restore = await restoration(outbox, raw);
    const other = { ...raw, level: 0.75 }; sdk.data.set(readingPath, other);
    await expect(writeRecordOperation(db, outbox, restore, current)).rejects.toMatchObject({ code: 'conflict' });
    expect(sdk.data.get(readingPath)).toBe(other);
    sdk.data.set(readingPath, raw);
    expect(await writeRecordOperation(db, outbox, restore, current)).toBe('already-present');
    expect(sdk.calls.some(call => call.startsWith('commit:'))).toBe(false);
    expect(await outbox.get(restore.opId)).toBeNull();
  });

  it.each(['missing', 'deleting'] as const)('refuses restoration under a %s parent, including retries after reload', async state => {
    const { outbox, options } = await environment();
    const restore = await restoration(outbox);
    await outbox.fail(restore.opId, restore.version, { code: 'unavailable', message: 'offline', at: 1 });
    outbox.close();
    const reopened = await Outbox.open('alice', 'test', options); opened.push(reopened);
    const retry = (await reopened.claimRetry(restore.opId))!;
    if (state === 'missing') sdk.data.delete(parent);
    else sdk.data.set(parent, { deletionPending: true, archived: true });
    await expect(writeRecordOperation(db, reopened, retry, current)).rejects.toMatchObject({ code: 'vehicle-unavailable' });
    expect(sdk.data.has(readingPath)).toBe(false);
    expect((await reopened.get(retry.opId))?.payload).toEqual(restore.payload);
  });

  it('rechecks a parent changed after its transaction read and permits an archived nondeleting parent', async () => {
    const { outbox } = await environment();
    const restore = await restoration(outbox);
    let first = true;
    sdk.afterRead = async path => {
      if (path === readingPath && first) { first = false; sdk.data.set(parent, { deletionPending: true }); }
    };
    await expect(writeRecordOperation(db, outbox, restore, current)).rejects.toMatchObject({ code: 'vehicle-unavailable' });
    expect(sdk.calls.filter(call => call === `read:${parent}`)).toHaveLength(2);
    expect(sdk.data.has(readingPath)).toBe(false);
    sdk.afterRead = null; sdk.data.set(parent, { archived: true });
    expect(await writeRecordOperation(db, outbox, restore, current)).toBe('restored');
  });
});

describe('journal retirement and recovery', () => {
  it('awaits exact deletion retirement before settling and enabling the absolute Undo window', async () => {
    const { outbox } = await environment(); const raw = rawReading(); sdk.data.set(readingPath, raw);
    const remove = await deletion(outbox, raw);
    const held = gate(); let now = 100;
    const acknowledge = outbox.acknowledge.bind(outbox);
    vi.spyOn(outbox, 'acknowledge').mockImplementation(async (id, version) => { await held.promise; return acknowledge(id, version); });
    const undo = createRecordUndo(current, async () => receipt, () => now);
    const submission = undo.submission(receipt);
    const promise = writeRecordOperation(db, outbox, remove, current).then(result => { if (result === 'deleted') undo.deleted(); });
    await vi.waitFor(() => expect(sdk.data.has(readingPath)).toBe(false));
    expect(await outbox.get(remove.opId)).not.toBeNull();
    expect(submission.canRestore()).toBe(false); expect(submission.undoDeadline).toBeNull();
    now = 3000; held.resolve(); await promise;
    expect(await outbox.list()).toEqual([]);
    expect(submission.undoDeadline).toBe(8000); expect(submission.canRestore()).toBe(true);
  });

  it('retirements of already-absent deletions never earn Undo', async () => {
    const { outbox } = await environment(); const remove = await deletion(outbox);
    const undo = createRecordUndo(current, async () => receipt);
    const result = await writeRecordOperation(db, outbox, remove, current);
    if (result === 'deleted') undo.deleted();
    expect(result).toBe('already-absent'); expect(await outbox.list()).toEqual([]);
    expect(undo.submission(receipt).canRestore()).toBe(false);
  });

  it('does not retire a newer input substituted while the delete ACK is being retired', async () => {
    const { outbox } = await environment(); const raw = rawReading(); sdk.data.set(readingPath, raw);
    const remove = await deletion(outbox, raw);
    const acknowledge = outbox.acknowledge.bind(outbox);
    vi.spyOn(outbox, 'acknowledge').mockImplementation(async (id, version) => {
      await outbox.enqueue({ kind: 'tank.observation', path: readingPath, vehicleId: 'car', payload: encodeRawDocument({ ...raw, level: 0.8 }), replaceOpId: id });
      return acknowledge(id, version);
    });
    await expect(writeRecordOperation(db, outbox, remove, current)).rejects.toMatchObject({ code: 'record-operation-changed' });
    const retained = (await outbox.get(remove.opId))!;
    expect(decodeRawDocument(retained.payload!).level).toBe(0.8);
    expect(retained.version).toBe(remove.version + 1);
  });

  it('waits for the SDK queue and refuses a changed input or provider scope before writing', async () => {
    const { outbox } = await environment(); const raw = rawReading(); sdk.data.set(readingPath, raw);
    const remove = await deletion(outbox, raw); const held = gate(); sdk.barrier = held.promise;
    const first = {}; let active = first;
    const write = writeRecordOperation(db, outbox, remove, () => active === first);
    await vi.waitFor(() => expect(sdk.calls).toContain('barrier'));
    active = {}; active = {}; held.resolve();
    await expect(write).rejects.toMatchObject({ code: 'scope-changed' });
    expect(sdk.calls.some(call => call.startsWith('read:'))).toBe(false);
    expect(await outbox.get(remove.opId)).not.toBeNull();
  });

  it('blocks a target with another unresolved SDK/journal input', async () => {
    const { outbox } = await environment(); const raw = rawReading(); sdk.data.set(readingPath, raw);
    const remove = await deletion(outbox, raw);
    const neighbor = await outbox.enqueue({ kind: 'tank.observation', path: readingPath, vehicleId: 'car', payload: { level: 0.9 } });
    await expect(writeRecordOperation(db, outbox, remove, current)).rejects.toMatchObject({ code: 'record-write-pending' });
    expect(sdk.data.get(readingPath)).toBe(raw);
    expect((await outbox.list()).map(op => op.opId)).toEqual(expect.arrayContaining([remove.opId, neighbor.opId]));
  });

  it('reconciles care bases using decoded version semantics and preserves raw conflicts', async () => {
    const { outbox } = await environment(); const raw = rawIssue();
    const remove = await deletion(outbox, raw, carePath);
    expect(recordReconciliationVerdicts(remove, raw)[0].verdict).toBe('unconfirmed');
    const changed = { ...raw, history: [...raw.history, '{"day":"2026-09-02","status":"open","note":"חדש"}'] };
    const verdict = recordReconciliationVerdicts(remove, changed)[0];
    expect(verdict.verdict).toBe('conflict');
    if (verdict.verdict === 'conflict') expect(decodeRawDocument(verdict.serverImage!)).toEqual(changed);
    sdk.data.set(carePath, raw);
    await reconcileRecordOperation(db, outbox, remove, current);
    expect((await outbox.get(remove.opId))?.status).toBe('failed');
    sdk.data.delete(carePath);
    await reconcileRecordOperation(db, outbox, (await outbox.get(remove.opId))!, current);
    expect(await outbox.get(remove.opId)).toBeNull();
  });

  it('does not erase a conflict discovered while a fresh reconciliation read was held', async () => {
    const { outbox } = await environment(); const remove = await deletion(outbox);
    const held = gate(); sdk.serverGate = held.promise;
    const reconcile = reconcileRecordOperation(db, outbox, remove, current);
    await vi.waitFor(() => expect(sdk.calls).toContain(`server:${readingPath}`));
    const conflict = encodeRawDocument({ ...rawReading(), level: 0.6 });
    await outbox.markConflict(remove.opId, remove.version, conflict);
    held.resolve(); await reconcile;
    expect((await outbox.get(remove.opId))?.status).toBe('conflict');
    expect((await outbox.get(remove.opId))?.serverImage).toEqual(conflict);
  });

  it('rebases only the care version inside the codec and restores against the exact reviewed server image', async () => {
    const { outbox } = await environment(); const raw = rawIssue();
    const restore = await restoration(outbox, raw, carePath);
    const server = { ...raw, version: 9, title: 'השתנה בשרת' }; sdk.data.set(carePath, server);
    await outbox.markConflict(restore.opId, restore.version, encodeRawDocument(server));
    const conflicted = (await outbox.get(restore.opId))!;
    const rebased = (await outbox.rebase(restore.opId, conflicted.serverImage!, recordConflictPayloadPatch(conflicted)))!;
    expect(Object.hasOwn(rebased.payload!, 'version')).toBe(false);
    expect(decodeRawDocument(rebased.payload!)).toEqual({ ...raw, version: 10 });
    const updated = await outbox.enqueue({ kind: 'maintenance.save', path: carePath, vehicleId: 'car',
      opType: 'update', payload: rebased.payload, beforeImage: conflicted.serverImage!, replaceOpId: restore.opId });
    expect(await writeRecordOperation(db, outbox, updated, current)).toBe('restored');
    expect(sdk.data.get(carePath)).toEqual({ ...raw, version: 10 });
  });

  it('recovers a crash between explicit rebase and set-to-update conversion without recreating an absent record', async () => {
    const { outbox } = await environment(); const raw = rawIssue();
    const restore = await restoration(outbox, raw, carePath);
    const server = { ...raw, version: 9, title: 'אחר' };
    await outbox.markConflict(restore.opId, restore.version, encodeRawDocument(server));
    const conflicted = (await outbox.get(restore.opId))!;
    await outbox.rebase(restore.opId, conflicted.serverImage!, recordConflictPayloadPatch(conflicted));
    const retry = (await outbox.claimRetry(restore.opId))!;
    expect(retry.opType).toBe('set');
    await expect(writeRecordOperation(db, outbox, retry, current)).rejects.toMatchObject({ code: 'conflict' });
    expect(sdk.data.has(carePath)).toBe(false);
    sdk.data.set(carePath, server);
    expect(await writeRecordOperation(db, outbox, retry, current)).toBe('restored');
    expect(sdk.data.get(carePath)).toEqual({ ...raw, version: 10 });
  });

  it('never falls back to unconditional replay for an old observation delete or malformed encoded input', async () => {
    const { outbox } = await environment();
    const legacy = await outbox.enqueue({ kind: 'tank.observation.delete', path: readingPath, vehicleId: 'car', payload: null });
    expect(isRecordUndoOperation(legacy)).toBe(true);
    await expect(writeRecordOperation(db, outbox, legacy, current)).rejects.toMatchObject({ code: 'record-unverified' });
    const broken: OutboxOperation = { ...legacy, beforeImage: { __tankMalehRawDocument: { version: 99 } } };
    expect(isRecordUndoOperation(broken)).toBe(true);
    await expect(writeRecordOperation(db, outbox, broken, current)).rejects.toMatchObject({ code: 'raw-document-unverified' });
    expect(sdk.calls.some(call => call.startsWith('commit:'))).toBe(false);
    expect(await outbox.get(legacy.opId)).not.toBeNull();
  });
});

describe('narrow fill-up restoration parent check', () => {
  it('requires the parent for restores while leaving create/edit/delete paths unchanged', async () => {
    const path = `${parent}/fillups/fillup`;
    const ref = doc(db, path);
    const body = { date: Timestamp.fromMillis(1000), liters: 20, totalCost: 140, version: 1, writeId: 'a' };
    sdk.data.delete(parent);
    await expect(conditionalFillupWrite(db, ref, 'set', body, null, true)).rejects.toMatchObject({ code: 'vehicle-unavailable' });
    await conditionalFillupWrite(db, ref, 'set', body, null);
    const edited = { ...body, liters: 21, version: 2, writeId: 'b' };
    await conditionalFillupWrite(db, ref, 'update', edited, body);
    await conditionalFillupWrite(db, ref, 'delete', null, edited);
    expect(sdk.data.has(path)).toBe(false);
    expect(sdk.calls.filter(call => call === `read:${parent}`)).toHaveLength(1);
  });
});
