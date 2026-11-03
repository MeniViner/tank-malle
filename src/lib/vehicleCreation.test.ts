import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Outbox, type OutboxOperation } from './outbox';
import { WriteTracker } from './writes';
import { submitVehicleCreation, vehicleCreationIdentityMatches, notifyVehicleSelection, type VehicleCreationSubmission, type VehicleSelectionResult } from './vehicleCreation';

function gate<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const boxes: Outbox[] = [];
afterEach(() => { boxes.splice(0).forEach(box => box.close()); vi.restoreAllMocks(); });
async function rig() {
  const outbox = await Outbox.open('alice', 'test', { indexedDB: new IDBFactory(), storage: null, channel: null }); boxes.push(outbox);
  const tracker = new WriteTracker(), accepted = gate(), server = gate(), handoff = gate<VehicleCreationSubmission>();
  const events: string[] = [];
  let current = 'A1';
  const select = vi.fn(async (): Promise<VehicleSelectionResult> => ({ state: 'not-required', reason: 'not-first-vehicle' }));
  const journal = async (settled: Promise<unknown>) => {
    const operation = await outbox.enqueue({ kind: 'vehicle.add', path: 'users/alice/vehicles/new-car', vehicleId: 'new-car',
      payload: { make: 'Toyota', model: 'Yaris', fuelType: '95', tankLiters: 42.123456789 } });
    events.push('journal');
    void settled.then(() => outbox.acknowledge(operation.opId, operation.version), error => outbox.fail(operation.opId, operation.version,
      { code: 'rejected', message: String(error), at: 1 }));
    return { operation, receipt: tracker.track('vehicle.add', settled) };
  };
  const start = vi.fn(() => { events.push('sdk'); return { accepted: accepted.promise, settled: server.promise }; });
  const options = { vehicleId: 'new-car', isCurrent: () => current === 'A1', journal, start,
    select: (_creation: OutboxOperation, _attempt: 'initial' | 'retry') => select(),
    onSubmitted: (submission: VehicleCreationSubmission) => { events.push('callback'); handoff.resolve(submission); } };
  return { outbox, tracker, accepted, server, handoff, events, select, start, options, setCurrent: (value: string) => { current = value; } };
}

describe('durable vehicle creation handoff', () => {
  it('delivers selection failure separately from primary success and guards later receipt notices', () => {
    let account = 'A1'; const isCurrent = () => account === 'A1';
    const blocked: VehicleSelectionResult = { state: 'blocked', reason: 'unverified', message: 'בחרו רכב מהרשימה' };
    let guard: (() => boolean) | null = null;
    const notice = vi.fn((_result: VehicleSelectionResult, current: () => boolean) => { guard = current; });
    notifyVehicleSelection({ onSelection: notice }, blocked, isCurrent);
    expect(notice).toHaveBeenCalledWith(blocked, isCurrent); expect(guard!()).toBe(true);
    account = 'B1'; account = 'A2';
    expect(guard!()).toBe(false); notifyVehicleSelection({ onSelection: notice }, blocked, isCurrent);
    expect(notice).toHaveBeenCalledTimes(1);
    expect(() => notifyVehicleSelection({ onSelection: () => { throw new Error('screen'); } }, blocked, () => true)).not.toThrow();
  });
  it('keeps first selection valid after unrelated generated specs without rebinding another parent identity', () => {
    const payload = { make: 'Toyota', model: 'Yaris', fuelType: '95', year: null, createdAt: '__serverTimestamp__', tankLiters: null };
    expect(vehicleCreationIdentityMatches(payload, { ...payload, createdAt: 123, tankLiters: 40, declaredKmPerLiter: 20 })).toBe(true);
    expect(vehicleCreationIdentityMatches(payload, { ...payload, model: 'Corolla' })).toBe(false);
    const withoutYear = { ...payload } as Record<string, unknown>; delete withoutYear.year;
    expect(vehicleCreationIdentityMatches(payload, withoutYear)).toBe(false);
  });
  it('delivers the real journal identity/receipt before SDK setup and resolves ID on local acceptance', async () => {
    const r = await rig(); const creation = submitVehicleCreation(r.options), envelope = await r.handoff.promise;
    expect(r.events).toEqual(['journal', 'callback', 'sdk']);
    const [operation] = await r.outbox.list();
    expect(envelope.creation.opId).toBe(operation.opId); expect(envelope.creation.version).toBe(operation.version);
    expect(envelope.creation.receipt.id).not.toBe(operation.opId);
    r.accepted.resolve(); expect(await creation).toBe('new-car');
    expect(r.select).not.toHaveBeenCalled(); expect(r.tracker.status().pending).toHaveLength(1);
    r.server.resolve(); expect(await envelope.creation.receipt.settled).toBe(true);
    expect(await envelope.selection).toEqual({ state: 'not-required', reason: 'not-first-vehicle' });
    expect(r.select).toHaveBeenCalledOnce();
  });

  it('retains the one creation operation when SDK/local setup throws after the callback', async () => {
    const r = await rig(); r.start.mockImplementation(() => { throw new Error('listener setup'); });
    await expect(submitVehicleCreation(r.options)).rejects.toThrow('listener setup');
    const envelope = await r.handoff.promise;
    expect(await envelope.creation.receipt.settled).toBe(false);
    expect(await envelope.selection).toMatchObject({ state: 'blocked', reason: 'creation-unconfirmed', operation: { opId: envelope.creation.opId } });
    await vi.waitFor(async () => expect((await r.outbox.list())[0]?.status).toBe('failed'));
    expect(await r.outbox.list()).toHaveLength(1); expect(r.select).not.toHaveBeenCalled();
    expect((await r.outbox.list())[0].payload!.tankLiters).toBe(42.123456789);
  });

  it('contains a notification exception without leaving the SDK promise pending or creating another identity', async () => {
    const r = await rig(); let retained: VehicleCreationSubmission | null = null;
    const creation = submitVehicleCreation({ ...r.options, onSubmitted: value => { retained = value; throw new Error('view was removed'); } });
    await vi.waitFor(() => expect(r.start).toHaveBeenCalledOnce());
    r.accepted.resolve(); expect(await creation).toBe('new-car'); r.server.resolve();
    expect(await retained!.creation.receipt.settled).toBe(true);
    expect(await retained!.selection).toMatchObject({ state: 'not-required' });
    expect(r.start).toHaveBeenCalledOnce();
  });

  it('separates a selection failure and retry from a completed vehicle creation', async () => {
    const r = await rig(); r.select.mockRejectedValueOnce(new Error('selection unavailable'));
    const creation = submitVehicleCreation(r.options), envelope = await r.handoff.promise;
    r.accepted.resolve(); expect(await creation).toBe('new-car'); r.server.resolve();
    expect(await envelope.selection).toMatchObject({ state: 'blocked', reason: 'selection-unavailable' });
    r.select.mockResolvedValueOnce({ state: 'not-required', reason: 'already-selected' });
    expect(await envelope.retrySelection()).toMatchObject({ state: 'not-required', reason: 'already-selected' });
    expect(r.start).toHaveBeenCalledOnce(); expect(r.events.filter(value => value === 'journal')).toHaveLength(1);
  });

  it('does not turn a local-acceptance listener failure into a false SDK rejection', async () => {
    const r = await rig(); const creation = submitVehicleCreation(r.options), envelope = await r.handoff.promise;
    r.accepted.reject(new Error('local listener')); await expect(creation).rejects.toThrow('local listener');
    expect(r.tracker.status().pending).toHaveLength(1); expect((await r.outbox.list())[0].status).toBe('pending');
    r.server.resolve(); expect(await envelope.creation.receipt.settled).toBe(true);
  });

  it('survives route unmount, but refuses account A to B to A callbacks before SDK setup', async () => {
    const r = await rig();
    const creation = submitVehicleCreation({ ...r.options, onSubmitted: envelope => { r.options.onSubmitted(envelope); r.setCurrent('B1'); r.setCurrent('A2'); } });
    await expect(creation).rejects.toThrow(); const envelope = await r.handoff.promise;
    expect(envelope.isCurrent()).toBe(false); expect(r.start).not.toHaveBeenCalled();
    expect(await envelope.creation.receipt.settled).toBe(false);
    expect((await r.outbox.list())[0].opId).toBe(envelope.creation.opId);
  });

  it('keeps the captured disposed tracker from notifying a newly signed-in account', async () => {
    const r = await rig(), holdJournal = gate();
    const newTracker = new WriteTracker(), notices = vi.fn(); newTracker.subscribe(notices); notices.mockClear();
    const creation = submitVehicleCreation({ ...r.options, journal: async settled => { await holdJournal.promise; return r.options.journal(settled); } });
    r.tracker.dispose(); holdJournal.resolve(); const envelope = await r.handoff.promise;
    r.accepted.resolve(); await creation; r.server.resolve(); expect(await envelope.creation.receipt.settled).toBe(true);
    expect(notices).not.toHaveBeenCalled(); expect(newTracker.status().pending).toEqual([]);
  });

  it('coalesces simultaneous retrySelection calls onto one selection attempt', async () => {
    const r = await rig(), selection = gate<VehicleSelectionResult>();
    const creation = submitVehicleCreation(r.options), envelope = await r.handoff.promise;
    r.accepted.resolve(); await creation; r.server.resolve(); await envelope.selection;
    r.select.mockImplementationOnce(() => selection.promise);
    const first = envelope.retrySelection(), second = envelope.retrySelection(); expect(first).toBe(second);
    selection.resolve({ state: 'not-required', reason: 'newer-choice' });
    expect(await first).toEqual({ state: 'not-required', reason: 'newer-choice' }); expect(r.select).toHaveBeenCalledTimes(2);
  });
});
