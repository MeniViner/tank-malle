import { describe, expect, it } from 'vitest';
import type { OutboxOperation, OutboxPayload } from './outbox';
import {
  isVehicleEnrichmentOperation,
  isVehicleEnrichmentPatch,
  recoveryGroupsWithVehicleEnrichment,
  vehicleEnrichmentDecision,
  vehicleEnrichmentVerdict,
  vehicleSpecIdentityMatches,
} from './vehicleEnrichment';

const base: OutboxPayload = Object.freeze({
  make: 'יונדאי', model: 'I20 INSPIRE', year: 2012, plateNumber: '1234567', fuelType: '95',
  archived: false, createdAt: 1_700_000_000_000,
  tankLiters: null, tankLitersSource: null, tankSourceUrl: null,
  declaredKmPerLiter: null, declaredSource: null, specSourceUrl: null,
});
const proposed: OutboxPayload = Object.freeze({
  tankLiters: 45, tankLitersSource: 'trusted', tankSourceUrl: 'https://example.test/tank',
  declaredKmPerLiter: 16.4, declaredSource: 'co2-estimate', specSourceUrl: 'https://example.test/spec',
});
const operation = (overrides: Partial<OutboxOperation> = {}): OutboxOperation => ({
  uid: 'owner', vehicleId: 'v1', opId: 'spec-op', docId: 'v1', path: 'users/owner/vehicles/v1',
  docKey: 'owner|users/owner/vehicles/v1', kind: 'vehicle.update', opType: 'update',
  payload: proposed, beforeImage: base, revision: 1, version: 1, status: 'pending',
  error: null, attempts: 1, createdAt: 1, updatedAt: 1, clientVersion: 'test', ...overrides,
});

describe('automatic missing vehicle specifications', () => {
  it('fills unchanged missing fields with their own provenance without mutating inputs', () => {
    expect(vehicleEnrichmentDecision(proposed, base, base)).toEqual({ state: 'update', patch: proposed });
    expect(base.tankLiters).toBeNull();
    expect(proposed.tankLiters).toBe(45);
  });

  it('never overwrites the actual manual values from the reload race', () => {
    const manual = { ...base, tankLiters: 47, tankLitersSource: 'user', declaredKmPerLiter: 14.8, declaredSource: 'user' };
    expect(vehicleEnrichmentDecision(proposed, base, manual)).toEqual({ state: 'complete' });
    expect(vehicleEnrichmentVerdict(operation({ status: 'failed' }), manual)).toEqual({ opId: 'spec-op', version: 1, verdict: 'synced' });
    expect(manual).toMatchObject({ tankLiters: 47, tankLitersSource: 'user', declaredKmPerLiter: 14.8, declaredSource: 'user' });
  });

  it('keeps user-owned nulls and populated values even if provenance is absent', () => {
    expect(vehicleEnrichmentDecision(proposed, base, { ...base, tankLitersSource: 'user', declaredSource: 'user' })).toEqual({ state: 'complete' });
    expect(vehicleEnrichmentDecision(proposed, base, { ...base, tankLiters: 47, declaredKmPerLiter: 14.8 })).toEqual({ state: 'complete' });
    const cleared = { ...base, tankLitersSource: 'user', declaredSource: 'user' };
    expect(vehicleEnrichmentDecision(proposed, cleared, cleared)).toEqual({ state: 'complete' });
  });

  it('can fill an unchanged consumption group while leaving the entire tank group untouched', () => {
    const current = { ...base, tankLiters: 47, tankLitersSource: 'user', tankSourceUrl: 'my-source' };
    expect(vehicleEnrichmentDecision(proposed, base, current)).toEqual({ state: 'update', patch: {
      declaredKmPerLiter: 16.4, declaredSource: 'co2-estimate', specSourceUrl: 'https://example.test/spec',
    } });
  });

  it('a source or URL change protects that whole group, even while its numeric field is empty', () => {
    const current = { ...base, tankSourceUrl: 'new-source', declaredSource: 'other-year' };
    expect(vehicleEnrichmentDecision(proposed, base, current)).toEqual({ state: 'complete' });
  });

  it('does not equate an absent raw field with a later explicit null', () => {
    const original: OutboxPayload = { make: base.make, model: base.model, fuelType: '95' };
    const tankOnly = { tankLiters: 45, tankLitersSource: 'trusted' };
    expect(vehicleEnrichmentDecision(tankOnly, original, original).state).toBe('update');
    expect(vehicleEnrichmentDecision(tankOnly, original, { ...original, tankLiters: null })).toEqual({ state: 'complete' });
  });

  it.each([
    { make: 'פורד' }, { model: 'I30' }, { year: 2013 }, { plateNumber: '7654321' },
    { fuelType: 'diesel' }, { tozeretCd: 502 }, { degemCd: 81 }, { createdAt: 1_700_000_000_001 },
  ])('invalidates the original lookup when identity changes: %j', change => {
    expect(vehicleEnrichmentDecision(proposed, base, { ...base, ...change })).toEqual({ state: 'complete' });
  });

  it('does not recreate a deleted, deleting or archived vehicle', () => {
    for (const server of [null, { ...base, deletionPending: true }, { ...base, archived: true }]) {
      expect(vehicleEnrichmentDecision(proposed, base, server)).toEqual({ state: 'complete' });
    }
  });

  it('fails closed without a readable raw original identity', () => {
    for (const before of [null, {}, { ...base, fuelType: undefined }, { ...base, fuelType: 95 }, { ...base, make: 123 }]) {
      expect(vehicleEnrichmentDecision(proposed, before, base)).toEqual({ state: 'unverified' });
    }
    expect(vehicleEnrichmentVerdict(operation({ beforeImage: null }), base).verdict).toBe('unconfirmed');
  });

  it('normalizes only vehicle-reader identity defaults and server timestamps', () => {
    expect(vehicleSpecIdentityMatches(base, { ...base, createdAt: { seconds: 1_700_000_000, nanoseconds: 0 } })).toBe(true);
    expect(vehicleSpecIdentityMatches(base, { ...base, year: '2012' })).toBe(false);
  });

  it('excludes ordinary explicit save, capacity confirmation, discount and preferences payloads', () => {
    const edits = [
      { ...proposed, make: base.make, model: base.model, year: base.year, plateNumber: base.plateNumber, fuelType: '95', nickname: 'הרכב' },
      { tankLiters: 47, tankLitersSource: 'user' },
      { priceDiscount: { kind: 'amount', value: 0.2 }, priceAdjustment: 0, manualPricePerLiter: null },
      { tankPrefs: { reserveLiters: 5 } },
    ];
    expect(edits.every(payload => !isVehicleEnrichmentPatch(payload))).toBe(true);
  });

  it('requires complete valid own-property groups', () => {
    const invalid = [null, {}, { tankLiters: 45 }, { tankLitersSource: 'trusted' },
      { tankLiters: NaN, tankLitersSource: 'trusted' },
      { declaredKmPerLiter: 16.4, declaredSource: 'other-year' },
      { declaredKmPerLiter: 16.4, declaredSource: 'co2-estimate', specSourceUrl: 7 },
      { tozeretCd: 1.5 }, { tozeretCd: 0 },
      Object.assign(Object.create({ tankLitersSource: 'trusted' }), { tankLiters: 45 }) as OutboxPayload];
    expect(invalid.every(payload => !isVehicleEnrichmentPatch(payload))).toBe(true);
    expect(isVehicleEnrichmentPatch({ tozeretCd: 502, degemCd: 81 })).toBe(true);
  });

  it('binds automatic recovery to the exact account and vehicle document', () => {
    expect(isVehicleEnrichmentOperation(operation())).toBe(true);
    for (const change of [
      { kind: 'settings.update' as const }, { opType: 'set' as const }, { uid: 'other' },
      { path: 'users/owner/vehicles/v2' }, { vehicleId: 'v2' }, { docId: 'v2' }, { docKey: 'wrong' },
    ]) expect(isVehicleEnrichmentOperation(operation(change))).toBe(false);
  });

  it('keeps both older and newer manual operations outside automatic no-op supersession', () => {
    const oldManual = operation({ opId: 'manual-old', revision: 1, payload: { nickname: 'ישן' } });
    const automatic = operation({ opId: 'auto', revision: 2 });
    const newManual = operation({ opId: 'manual-new', revision: 3, payload: { nickname: 'חדש' } });
    const groups = recoveryGroupsWithVehicleEnrichment([oldManual, automatic, newManual]);
    expect(groups).toHaveLength(2);
    expect(groups.find(group => group.newest.opId === 'auto')?.superseded).toEqual([]);
    expect(groups.find(group => group.newest.opId === 'manual-new')?.superseded.map(op => op.opId)).toEqual(['manual-old']);
    const onlyTwo = recoveryGroupsWithVehicleEnrichment([oldManual, automatic]);
    expect(onlyTwo.map(group => group.superseded)).toEqual([[], []]);
  });

  it('leaves an unapplied recoverable proposal unconfirmed rather than dispatching it', () => {
    expect(vehicleEnrichmentVerdict(operation(), base)).toMatchObject({ verdict: 'unconfirmed' });
    expect(vehicleEnrichmentVerdict(operation(), { ...base, ...proposed })).toEqual({ opId: 'spec-op', version: 1, verdict: 'synced' });
  });
});
