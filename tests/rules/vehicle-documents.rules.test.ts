import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, deleteField, doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
const path = 'users/alice/vehicles/v';
const base = { make: 'Toyota', model: 'Corolla', fuelType: '95', archived: false, priceAdjustment: 0 };
const ref = () => doc(env.authenticatedContext('alice').firestore(), path);
const seed = (patch: Record<string, unknown>) => env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), path), { ...base, ...patch }));
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-vehicle-documents-rules', firestore: {
    host: '127.0.0.1', port: Number(process.env.RULES_FIRESTORE_PORT ?? 8080), rules: readFileSync('firestore.rules', 'utf8'),
  } });
}, 60_000);
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env?.cleanup(); });

describe('optional vehicle licensing and insurance metadata', () => {
  it('accepts optional exact annual test costs, including zero and explicit clears', async () => {
    await seed({ docs: { test: { due: '2027-11-04', future: { keep: true } } } });
    for (const cost of [0, 1420.123456, 1000000, null]) {
      await assertSucceeds(updateDoc(ref(), { 'docs.test.cost': cost }));
      expect((await getDoc(ref())).data()?.docs.test).toEqual({ due: '2027-11-04', future: { keep: true }, cost });
    }
    await assertSucceeds(updateDoc(ref(), { 'docs.test.cost': deleteField() }));
    expect((await getDoc(ref())).data()?.docs.test).not.toHaveProperty('cost');
  });

  it('rejects nonnumeric, negative, nonfinite and unbounded annual test costs', async () => {
    await seed({ docs: { test: { cost: 1420 } } });
    for (const cost of ['1420', -1, NaN, Infinity, -Infinity, 1000000.01, {}]) {
      await assertFails(updateDoc(ref(), { 'docs.test.cost': cost }));
    }
    expect((await getDoc(ref())).data()?.docs.test.cost).toBe(1420);
  });

  it('preserves an unchanged legacy test cost during unrelated edits and validates only new intent', async () => {
    await seed({ docs: { test: { cost: 'legacy value', due: '2027-11-04', future: 9 } } });
    await assertSucceeds(updateDoc(ref(), { nickname: 'same original cost', 'docs.test.due': '2028-02-29' }));
    expect((await getDoc(ref())).data()?.docs.test).toEqual({ cost: 'legacy value', due: '2028-02-29', future: 9 });
    await assertFails(updateDoc(ref(), { 'docs.test.cost': 'another malformed value' }));
    await assertSucceeds(updateDoc(ref(), { 'docs.test.cost': 1420.123456 }));
  });

  it('keeps absent, null and empty documents optional without materializing defaults', async () => {
    await assertSucceeds(setDoc(ref(), base));
    expect((await getDoc(ref())).data()).not.toHaveProperty('docs');
    for (const docs of [null, {}, { test: null, mandatory: null, coverage: null }, { test: {}, mandatory: {}, coverage: {} }]) {
      await assertSucceeds(updateDoc(ref(), { docs }));
      expect((await getDoc(ref())).data()?.docs).toEqual(docs);
    }
    await assertSucceeds(updateDoc(ref(), { docs: deleteField() }));
    expect((await getDoc(ref())).data()).not.toHaveProperty('docs');
  });

  it('really creates a selected child under a null SDK root and leaves sibling nulls intact', async () => {
    await assertSucceeds(setDoc(ref(), { ...base, docs: null }));
    await assertSucceeds(updateDoc(ref(), { 'docs.test': { due: '2028-02-29' } }));
    expect((await getDoc(ref())).data()?.docs).toEqual({ test: { due: '2028-02-29' } });
    await assertSucceeds(updateDoc(ref(), { docs: { test: null, mandatory: null, future: { provider: 'retained' } } }));
    await assertSucceeds(updateDoc(ref(), { 'docs.mandatory': { insurer: 'A', due: '2027-11-03', cost: 1234.567891 } }));
    expect((await getDoc(ref())).data()?.docs).toEqual({ test: null, mandatory: { insurer: 'A', due: '2027-11-03', cost: 1234.567891 }, future: { provider: 'retained' } });
  });

  it('preserves exact zero and fractional yearly amounts with optional and unselected coverage types', async () => {
    const docs = { test: { due: null }, mandatory: { insurer: null, cost: 0 }, coverage: { type: null, insurer: ' ', cost: 1234.567891, due: null } };
    await assertSucceeds(setDoc(ref(), { ...base, docs }));
    expect((await getDoc(ref())).data()?.docs).toEqual(docs);
    for (const type of ['comprehensive', 'third', 'none']) await assertSucceeds(updateDoc(ref(), { 'docs.coverage.type': type }));
    expect((await getDoc(ref())).data()?.docs.coverage).toEqual({ ...docs.coverage, type: 'none' });
    await assertSucceeds(updateDoc(ref(), { 'docs.coverage.type': deleteField(), 'docs.mandatory.cost': 1_000_000 }));
    expect((await getDoc(ref())).data()?.docs.coverage).not.toHaveProperty('type');
  });

  it('allows unknown future keys at vehicle, root and row levels without loosening known leaves', async () => {
    const docs = { future: ['v3', { provider: 9 }], test: { due: '2026-12-31', futureCost: 'unknown test extension', type: 'future' }, mandatory: { type: 'future', source: { raw: 1 }, cost: 9.012345 }, coverage: { type: 'none', source: 'kept' } };
    await assertSucceeds(setDoc(ref(), { ...base, extraVehicle: { source: 'legacy' }, docs }));
    await assertSucceeds(updateDoc(ref(), { 'docs.mandatory.insurer': 'Changed' }));
    expect((await getDoc(ref())).data()?.docs).toEqual({ ...docs, mandatory: { ...docs.mandatory, insurer: 'Changed' } });
    await assertFails(updateDoc(ref(), { 'docs.coverage.type': 'future' }));
  });

  it('accepts all optional vehicle fields and three changed rows within the real expression budget', async () => {
    const maximum = { ...base, make: 'M'.repeat(60), model: 'X'.repeat(80), nickname: 'N'.repeat(60), plateNumber: '1'.repeat(12), year: 2100,
      priceDiscount: { kind: 'percent', value: 100 }, tankLiters: 60, tankLitersSource: 'trusted', declaredKmPerLiter: 17.123456,
      declaredSource: 'exact-year', manualPricePerLiter: 8.123456, tozeretCd: 1, degemCd: 2, deletionPending: false,
      tankPrefs: { reserveFraction: .2, refuelLevelOverride: .3, usualFillStyle: 'full', usualRefuelLevel: .2, habitResetAt: 1_800_000_000_000 },
      docs: { test: { due: '2199-12-31' }, mandatory: { insurer: 'A'.repeat(160), cost: 1_000_000, due: '2000-02-29' }, coverage: { type: 'comprehensive', insurer: 'B'.repeat(160), cost: 999_999.123456, due: '2028-02-29' } } };
    await assertSucceeds(setDoc(ref(), maximum));
    await assertSucceeds(updateDoc(ref(), { docs: { test: { due: '1900-01-01' }, mandatory: { insurer: 'C', cost: 0, due: '2096-02-29' }, coverage: { type: 'third', insurer: 'D', cost: 1234.56789, due: '2104-02-29' } } }));
    // A maximum-size legacy row must remain editable even when a later known
    // leaf is malformed and unchanged; the compatibility path also has a budget.
    const legacy = { ...maximum, docs: { ...maximum.docs, coverage: { ...maximum.docs.coverage, cost: NaN } } };
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), path), legacy));
    await assertSucceeds(updateDoc(ref(), { nickname: 'Legacy still belongs to its owner' }));
    await assertSucceeds(updateDoc(ref(), { docs: {
      test: { due: '2029-03-01' }, mandatory: { insurer: 'C', cost: 0, due: '2096-02-29' },
      coverage: { type: 'third', insurer: 'D', cost: NaN, due: '2104-02-29' },
    } }));
    expect((await getDoc(ref())).data()?.docs.coverage.cost).toBeNaN();
    const allMalformed = {
      test: { due: 'bad', future: 1 }, mandatory: { due: 'bad', insurer: 123, cost: NaN, future: 1 },
      coverage: { type: 'future-kind', due: 'bad', insurer: 456, cost: NaN, future: 1 },
    };
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), path), { ...maximum, docs: allMalformed }));
    await assertSucceeds(updateDoc(ref(), { 'docs.test.future': 2, 'docs.mandatory.future': 2, 'docs.coverage.future': 2 }));
    expect((await getDoc(ref())).data()?.docs).toEqual({ test: { ...allMalformed.test, future: 2 }, mandatory: { ...allMalformed.mandatory, future: 2 }, coverage: { ...allMalformed.coverage, future: 2 } });
  });

  it('retains the original optional vehicle-field bounds after the expression-cost refactor', async () => {
    const docs = { test: { due: '2028-02-29' }, mandatory: { insurer: 'A', cost: 1_000_000, due: '2027-11-03' }, coverage: { type: 'comprehensive', insurer: 'B', cost: 9.123456, due: '2027-11-04' } };
    for (const patch of [
      { tankLiters: null, declaredKmPerLiter: null, manualPricePerLiter: null, year: null, priceDiscount: null, tankPrefs: null, plateNumber: null, nickname: null, tankLitersSource: null, declaredSource: null, tozeretCd: null, degemCd: null },
      { tankLiters: .01, declaredKmPerLiter: .01, manualPricePerLiter: 0, year: 1900.5, tozeretCd: -1, degemCd: 2.5, plateNumber: '', nickname: '' },
      { tankLiters: 9_999_999_998, declaredKmPerLiter: 9_999_999_998, manualPricePerLiter: 9_999_999_998, year: 2100, priceDiscount: { kind: 'amount', value: 20 } },
      { priceDiscount: { kind: 'percent', value: 100 }, tankLitersSource: 'legacy', declaredSource: 'co2-estimate', deletionPending: false },
    ]) await assertSucceeds(setDoc(ref(), { ...base, ...patch, docs }));
    const bad: Record<string, unknown>[] = [
      { tankLiters: 0 }, { tankLiters: -1 }, { tankLiters: 9_999_999_999 }, { tankLiters: '50' },
      { declaredKmPerLiter: 0 }, { declaredKmPerLiter: NaN }, { declaredKmPerLiter: Infinity },
      { manualPricePerLiter: -.01 }, { manualPricePerLiter: 9_999_999_999 }, { manualPricePerLiter: '0' },
      { year: 1899.99 }, { year: 2100.01 }, { year: NaN }, { year: Infinity }, { year: '2026' },
      { tozeretCd: false }, { tozeretCd: -9_999_999_999 }, { degemCd: NaN },
      { plateNumber: '1'.repeat(13) }, { plateNumber: 123 }, { nickname: 'N'.repeat(61) }, { nickname: {} },
      { tankLitersSource: 'unknown' }, { declaredSource: 'estimate' }, { deletionPending: null },
      { priceDiscount: [] }, { priceDiscount: { kind: 'amount', value: 20.01 } }, { priceDiscount: { kind: 'percent', value: 100.01 } },
      { priceDiscount: { kind: 'amount', value: -.01 } }, { priceDiscount: { kind: 'percent', value: NaN } },
      { priceDiscount: { kind: 'amount', value: Infinity } }, { priceDiscount: { kind: 'amount', value: 1, future: true } },
      { tankPrefs: {} }, { tankPrefs: { reserveFraction: 0 } }, { tankPrefs: { reserveFraction: .2, future: true } },
    ];
    for (const patch of bad) await assertFails(setDoc(ref(), { ...base, ...patch, docs }));
    // Every optimized bounded vehicle predicate must still reject non-finite
    // values in the actual rules runtime, including both ends of each interval.
    for (const value of [NaN, Infinity, -Infinity]) {
      for (const patch of [
        { tankLiters: value }, { declaredKmPerLiter: value }, { manualPricePerLiter: value }, { year: value },
        { priceDiscount: { kind: 'amount', value } }, { priceDiscount: { kind: 'percent', value } },
        { tankPrefs: { reserveFraction: value } },
        { tankPrefs: { reserveFraction: .2, refuelLevelOverride: value } },
        { tankPrefs: { reserveFraction: .2, usualRefuelLevel: value } },
        { tankPrefs: { reserveFraction: .2, habitResetAt: value } },
      ]) await assertFails(setDoc(ref(), { ...base, ...patch, docs }));
      for (const key of ['mandatory', 'coverage']) {
        await assertFails(setDoc(ref(), { ...base, docs: { ...docs, [key]: { cost: value } } }));
      }
    }
  });

  for (const key of ['test', 'mandatory', 'coverage']) {
    it(`${key} rejects impossible civil dates and accepts the actual leap/calendar boundaries`, async () => {
      await assertSucceeds(setDoc(ref(), base));
      for (const due of ['1900-01-01', '2000-02-29', '2024-02-29', '2096-02-29', '2104-02-29', '2199-12-31', '2026-04-30', '2026-01-31', null]) {
        await assertSucceeds(updateDoc(ref(), { [`docs.${key}`]: { due } }));
      }
      for (const due of ['1899-12-31', '2200-01-01', '1900-02-29', '2100-02-29', '2026-02-29', '2026-04-31', '2026-06-31', '2026-09-31', '2026-11-31', '2026-00-10', '2026-13-10', '2026-12-00', '2026-12-32', '2026-2-01', '03/11/2026', '2026-11-03T00:00:00Z', '', 20, Timestamp.fromMillis(1_800_000_000_000)]) {
        await assertFails(updateDoc(ref(), { [`docs.${key}`]: { due } }));
      }
    });
  }

  it('rejects newly invalid roots, known rows, bounded strings, costs and coverage types', async () => {
    for (const docs of [[], 'bad', 1, true, Timestamp.fromMillis(1_800_000_000_000), { test: [] }, { mandatory: false }, { coverage: 'none' }]) {
      await assertFails(setDoc(ref(), { ...base, docs }));
    }
    await assertSucceeds(setDoc(ref(), base));
    for (const key of ['mandatory', 'coverage']) {
      for (const cost of [-.01, 1_000_000.0001, Infinity, -Infinity, NaN, '0', false, {}, []]) await assertFails(updateDoc(ref(), { [`docs.${key}`]: { cost } }));
      for (const insurer of ['A'.repeat(161), 1, false, [], {}]) await assertFails(updateDoc(ref(), { [`docs.${key}`]: { insurer } }));
    }
    for (const type of ['', 'other', false, 0, [], {}]) await assertFails(updateDoc(ref(), { 'docs.coverage': { type } }));
  });
});

describe('additive compatibility and deletion boundaries', () => {
  it('grandfathers unchanged malformed root and row values during nickname/archive edits', async () => {
    for (const docs of ['legacy', [], 1, NaN, Timestamp.fromMillis(1_800_000_000_000), { mandatory: 'legacy', coverage: [], test: false }]) {
      await seed({ docs });
      await assertSucceeds(updateDoc(ref(), { nickname: 'New name', archived: true }));
      const stored = (await getDoc(ref())).data();
      expect(stored?.docs).toEqual(docs);
    }
  });

  it('allows an unrelated known row, unknown child or changed valid leaf beside unchanged malformed leaves', async () => {
    const legacy = { mandatory: { due: 'impossible', insurer: 123, cost: NaN, future: { raw: true } }, coverage: 'legacy', test: false };
    await seed({ docs: legacy });
    await assertSucceeds(updateDoc(ref(), { 'docs.future': { new: 'extension' } }));
    await assertSucceeds(updateDoc(ref(), { 'docs.test': { due: '2028-02-29' } }));
    await assertSucceeds(updateDoc(ref(), { 'docs.mandatory.future': { raw: true, more: 9 } }));
    await assertSucceeds(updateDoc(ref(), { 'docs.mandatory.cost': 1234.56789 }));
    expect((await getDoc(ref())).data()?.docs.mandatory).toEqual({ ...legacy.mandatory, cost: 1234.56789, future: { raw: true, more: 9 } });
    await assertFails(updateDoc(ref(), { 'docs.mandatory.due': 'still impossible' }));
    await assertFails(updateDoc(ref(), { 'docs.mandatory.cost': -1 }));
    await assertFails(updateDoc(ref(), { 'docs.coverage': { type: 'bad' } }));
    await assertSucceeds(updateDoc(ref(), { 'docs.mandatory.insurer': null, 'docs.coverage': null, 'docs.test': deleteField() }));
  });

  it('rejects a newly invalid backup creation while preserving its JSON for review', async () => {
    const oldBackup = JSON.stringify({ ...base, docs: { mandatory: { cost: -10, due: 'legacy' } } });
    await assertFails(setDoc(ref(), JSON.parse(oldBackup)));
    expect((await getDoc(ref())).exists()).toBe(false);
    expect(JSON.parse(oldBackup).docs.mandatory).toEqual({ cost: -10, due: 'legacy' });
  });

  it('freezes every docs mutation when either image is deleting, leaving unrelated edits and owner deletion unchanged', async () => {
    const docs = { test: { due: '2028-02-29' }, future: 'kept' };
    await seed({ docs });
    await assertFails(updateDoc(ref(), { deletionPending: true, 'docs.test.due': '2029-03-01' }));
    await assertSucceeds(updateDoc(ref(), { deletionPending: true }));
    await assertSucceeds(updateDoc(ref(), { nickname: 'Still removable', archived: true }));
    for (const patch of [{ 'docs.test.due': '2029-03-01' }, { 'docs.future': 'changed' }, { docs: null }, { docs: deleteField() }, { 'docs.coverage': null }]) await assertFails(updateDoc(ref(), patch));
    await assertFails(updateDoc(ref(), { deletionPending: false }));
    await assertSucceeds(deleteDoc(ref()));
    await assertFails(setDoc(ref(), { ...base, deletionPending: true, docs: null }));
    await assertSucceeds(setDoc(ref(), { ...base, deletionPending: true }));
  });

  it('retains owner-only reads/writes and the deleting-account barrier', async () => {
    await assertSucceeds(setDoc(ref(), { ...base, docs: { mandatory: { insurer: 'Private', cost: 1900, due: '2027-11-03' } } }));
    for (const db of [env.unauthenticatedContext().firestore(), env.authenticatedContext('bob').firestore(), env.authenticatedContext('admin', { admin: true }).firestore()]) {
      const other = doc(db, path);
      await assertFails(getDoc(other));
      await assertFails(updateDoc(other, { 'docs.test': { due: '2028-02-29' } }));
      await assertFails(deleteDoc(other));
    }
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'users/alice'), { deletionPending: true }));
    await assertFails(updateDoc(ref(), { 'docs.test': { due: '2028-02-29' } }));
  });
});
