/**
 * Design v3, stage 5: the three new stored fields.
 *  - `excluded` on vehicleExpenses ("לכלול בעלות הרכב" switched off)
 *  - `biz` on a vehicle (business statement metadata)
 *  - EV registry fields on a vehicle (`powertrain`, `battery`, `motorKw`)
 * Each is optional; documents written before the field existed stay valid.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteField, doc, setDoc, updateDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-design-v3-fields', firestore: {
    host: '127.0.0.1', port: Number(process.env.RULES_FIRESTORE_PORT ?? 8080), rules: readFileSync('firestore.rules', 'utf8') } });
}, 60000);
afterAll(async () => { await env?.cleanup(); });
const vehicle = { make: 'Test', model: 'Car', fuelType: '95', archived: false, priceAdjustment: 0 };
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'users/alice/vehicles/v'), vehicle); });
});
const owner = () => env.authenticatedContext('alice').firestore();
const expense = { schemaVersion: 1, version: 1, title: 'דוח חניה', day: '2026-10-19', category: 'other', costAgorot: 25000, notes: '' };
const expensePath = (id = 'e') => `users/alice/vehicles/v/vehicleExpenses/${id}`;
const vehiclePath = 'users/alice/vehicles/v';

describe('vehicleExpenses.excluded', () => {
  it('accepts true, false and missing', async () => {
    await assertSucceeds(setDoc(doc(owner(), expensePath('missing')), expense));
    await assertSucceeds(setDoc(doc(owner(), expensePath('true')), { ...expense, excluded: true }));
    await assertSucceeds(setDoc(doc(owner(), expensePath('false')), { ...expense, excluded: false }));
  });
  it('rejects a non-boolean value', async () => {
    for (const excluded of ['yes', 1, 0, null, { value: true }, ['x']]) {
      await assertFails(setDoc(doc(owner(), expensePath()), { ...expense, excluded }));
    }
  });
  it('an existing document without the field stays editable; the flag can be set and removed', async () => {
    await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), expensePath()), expense); });
    await assertSucceeds(updateDoc(doc(owner(), expensePath()), { version: 2, notes: 'עריכה' }));
    await assertSucceeds(updateDoc(doc(owner(), expensePath()), { version: 3, excluded: true }));
    await assertSucceeds(updateDoc(doc(owner(), expensePath()), { version: 4, excluded: deleteField() }));
    await assertFails(updateDoc(doc(owner(), expensePath()), { version: 5, excluded: 'no' }));
  });
  it('other care records still refuse the field', async () => {
    const mileage = { schemaVersion: 1, version: 1, day: '2026-10-19', odometer: 120000, notes: '' };
    await assertFails(setDoc(doc(owner(), 'users/alice/vehicles/v/odometerReadings/o'), { ...mileage, excluded: true }));
  });
});

describe('vehicle.biz', () => {
  it('accepts missing, null, empty and a complete map', async () => {
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { nickname: 'x' }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { biz: null }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { biz: {} }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { biz: { company: 'א.ב. הובלות בע״מ', driver: 'דנה', usagePct: 80 } }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { biz: { usagePct: 0 } }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { biz: { usagePct: 100, company: '' } }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { biz: { usagePct: 37.5 } }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { biz: deleteField() }));
  });
  it('rejects unknown keys, wrong types and out-of-range usage', async () => {
    for (const biz of [
      'company', 5, { company: 5 }, { driver: true }, { usagePct: -1 }, { usagePct: 101 }, { usagePct: '80' },
      { company: 'x'.repeat(121) }, { driver: 'x'.repeat(81) }, { company: 'x', vatId: '123' },
    ]) await assertFails(updateDoc(doc(owner(), vehiclePath), { biz }));
  });
});

describe('vehicle EV fields', () => {
  const ev = { powertrain: 'ev', battery: { kwh: 60.5, wltp: 420 }, motorKw: 150 };
  it('existing vehicles without the fields stay valid, and the fields can be added', async () => {
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { nickname: 'ללא שדות חשמל' }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), ev));
    await assertSucceeds(setDoc(doc(owner(), 'users/alice/vehicles/e'), { ...vehicle, fuelType: 'other', ...ev }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { powertrain: 'ice', battery: null, motorKw: null }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { powertrain: null }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { battery: { kwh: 75 } }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { battery: { kwh: null, wltp: 500 } }));
  });
  it('rejects unknown powertrains, malformed batteries and implausible motors', async () => {
    for (const patch of [
      { powertrain: 'hydrogen' }, { powertrain: 1 },
      { battery: 60 }, { battery: { kwh: 0 } }, { battery: { kwh: -5 } }, { battery: { kwh: 501 } }, { battery: { kwh: '60' } },
      { battery: { wltp: 0 } }, { battery: { wltp: 2001 } }, { battery: { kwh: 60, chemistry: 'LFP' } },
      { motorKw: 0 }, { motorKw: -1 }, { motorKw: 2001 }, { motorKw: '150' },
    ]) await assertFails(updateDoc(doc(owner(), vehiclePath), patch));
  });
  it('a fully populated vehicle with documents, biz and EV fields stays within the rules budget', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'users/alice/vehicles/full'), {
      ...vehicle, fuelType: 'other', year: 2024, plateNumber: '12345678', nickname: 'האטו', tankLiters: 60, tankLitersSource: 'user',
      declaredKmPerLiter: 7, declaredSource: 'user', manualPricePerLiter: null, tozeretCd: 1014, degemCd: 3,
      priceDiscount: { kind: 'amount', value: 0.2 },
      tankPrefs: { reserveFraction: 0.15, refuelLevelOverride: 0.25, usualFillStyle: 'full', usualRefuelLevel: 0.2, habitResetAt: 1700000000000 },
      ...ev, biz: { company: 'חברה', driver: 'נהג', usagePct: 60 },
    }));
  });
  it('a maximum vehicle with documents can add biz/EV fields, and keeps editing docs afterwards', async () => {
    const maximum = { ...vehicle, make: 'M'.repeat(60), model: 'X'.repeat(80), nickname: 'N'.repeat(60), plateNumber: '1'.repeat(12), year: 2100,
      priceDiscount: { kind: 'percent', value: 100 }, tankLiters: 60, tankLitersSource: 'trusted', declaredKmPerLiter: 17.123456,
      declaredSource: 'exact-year', manualPricePerLiter: 8.123456, tozeretCd: 1, degemCd: 2, deletionPending: false,
      tankPrefs: { reserveFraction: .2, refuelLevelOverride: .3, usualFillStyle: 'full', usualRefuelLevel: .2, habitResetAt: 1_800_000_000_000 },
      docs: { test: { due: '2199-12-31' }, mandatory: { insurer: 'A'.repeat(160), cost: 1_000_000, due: '2000-02-29' }, coverage: { type: 'comprehensive', insurer: 'B'.repeat(160), cost: 999_999.123456, due: '2028-02-29' } } };
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), vehiclePath), maximum));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { ...ev, biz: { company: 'C'.repeat(120), driver: 'D'.repeat(80), usagePct: 100 } }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { docs: { test: { due: '1900-01-01' }, mandatory: { insurer: 'C', cost: 0, due: '2096-02-29' }, coverage: { type: 'third', insurer: 'D', cost: 1234.56789, due: '2104-02-29' } } }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { nickname: 'still editable' }));
  });
  // Stage 5 UI: the v3 fields are a separate conjunct of validVehicleWrite, so
  // a single patch that changes `docs` and a v3 field validates both.
  const maximum = { ...vehicle, make: 'M'.repeat(60), model: 'X'.repeat(80), nickname: 'N'.repeat(60), plateNumber: '1'.repeat(12), year: 2100,
    priceDiscount: { kind: 'percent', value: 100 }, tankLiters: 60, tankLitersSource: 'trusted', declaredKmPerLiter: 17.123456,
    declaredSource: 'exact-year', manualPricePerLiter: 8.123456, tozeretCd: 1, degemCd: 2, deletionPending: false,
    tankPrefs: { reserveFraction: .2, refuelLevelOverride: .3, usualFillStyle: 'full', usualRefuelLevel: .2, habitResetAt: 1_800_000_000_000 },
    docs: { test: { due: '2199-12-31' }, mandatory: { insurer: 'A'.repeat(160), cost: 1_000_000, due: '2000-02-29' }, coverage: { type: 'comprehensive', insurer: 'B'.repeat(160), cost: 999_999.123456, due: '2028-02-29' } } };
  const changedDocs = { test: { due: '1900-01-01' }, mandatory: { insurer: 'C', cost: 0, due: '2096-02-29' }, coverage: { type: 'third', insurer: 'D', cost: 1234.56789, due: '2104-02-29' } };
  const maxBiz = { company: 'C'.repeat(120), driver: 'D'.repeat(80), usagePct: 100 };
  it('one patch that changes a document row and every v3 field is accepted, even on a maximum vehicle', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), vehiclePath), maximum));
    // Clients write one document row per patch ('docs.<key>').
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { 'docs.mandatory': changedDocs.mandatory, ...ev, biz: maxBiz }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { 'docs.coverage': changedDocs.coverage, biz: null, battery: { kwh: 0.1, wltp: 2000 }, motorKw: 2000 }));
    // Stored v3 fields cost nothing on a later docs-only patch, all three rows included.
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { docs: maximum.docs }));
    // A typical vehicle can change all three rows and every v3 field at once.
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), vehiclePath), { ...vehicle, nickname: 'רכב', year: 2024, docs: maximum.docs }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { docs: changedDocs, ...ev, biz: maxBiz }));
  });
  it('fails closed when a combined patch would exceed the expression budget', async () => {
    // Every optional vehicle field, three changed document rows and four v3
    // fields in one write is more than 1,000 expressions. It is refused,
    // never accepted unvalidated. No client writes this shape.
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), vehiclePath), maximum));
    await assertFails(updateDoc(doc(owner(), vehiclePath), { docs: changedDocs, ...ev, biz: maxBiz }));
  });
  it('a patch that changes docs still rejects an invalid biz, battery, powertrain or motor', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), vehiclePath), maximum));
    for (const patch of [
      { biz: { usagePct: 101 } }, { biz: { company: 'x'.repeat(121) } }, { biz: { company: 'x', vatId: '1' } }, { biz: 'company' },
      { battery: { kwh: 0 } }, { battery: { kwh: 501 } }, { battery: { wltp: 2001 } }, { battery: { kwh: '60' } }, { battery: { kwh: 60, chemistry: 'LFP' } },
      { powertrain: 'hydrogen' }, { motorKw: 0 }, { motorKw: '150' },
      { ...ev, biz: { ...maxBiz, usagePct: -1 } },
    ]) {
      await assertFails(updateDoc(doc(owner(), vehiclePath), { 'docs.mandatory': changedDocs.mandatory, ...patch }));
      await assertFails(updateDoc(doc(owner(), vehiclePath), { docs: changedDocs, ...patch }));
    }
    // Same patches on a small vehicle (cheap path) are rejected too.
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), vehiclePath), { ...vehicle, docs: { test: { due: '2027-01-01' } } }));
    await assertFails(updateDoc(doc(owner(), vehiclePath), { docs: { test: { due: '2028-01-01' } }, battery: { kwh: 501 } }));
    await assertFails(updateDoc(doc(owner(), vehiclePath), { docs: { test: { due: '2028-01-01' } }, biz: { usagePct: 101 } }));
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { docs: { test: { due: '2028-01-01' } }, battery: { kwh: 64.8 }, biz: { usagePct: 50 } }));
  });
  it('the inlined finite-number checks still refuse NaN, infinities and strings', async () => {
    for (const patch of [{ priceAdjustment: NaN }, { priceAdjustment: Infinity }, { priceAdjustment: -Infinity }, { priceAdjustment: '0' },
      { priceAdjustment: 9_999_999_999 }, { priceAdjustment: -9_999_999_999 }, { tozeretCd: NaN }, { tozeretCd: Infinity }, { degemCd: -Infinity }, { degemCd: '3' }]) {
      await assertFails(updateDoc(doc(owner(), vehiclePath), patch));
    }
    await assertSucceeds(updateDoc(doc(owner(), vehiclePath), { priceAdjustment: -9_999_999_998, tozeretCd: 9_999_999_998, degemCd: null }));
  });
  it('a created vehicle with docs and invalid v3 fields is rejected', async () => {
    const created = { ...vehicle, fuelType: 'other', docs: { test: { due: '2027-01-01' } } };
    await assertSucceeds(setDoc(doc(owner(), 'users/alice/vehicles/c1'), { ...created, ...ev }));
    await assertFails(setDoc(doc(owner(), 'users/alice/vehicles/c2'), { ...created, battery: { kwh: 501 } }));
    await assertFails(setDoc(doc(owner(), 'users/alice/vehicles/c3'), { ...created, biz: { usagePct: 101 } }));
  });
});
