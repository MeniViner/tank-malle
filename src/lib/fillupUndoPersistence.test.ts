import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { doc, type Firestore } from 'firebase/firestore';
import { Outbox, type OutboxPayload } from './outbox';
import { parseFillupDocument, serializeFillup, serializeFillupPatch } from './fillupSerializer';
import { createFillupEditUndo, fillupAfterPatch, fillupLifecycleImage, fillupLifecyclePatch } from './fillupLifecycle';
import { fillupOrigin, fillupOriginState, partitionFillupDeletes, retainedCreationUndo } from './fillupUndo';
import { reconcileFillupDeletion, writeFillupDeletion } from './fillupUndoPersistence';
import { conditionalFillupWrite, FillupConflictError } from './writesConditional';

const state = vi.hoisted(() => ({
  server: null as Record<string, unknown> | null,
  parent: {} as Record<string, unknown> | null,
  transactionFailure: null as Error | null,
  barrier: Promise.resolve(), readGate: Promise.resolve(),
  calls: [] as string[], afterDelete: null as (() => Promise<void>) | null,
}));
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  const snapshot = (data: Record<string, unknown> | null) => ({
    exists: () => data !== null, data: () => data,
    metadata: { fromCache: false, hasPendingWrites: false },
  });
  return {
    ...actual,
    doc: (_db: unknown, path: string) => ({ path, parent: { parent: { path: path.split('/').slice(0, -2).join('/') } } }),
    waitForPendingWrites: () => { state.calls.push('barrier'); return state.barrier; },
    getDocFromServer: async () => {
      state.calls.push('server-read');
      const captured = state.server;
      await state.readGate;
      return snapshot(captured);
    },
    runTransaction: async (_db: unknown, body: (transaction: unknown) => Promise<void>) => {
      if (state.transactionFailure) throw state.transactionFailure;
      let deleted = false;
      let saved: Record<string, unknown> | undefined;
      await body({
        get: async (ref: { path: string }) => {
          if (ref.path.split('/').length === 4) { state.calls.push('parent-read'); return snapshot(state.parent); }
          state.calls.push('transaction-read'); return snapshot(state.server);
        },
        delete: () => { state.calls.push('delete'); deleted = true; },
        set: (_ref: unknown, data: Record<string, unknown>) => { state.calls.push('set'); saved = data; },
        update: (_ref: unknown, data: Record<string, unknown>) => { state.calls.push('update'); saved = { ...state.server, ...data }; },
      });
      if (deleted) { state.server = null; await state.afterDelete?.(); }
      if (saved) state.server = saved;
    },
  };
});

const db = {} as Firestore;
const path = 'users/alice/vehicles/car/fillups/receipt';
const error = { code: 'unavailable', message: 'held', at: 1 };
const body = (notes = 'original') => serializeFillup({
  date: 1_780_000_000_000, odometer: 90_000, liters: 40,
  pricePerLiter: 7.185, totalCost: 287.4, isFullTank: true, notes, version: 1,
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function pair(kind: 'fillup.add' | 'fillup.restore' | 'fillup.update' = 'fillup.add') {
  const options = { indexedDB: new IDBFactory(), storage: null, channel: null };
  const outbox = await Outbox.open('alice', 'test', options);
  const original = await outbox.enqueue({ kind, path, vehicleId: 'car', payload: body(), opType: kind === 'fillup.update' ? 'update' : 'set' });
  const before = { ...body(), writeId: `${original.opId}.${original.version}` };
  const deletion = await outbox.enqueue({ kind: 'fillup.delete', path, vehicleId: 'car', payload: null, beforeImage: before });
  return { outbox, original, deletion, before, options };
}
const current = () => true;

beforeEach(() => {
  state.server = null; state.parent = {}; state.barrier = Promise.resolve(); state.readGate = Promise.resolve();
  state.calls = []; state.afterDelete = null; state.transactionFailure = null;
});

function readFillup(stored: Record<string, unknown>) {
  const parsed = parseFillupDocument('receipt', stored);
  if (!parsed.ok) throw new Error('invalid fixture');
  return parsed.fillup;
}

function lifecycleImage(stored: Record<string, unknown>) {
  return fillupLifecycleImage(readFillup(stored));
}

describe('legacy note deletion and restoration', () => {
  it.each(['', '  original\n '])('deletes an unchanged legal note %j with the original CAS image', async notes => {
    const outbox = await Outbox.open('alice', 'test', { indexedDB: new IDBFactory(), storage: null, channel: null });
    state.server = { ...body(), createdAt: 1_770_000_000_000, notes };
    const deletion = await outbox.enqueue({ kind: 'fillup.delete', path, vehicleId: 'car', payload: null,
      beforeImage: lifecycleImage(state.server) });
    await writeFillupDeletion(db, outbox, deletion, current);
    expect(state.server).toBeNull();
    expect((await outbox.get(deletion.opId))?.beforeImage?.notes).toBe(notes);
    expect(state.calls).toEqual(['transaction-read', 'delete']);
    outbox.close();
  });

  it('retains a conflicting deletion when an empty note really changed to null', async () => {
    const outbox = await Outbox.open('alice', 'test', { indexedDB: new IDBFactory(), storage: null, channel: null });
    const stored = { ...body(), notes: '' };
    const deletion = await outbox.enqueue({ kind: 'fillup.delete', path, vehicleId: 'car', payload: null,
      beforeImage: lifecycleImage(stored) });
    state.server = { ...stored, notes: null };
    await expect(writeFillupDeletion(db, outbox, deletion, current)).rejects.toMatchObject({ code: 'conflict' });
    expect(state.calls).not.toContain('delete');
    expect(state.server.notes).toBeNull();
    expect((await outbox.get(deletion.opId))?.beforeImage?.notes).toBe('');
    outbox.close();
  });

  it.each(['', null])('preserves note %j across linked origin reconciliation, reload and actual retry', async notes => {
    const options = { indexedDB: new IDBFactory(), storage: null, channel: null };
    const initial = await Outbox.open('alice', 'test', options);
    const payload = { ...body(), notes };
    const original = await initial.enqueue({ kind: 'fillup.add', path, vehicleId: 'car', payload });
    state.server = { ...payload, writeId: `${original.opId}.${original.version}` };
    const beforeImage = lifecycleImage(state.server);
    const deletion = await initial.enqueue({ kind: 'fillup.delete', path, vehicleId: 'car', payload: null, beforeImage });
    expect(fillupOriginState(deletion, original)).toBe('creation');
    initial.close();

    const recovered = await Outbox.open('alice', 'test', options);
    expect(await reconcileFillupDeletion(db, recovered, (await recovered.get(deletion.opId))!, current)).toBe(true);
    expect(await recovered.get(original.opId)).toBeNull();
    expect((await recovered.get(deletion.opId))?.status).toBe('failed');
    expect((await recovered.get(deletion.opId))?.beforeImage).toEqual(beforeImage);
    const retry = (await recovered.claimRetry(deletion.opId))!;
    await writeFillupDeletion(db, recovered, retry, current);
    await recovered.acknowledge(retry.opId, retry.version);
    expect(state.server).toBeNull();
    expect(await recovered.list()).toEqual([]);
    recovered.close();
  });

  it('restores the same empty note without changing the original values and rejects a changed recreation', async () => {
    const before = lifecycleImage({ ...body(), notes: '', createdAt: 1_770_000_000_000 });
    const restored = { ...before, version: 2, writeId: 'restoration.1' };
    await conditionalFillupWrite(db, doc(db, path), 'set', restored, before, true, current);
    expect(state.calls).toEqual(['parent-read', 'transaction-read', 'set']);
    expect(state.server).toEqual(restored);
    expect(state.server?.notes).toBe('');
    state.server = { ...before, notes: null };
    await expect(conditionalFillupWrite(db, doc(db, path), 'set', restored, before, true, current))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(state.server.notes).toBeNull();
  });

  it.each([null, { deletionPending: true }])('keeps an empty-note restore blocked by an unavailable parent %j', async parent => {
    const before = lifecycleImage({ ...body(), notes: '' });
    state.parent = parent;
    await expect(conditionalFillupWrite(db, doc(db, path), 'set', { ...before, version: 2 }, before, true, current))
      .rejects.toMatchObject({ code: 'vehicle-unavailable' });
    expect(state.server).toBeNull();
    expect(state.calls).toEqual(['parent-read']);
  });
});

/** Exercise the actual journal, conditional writer and receipt outcome together. */
async function journalUpdate(outbox: Outbox, payload: OutboxPayload, beforeImage: OutboxPayload) {
  const operation = await outbox.enqueue({ kind: 'fillup.update', path, vehicleId: 'car', payload, beforeImage, opType: 'update' });
  const outgoing = { ...payload, writeId: `${operation.opId}.${operation.version}` };
  const settled = conditionalFillupWrite(db, doc(db, path), 'update', outgoing, beforeImage, false, current).then(
    async () => { await outbox.acknowledge(operation.opId, operation.version); return true; },
    async (failure: unknown) => {
      if (failure instanceof FillupConflictError) await outbox.markConflict(operation.opId, operation.version, failure.serverImage);
      else await outbox.fail(operation.opId, operation.version, error);
      return false;
    },
  );
  return { outgoing, receipt: { id: operation.opId, settled } };
}

async function acceptedEdit(outbox: Outbox, notes: string) {
  const original = lifecycleImage({ ...body(), createdAt: 1_770_000_000_000, totalCost: 287.4001234567, notes });
  state.server = original;
  const previous = readFillup(original);
  const authored = serializeFillupPatch({ ...previous, notes: '  changed note  ', totalCost: 288.4001234567, version: 2 });
  const submitted = await journalUpdate(outbox, authored, fillupLifecyclePatch(previous));
  expect(await submitted.receipt.settled).toBe(true);
  expect(state.server?.notes).toBe('changed note');
  const written = fillupAfterPatch(previous.id, previous, submitted.outgoing);
  const undo = createFillupEditUndo({ previous, written, receipt: submitted.receipt, replacement: false,
    isCurrent: current, submitPatch: async (payload, before) => (await journalUpdate(outbox, payload, before)).receipt })!;
  return { original, previous, written, undo };
}

describe('canonical edit and exact original-note Undo persistence', () => {
  it.each(['', '  original\n '])('edits then restores original note %j through actual conditional updates', async notes => {
    const outbox = await Outbox.open('alice', 'test', { indexedDB: new IDBFactory(), storage: null, channel: null });
    const edit = await acceptedEdit(outbox, notes);
    expect(edit.written.notes).toBe('changed note');
    expect(state.server?.totalCost).toBe(288.4001234567);
    const receipt = await edit.undo();
    expect(await receipt.settled).toBe(true);
    expect(state.server).toEqual({ ...edit.original, version: 3, writeId: `${receipt.id}.1` });
    expect(state.calls.filter(call => call === 'update')).toHaveLength(2);
    expect(state.calls).not.toContain('set');
    expect(await outbox.list()).toEqual([]);
    outbox.close();
  });

  it.each(['absent', 'notes', 'amount'] as const)('retains the requested Undo and refuses a concurrent %s change', async difference => {
    const outbox = await Outbox.open('alice', 'test', { indexedDB: new IDBFactory(), storage: null, channel: null });
    const edit = await acceptedEdit(outbox, '');
    const concurrent = difference === 'absent' ? null : difference === 'notes'
      ? { ...state.server, notes: 'other device' }
      : { ...state.server, totalCost: 288.4001234568 };
    state.server = concurrent;
    const receipt = await edit.undo();
    expect(await receipt.settled).toBe(false);
    expect(state.server).toEqual(concurrent);
    expect(state.calls.filter(call => call === 'update')).toHaveLength(1);
    expect(state.calls).not.toContain('set');
    const retained = (await outbox.get(receipt.id))!;
    expect(retained.status).toBe('conflict');
    expect(retained.kind).toBe('fillup.update');
    expect(retained.opType).toBe('update');
    expect(retained.payload?.notes).toBe('');
    expect(retained.beforeImage?.notes).toBe('changed note');
    expect(retained.payload).not.toHaveProperty('createdAt');
    expect(retained.beforeImage).not.toHaveProperty('createdAt');
    outbox.close();
  });

  it('retries an offline retained Undo after reload without normalizing notes or creating a new original', async () => {
    const options = { indexedDB: new IDBFactory(), storage: null, channel: null };
    const initial = await Outbox.open('alice', 'test', options);
    const edit = await acceptedEdit(initial, '  original\n ');
    state.transactionFailure = Object.assign(new Error('offline'), { code: 'unavailable' });
    const receipt = await edit.undo();
    expect(await receipt.settled).toBe(false);
    const retained = (await initial.get(receipt.id))!;
    expect(retained.status).toBe('failed');
    expect(state.server?.notes).toBe('changed note');
    initial.close();

    state.transactionFailure = null;
    const recovered = await Outbox.open('alice', 'test', options);
    const retry = (await recovered.claimRetry(receipt.id))!;
    expect(retry.kind).toBe('fillup.update');
    expect(retry.opType).toBe('update');
    expect(retry.payload).toEqual(retained.payload);
    expect(retry.beforeImage).toEqual(retained.beforeImage);
    await conditionalFillupWrite(db, doc(db, path), retry.opType,
      { ...retry.payload, writeId: `${retry.opId}.${retry.version}` }, retry.beforeImage, false, current);
    await recovered.acknowledge(retry.opId, retry.version);
    expect(state.server).toEqual({ ...edit.original, version: 3, writeId: `${retry.opId}.${retry.version}` });
    expect(state.calls).not.toContain('set');
    expect(await recovered.list()).toEqual([]);
    recovered.close();
  });
});

describe('durable fill-up Undo ordering', () => {
  it('journals first, waits for the original SDK queue, then retires the create before child ACK', async () => {
    const { outbox, original, deletion, before } = await pair();
    const held = gate(); state.barrier = held.promise;
    const write = writeFillupDeletion(db, outbox, deletion, current);
    expect(state.calls).toEqual(['barrier']);
    expect((await outbox.list()).map(op => op.opId)).toEqual([original.opId, deletion.opId]);
    state.server = before; held.resolve();
    await write;
    expect(state.calls).toEqual(['barrier', 'transaction-read', 'delete']);
    expect(state.server).toBeNull();
    expect(await outbox.get(original.opId)).toBeNull();
    expect((await outbox.get(deletion.opId))?.status).toBe('pending');
    await outbox.acknowledge(deletion.opId, deletion.version);
    expect(await outbox.list()).toEqual([]);
    outbox.close();
  });

  it('retires a rejected creation when the exact Undo conclusively finds absence', async () => {
    const { outbox, original, deletion } = await pair();
    await outbox.fail(original.opId, original.version, error);
    await writeFillupDeletion(db, outbox, deletion, current);
    expect(state.calls).not.toContain('delete');
    expect(await outbox.get(original.opId)).toBeNull();
    expect(await outbox.claimRetry(original.opId)).toBeNull();
    expect(await outbox.get(deletion.opId)).not.toBeNull();
    outbox.close();
  });

  it('keeps a replaced input and its Undo when the original attempt changes during the barrier', async () => {
    const { outbox, original, deletion, before } = await pair();
    state.server = before;
    const held = gate(); state.barrier = held.promise;
    const write = writeFillupDeletion(db, outbox, deletion, current);
    const replacement = await outbox.enqueue({ kind: 'fillup.add', path, vehicleId: 'car', payload: body('new input'), replaceOpId: original.opId });
    held.resolve();
    await expect(write).rejects.toMatchObject({ code: 'undo-origin-changed' });
    expect(state.server).toEqual(before);
    expect(state.calls).not.toContain('delete');
    expect((await outbox.get(original.opId))?.payload?.notes).toBe('new input');
    expect(await outbox.get(deletion.opId)).not.toBeNull();
    expect(retainedCreationUndo(await outbox.list(), replacement)?.opId).toBe(deletion.opId);
    outbox.close();
  });

  it('does not report Undo complete if the origin changes after deletion commits', async () => {
    const { outbox, original, deletion, before } = await pair(); state.server = before;
    state.afterDelete = async () => { await outbox.enqueue({ kind: 'fillup.add', path, vehicleId: 'car', payload: body('later input'), replaceOpId: original.opId }); };
    await expect(writeFillupDeletion(db, outbox, deletion, current)).rejects.toMatchObject({ code: 'undo-origin-changed' });
    expect(state.server).toBeNull();
    expect((await outbox.get(original.opId))?.payload?.notes).toBe('later input');
    expect(await outbox.get(deletion.opId)).not.toBeNull();
    await reconcileFillupDeletion(db, outbox, deletion, current);
    expect((await outbox.get(deletion.opId))?.error?.code).toBe('undo-origin-changed');
    outbox.close();
  });

  it('preserves a concurrent legacy server edit instead of deleting it', async () => {
    const { outbox, original, deletion, before } = await pair();
    state.server = { ...before, totalCost: 287.400001, notes: 'other device' };
    await expect(writeFillupDeletion(db, outbox, deletion, current)).rejects.toMatchObject({ code: 'conflict' });
    expect(state.server.notes).toBe('other device');
    expect(await outbox.get(original.opId)).not.toBeNull();
    expect(await outbox.get(deletion.opId)).not.toBeNull();
    outbox.close();
  });

  it('invalidates an A→B→A provider session across a held queue', async () => {
    const { outbox, deletion, before } = await pair(); state.server = before;
    const first = {}; let active = first;
    const held = gate(); state.barrier = held.promise;
    const write = writeFillupDeletion(db, outbox, deletion, () => active === first);
    active = {}; active = {}; held.resolve();
    await expect(write).rejects.toMatchObject({ code: 'scope-changed' });
    expect(state.calls).not.toContain('transaction-read');
    expect((await outbox.list()).length).toBe(2);
    outbox.close();
  });
});

describe('linked recovery after reload', () => {
  it('settles the proven creation while retaining an unexecuted delete for explicit retry', async () => {
    const pairState = await pair(); const { original, deletion, before, options } = pairState;
    pairState.outbox.close();
    const outbox = await Outbox.open('alice', 'test', options); state.server = before;
    const recovered = (await outbox.get(deletion.opId))!;
    expect(await reconcileFillupDeletion(db, outbox, recovered, current)).toBe(true);
    expect(await outbox.get(original.opId)).toBeNull();
    expect((await outbox.get(deletion.opId))?.status).toBe('failed');
    const retry = (await outbox.claimRetry(deletion.opId))!;
    await writeFillupDeletion(db, outbox, retry, current);
    await outbox.acknowledge(retry.opId, retry.version);
    expect(state.server).toBeNull(); expect(await outbox.list()).toEqual([]);
    outbox.close();
  });

  it.each(['fillup.add', 'fillup.restore', 'fillup.update'] as const)('retires an exact %s origin before acknowledging recovered absence', async kind => {
    const { outbox, original, deletion } = await pair(kind);
    await outbox.fail(original.opId, original.version, error);
    expect(await reconcileFillupDeletion(db, outbox, deletion, current)).toBe(true);
    expect(await outbox.list()).toEqual([]);
    expect(await outbox.claimRetry(original.opId)).toBeNull();
    outbox.close();
  });

  it('does not clear a same-version conflict learned while the server read was held', async () => {
    const { outbox, original, deletion, before } = await pair();
    const held = gate(); state.readGate = held.promise;
    const reconcile = reconcileFillupDeletion(db, outbox, deletion, current);
    await vi.waitFor(() => expect(state.calls).toContain('server-read'));
    await outbox.markConflict(deletion.opId, deletion.version, { ...before, notes: 'newer server' });
    held.resolve(); await reconcile;
    expect((await outbox.get(deletion.opId))?.status).toBe('conflict');
    expect(await outbox.get(original.opId)).not.toBeNull();
    outbox.close();
  });

  it('keeps both inputs when the parent cannot be read', async () => {
    const { outbox, original, deletion } = await pair();
    const get = outbox.get.bind(outbox);
    vi.spyOn(outbox, 'get').mockImplementation(opId => opId === original.opId ? Promise.reject(new Error('storage failed')) : get(opId));
    expect(await reconcileFillupDeletion(db, outbox, deletion, current)).toBe(false);
    expect((await outbox.list()).length).toBe(2);
    outbox.close();
  });

  it('never groups unrelated neighboring input into an Undo pair', async () => {
    const { outbox, original, deletion } = await pair();
    const unrelated = await outbox.enqueue({ kind: 'fillup.update', path, vehicleId: 'car', payload: body('neighbor') });
    const partition = partitionFillupDeletes(await outbox.list());
    expect(partition.deletions.map(op => op.opId)).toEqual([deletion.opId]);
    expect(partition.ordinary.map(op => op.opId)).toEqual([unrelated.opId]);
    expect(fillupOriginState(deletion, { ...original, version: original.version + 1 })).toBe('changed');
    expect(fillupOriginState(deletion, { ...original, payload: { ...original.payload, totalCost: 287.400001 } })).toBe('changed');
    expect(fillupOriginState(deletion, null)).toBe('missing');
    outbox.close();
  });

  it('parses only a positive safe final version and preserves dots in operation ids', () => {
    expect(fillupOrigin('op.with.dots.12')).toEqual({ opId: 'op.with.dots', version: 12 });
    for (const bad of [null, '', '.1', 'a.0', 'a.-1', 'a.01', 'a.1.5e2', 'a.9007199254740992']) expect(fillupOrigin(bad)).toBeNull();
  });
});
