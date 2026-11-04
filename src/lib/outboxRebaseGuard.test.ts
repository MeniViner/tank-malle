import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { Outbox, type OutboxOperation } from './outbox';
import { rawDocumentMatches } from './rawDocument';

const boxes: Outbox[] = [];
afterEach(() => { for (const box of boxes.splice(0)) box.close(); });
async function conflict() {
  const options = { indexedDB: new IDBFactory(), storage: null, channel: null };
  const a = await Outbox.open('alice', 'test', options), b = await Outbox.open('alice', 'test', options);
  boxes.push(a, b);
  const operation = await a.enqueue({ kind: 'vehicle.update', opType: 'update', vehicleId: 'v', path: 'users/alice/vehicles/v',
    payload: { due: '2027-12-01', cost: 1234.567891 }, beforeImage: { due: '2026-12-01', cost: 0 } });
  await a.markConflict(operation.opId, operation.version, { due: '2026-12-02', cost: 0 });
  const reviewed = (await a.get(operation.opId))!;
  const accepts = (current: Readonly<OutboxOperation>) => rawDocumentMatches(current, reviewed);
  return { a, b, reviewed, accepts };
}

describe('optional atomic outbox rebase guard', () => {
  it('allows exactly one of two clients to rebase the same reviewed conflict', async () => {
    const { a, b, reviewed, accepts } = await conflict();
    const results = await Promise.all([
      a.rebase(reviewed.opId, reviewed.serverImage!, {}, accepts),
      b.rebase(reviewed.opId, reviewed.serverImage!, {}, accepts),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const stored = (await a.get(reviewed.opId))!;
    expect(stored.version).toBe(reviewed.version + 1);
    expect(stored.payload).toEqual(reviewed.payload);
    expect(stored.beforeImage).toEqual(reviewed.serverImage);
    expect(stored.status).toBe('conflict');
    expect(stored.serverImage).toBeNull();
  });

  it('does not replace a newer rebase or a new authored input after review', async () => {
    const { a, b, reviewed, accepts } = await conflict();
    await a.rebase(reviewed.opId, { due: '2026-12-03', cost: 0 }, { cost: 987.654321 });
    const newer = await b.get(reviewed.opId);
    expect(await b.rebase(reviewed.opId, reviewed.serverImage!, {}, accepts)).toBeNull();
    expect(await b.get(reviewed.opId)).toEqual(newer);
    await a.enqueue({ kind: reviewed.kind, opType: reviewed.opType, path: reviewed.path, vehicleId: reviewed.vehicleId,
      replaceOpId: reviewed.opId, payload: { due: '2028-01-01', cost: 0 }, beforeImage: { due: '2027-01-01', cost: 22.123456 } });
    const authored = await b.get(reviewed.opId);
    expect(await b.rebase(reviewed.opId, reviewed.serverImage!, {}, accepts)).toBeNull();
    expect(await b.get(reviewed.opId)).toEqual(authored);
  });

  it('refuses a refreshed server image even when its operation version did not change', async () => {
    const { a, b, reviewed, accepts } = await conflict();
    await b.markConflict(reviewed.opId, reviewed.version, { due: '2026-12-04', cost: 0 });
    const refreshed = (await a.get(reviewed.opId))!;
    expect(refreshed.version).toBe(reviewed.version);
    expect(await a.rebase(reviewed.opId, reviewed.serverImage!, {}, accepts)).toBeNull();
    expect(await a.get(reviewed.opId)).toEqual(refreshed);
  });

  it('checks the account lifetime after the actual transaction read', async () => {
    const { a, reviewed, accepts } = await conflict();
    let current = true, called = false;
    const pending = a.rebase(reviewed.opId, reviewed.serverImage!, {}, actual => { called = true; return current && accepts(actual); });
    current = false;
    expect(await pending).toBeNull();
    expect(called).toBe(true);
    expect(await a.get(reviewed.opId)).toEqual(reviewed);
  });

  it('does not mutate when a guard rejects, throws, or incorrectly returns a promise', async () => {
    const { a, reviewed } = await conflict();
    expect(await a.rebase(reviewed.opId, reviewed.serverImage!, {}, () => false)).toBeNull();
    await expect(a.rebase(reviewed.opId, reviewed.serverImage!, {}, () => { throw new Error('review invalid'); })).rejects.toThrow();
    const asynchronous = (() => Promise.resolve(true)) as unknown as (current: Readonly<OutboxOperation>) => boolean;
    expect(await a.rebase(reviewed.opId, reviewed.serverImage!, {}, asynchronous)).toBeNull();
    expect(await a.get(reviewed.opId)).toEqual(reviewed);
  });
});
