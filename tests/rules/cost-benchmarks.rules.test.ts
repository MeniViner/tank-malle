import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, type Firestore } from 'firebase/firestore';
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
const hooks = vi.hoisted(() => ({ beforeTransaction: null as null | (() => Promise<void>) }));
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, runTransaction: async (...args: Parameters<typeof actual.runTransaction>) => {
    await hooks.beforeTransaction?.(); return actual.runTransaction(...args);
  } };
});
import { publishCostBenchmark, withdrawCostBenchmarks, withdrawVehicleCost } from '../../src/lib/costBenchmarks';
import { calculateTco } from '../../src/lib/tco';
import { buildLedger } from '../../src/lib/vehicle/derived';
import { EMPTY_CARE } from '../../src/lib/maintenance/model';
import { EMPTY_EXTRA } from '../../src/lib/vehicle/model';
import type { Vehicle } from '../../src/lib/types';
let env: RulesTestEnvironment;
const car = { id: 'v', make: 'Toyota', model: 'Corolla', fuelType: '95', archived: false, priceAdjustment: 0,
  docs: { mandatory: { cost: 1200 }, coverage: { type: 'none' }, test: { cost: 1200 } } } as Vehicle;
const summary = (patch = {}) => ({ vehicleId: 'v', modelKey: 'toyota corolla', fuelType: '95', monthlyCost: 810.123456, months: 2, method: 1, updatedAt: serverTimestamp(), ...patch });
const owner = () => env.authenticatedContext('alice').firestore() as unknown as Firestore;
const ref = (database = owner(), id = 'alice__v') => doc(database, 'costBenchmarks', id);
const seed = (settings: Record<string, unknown> = { shareTcoBenchmarks: true }, used = true) => env.withSecurityRulesDisabled(async context => {
  await setDoc(doc(context.firestore(), 'users/alice'), { settings, costSharingUsed: used });
  await setDoc(doc(context.firestore(), 'users/alice/vehicles/v'), car);
});
const full = () => calculateTco({ today: '2026-11-04', kmPerDay: null, docs: car.docs,
  ledger: buildLedger([{ id: 'f', date: +new Date('2026-11-04T12:00:00Z'), odometer: 100000, liters: 20, totalCost: 120.123456, pricePerLiter: 6, isFullTank: true }], [], EMPTY_CARE, EMPTY_EXTRA) });
beforeAll(async () => { env = await initializeTestEnvironment({ projectId: 'demo-cost-sharing-rules', firestore: {
  host: '127.0.0.1', port: Number(process.env.RULES_FIRESTORE_PORT ?? 8080), rules: readFileSync('firestore.rules', 'utf8') } }); }, 60000);
beforeEach(async () => { hooks.beforeTransaction = null; await env.clearFirestore(); });
afterAll(async () => { await env?.cleanup(); });

describe('separate optional ownership-cost publication', () => {
  it.each([undefined, false, 'true', 1])('refuses cost publication without explicit boolean consent: %s', consent => {
    return seed(consent === undefined ? { shareBenchmarks: true } : { shareBenchmarks: true, shareTcoBenchmarks: consent }).then(() => assertFails(setDoc(ref(), summary())));
  });
  it('allows an exact narrow cost aggregate independently of fuel sharing', async () => {
    await seed({ shareBenchmarks: false, shareTcoBenchmarks: true });
    await assertSucceeds(setDoc(ref(), summary()));
    expect((await getDoc(ref())).data()?.monthlyCost).toBe(810.123456);
  });
  it.each(['name', 'email', 'plateNumber', 'parts', 'receipts', 'insurer', 'uid', 'perKm'])('rejects unapproved disclosure field %s', async field => {
    await seed(); await assertFails(setDoc(ref(), summary({ [field]: 'private' })));
  });
  it('rejects unsupported methods, windows, prices, metadata and client-authored update times', async () => {
    await seed();
    for (const patch of [{ monthlyCost: 0 }, { monthlyCost: -1 }, { monthlyCost: NaN }, { monthlyCost: Infinity }, { monthlyCost: 1000000.01 },
      { monthlyCost: '810' }, { months: 0 }, { months: 13 }, { months: 1.5 }, { method: 2 }, { updatedAt: Timestamp.fromMillis(1) },
      { modelKey: '' }, { modelKey: 'x'.repeat(81) }, { vehicleId: '' }, { fuelType: 'unknown' }]) await assertFails(setDoc(ref(), summary(patch)));
    const missing = summary(); delete (missing as Partial<typeof missing>).monthlyCost;
    await assertFails(setDoc(ref(), missing));
  });
  it('binds writes to an owned existing vehicle and its fuel type', async () => {
    await seed();
    await assertFails(setDoc(ref(owner(), 'bob__v'), summary()));
    await assertFails(setDoc(ref(owner(), 'alice__other'), summary()));
    await assertFails(setDoc(ref(), summary({ fuelType: 'diesel' })));
    await assertFails(setDoc(ref(owner(), 'alice__missing'), summary({ vehicleId: 'missing' })));
    const bob = env.authenticatedContext('bob').firestore() as unknown as Firestore;
    await assertFails(setDoc(ref(bob), summary()));
  });
  it('refuses reads, writes and deletions by signed-out clients', async () => {
    await seed(); const anonymous = env.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(getDoc(ref(anonymous))); await assertFails(setDoc(ref(anonymous), summary())); await assertFails(deleteDoc(ref(anonymous)));
  });
  it('permits pseudonymous reads by signed-in peers but no foreign mutation', async () => {
    await seed(); await setDoc(ref(), summary());
    const bob = env.authenticatedContext('bob').firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(ref(bob))); await assertFails(deleteDoc(ref(bob))); await assertFails(updateDoc(ref(bob), { monthlyCost: 10 }));
  });
  it('blocks old publishers after server opt-out while allowing owner withdrawal', async () => {
    await seed(); await setDoc(ref(), summary());
    await updateDoc(doc(owner(), 'users/alice'), { 'settings.shareTcoBenchmarks': false });
    await assertFails(setDoc(ref(), summary()));
    expect(await withdrawCostBenchmarks('alice', owner())).toBe(true);
    expect((await getDoc(ref())).exists()).toBe(false);
    expect(await publishCostBenchmark('alice', car, full(), () => true, owner())).toBe(false);
  });
  it('withdraws every owned vehicle including orphaned rows and preserves peers', async () => {
    await seed({ shareTcoBenchmarks: false });
    await env.withSecurityRulesDisabled(async context => {
      for (const [uid, vehicleId] of [['alice', 'v'], ['alice', 'archived'], ['alice', 'orphan'], ['bob', 'peer'], ['alice__another-account', 'peer']]) {
        await setDoc(doc(context.firestore(), 'costBenchmarks', `${uid}__${vehicleId}`), summary({ vehicleId }));
      }
    });
    expect(await withdrawCostBenchmarks('alice', owner())).toBe(true);
    expect((await getDocs(collection(owner(), 'costBenchmarks'))).docs.map(row => row.id)).toEqual(['alice__another-account__peer', 'bob__peer']);
  });
  it('withdraws a large garage without exceeding Rules batch access limits', async () => {
    await seed({ shareTcoBenchmarks: false });
    await env.withSecurityRulesDisabled(async context => {
      for (let index = 0; index < 23; index++) {
        const vehicleId = `old-${index}`;
        await setDoc(doc(context.firestore(), 'costBenchmarks', `alice__${vehicleId}`), summary({ vehicleId }));
      }
    });
    expect(await withdrawCostBenchmarks('alice', owner())).toBe(true);
    expect((await getDocs(collection(owner(), 'costBenchmarks'))).empty).toBe(true);
  });

  it('a late withdrawal does not erase a summary after a fresh opt-in', async () => {
    await seed({ shareTcoBenchmarks: false });
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'costBenchmarks/alice__v'), summary()));
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
    hooks.beforeTransaction = async () => { enter(); await barrier; };
    const withdrawal = withdrawCostBenchmarks('alice', owner());
    await entered;
    await updateDoc(doc(owner(), 'users/alice'), { 'settings.shareTcoBenchmarks': true });
    await setDoc(ref(), summary({ monthlyCost: 1234 }));
    release(); expect(await withdrawal).toBe(false);
    expect((await getDoc(ref())).data()?.monthlyCost).toBe(1234);
  });
  it('publishes from complete data with server consent and exact unchanged document source', async () => {
    await seed({ shareTcoBenchmarks: true }, false); expect(await publishCostBenchmark('alice', car, full(), () => true, owner())).toBe(true);
    const data = (await getDoc(ref())).data()!;
    expect(data.monthlyCost).toBe(full().month); expect(data.updatedAt).toBeInstanceOf(Timestamp);
    expect(Object.keys(data).sort()).toEqual(['fuelType', 'method', 'modelKey', 'monthlyCost', 'months', 'updatedAt', 'vehicleId']);
    await updateDoc(doc(owner(), 'users/alice/vehicles/v'), { 'docs.test.cost': 2400 });
    expect(await publishCostBenchmark('alice', car, full(), () => true, owner())).toBe(false);
  });
  it('does not publish after the captured account/vehicle lifetime becomes stale', async () => {
    await seed(); let calls = 0;
    expect(await publishCostBenchmark('alice', car, full(), () => ++calls === 1, owner())).toBe(false);
    expect((await getDoc(ref())).exists()).toBe(false);
  });
  it('refuses new publications during account deletion and allows removal', async () => {
    await seed(); await setDoc(ref(), summary());
    await updateDoc(doc(owner(), 'users/alice'), { deletionPending: true, costDeletionAttemptAt: serverTimestamp(), 'settings.shareTcoBenchmarks': false });
    await assertFails(setDoc(ref(), summary()));
    expect(await withdrawCostBenchmarks('alice', owner())).toBe(true);
  });
  it.each(['archived', 'deletionPending'])('blocks publication for %s vehicles', async field => {
    await seed(); await updateDoc(doc(owner(), 'users/alice/vehicles/v'), { [field]: true });
    await assertFails(setDoc(ref(), summary()));
  });
  it('refuses old-client account deletion after cost sharing, including a stale modern retry marker', async () => {
    await seed(); await setDoc(ref(), summary());
    await assertFails(updateDoc(doc(owner(), 'users/alice'), { deletionPending: true }));
    await assertFails(deleteDoc(doc(owner(), 'users/alice')));
    await assertFails(updateDoc(doc(owner(), 'users/alice'), { costSharingUsed: false }));
    await assertFails(updateDoc(doc(owner(), 'users/alice'), { deletionPending: true, costDeletionAttemptAt: Timestamp.fromMillis(1), 'settings.shareTcoBenchmarks': false }));
    await assertSucceeds(updateDoc(doc(owner(), 'users/alice'), { deletionPending: true, costDeletionAttemptAt: serverTimestamp(), 'settings.shareTcoBenchmarks': false }));
    await assertFails(updateDoc(doc(owner(), 'users/alice'), { deletionPending: true }));
    expect(await withdrawCostBenchmarks('alice', owner())).toBe(true);
    await assertSucceeds(deleteDoc(doc(owner(), 'users/alice')));
  });
  it('requires the private cleanup marker to accompany a first public cost write', async () => {
    await seed({ shareTcoBenchmarks: true }, false);
    await assertFails(setDoc(ref(), summary()));
    expect(await publishCostBenchmark('alice', car, full(), () => true, owner())).toBe(true);
    expect((await getDoc(doc(owner(), 'users/alice'))).data()?.costSharingUsed).toBe(true);
  });

  it('requires cost erasure before a vehicle can disappear', async () => {
    await seed(); await setDoc(ref(), summary());
    await assertFails(deleteDoc(doc(owner(), 'users/alice/vehicles/v')));
    await withdrawVehicleCost('alice', 'v', owner());
    await assertSucceeds(deleteDoc(doc(owner(), 'users/alice/vehicles/v'))); expect((await getDoc(ref())).exists()).toBe(false);
  });
});
