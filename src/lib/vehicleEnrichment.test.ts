import { describe, expect, it } from 'vitest';
import type { OutboxOperation, OutboxPayload } from './outbox';
import type { Vehicle } from './types';
import {
  isVehicleEnrichmentOperation,
  isVehicleEnrichmentPatch,
  recoveryGroupsWithVehicleEnrichment,
  vehicleEnrichmentDecision,
  vehicleEnrichmentVerdict,
  vehicleSpecIdentityMatches,
  vehicleEnrichmentRequestKey, vehicleEnrichmentSettled, readCurrentVehicleEnrichmentDecision,
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


describe('automatic enrichment lifetime and durable settlement', () => {
  const vehicle = () => ({ id: 'v1', ...base }) as unknown as Vehicle;
  function gate<T>() {
    let release!: (value: T) => void;
    const promise = new Promise<T>(resolve => { release = resolve; });
    return { promise, release };
  }

  it('keeps a same-identity listener refresh alive through a gated server read', async () => {
    let current = vehicle();
    const key = vehicleEnrichmentRequestKey('owner', current), read = gate<OutboxPayload | null>();
    const decision = readCurrentVehicleEnrichmentDecision(proposed, base, () => read.promise,
      () => vehicleEnrichmentRequestKey('owner', current) === key);
    // Metadata/listener replacement and unrelated document changes must not
    // abort an already journaled missing-spec proposal.
    current = { ...current, nickname: 'new label', docs: { mandatory: { cost: 100 } } };
    expect(vehicleEnrichmentRequestKey('owner', current)).toBe(key);
    read.release({ ...base, nickname: 'new label' });
    await expect(decision).resolves.toEqual({ state: 'update', patch: proposed });
  });

  it('rejects cancellation while the transaction read is gated, rather than reporting a successful empty write', async () => {
    let current = true;
    const read = gate<OutboxPayload | null>();
    const decision = readCurrentVehicleEnrichmentDecision(proposed, base, () => read.promise, () => current);
    const rejected = expect(decision).rejects.toMatchObject({ code: 'vehicle-enrichment-cancelled' });
    current = false; read.release(base);
    await rejected;
  });

  it('does not start a server read for an already cancelled account or vehicle scope', async () => {
    let reads = 0;
    await expect(readCurrentVehicleEnrichmentDecision(proposed, base, async () => { reads++; return base; }, () => false))
      .rejects.toMatchObject({ code: 'vehicle-enrichment-cancelled' });
    expect(reads).toBe(0);
  });

  it('still permits a verified obsolete no-op when manual values arrived before commit', async () => {
    const manual = { ...base, tankLiters: 47, tankLitersSource: 'user', declaredKmPerLiter: 14.8, declaredSource: 'user' };
    await expect(readCurrentVehicleEnrichmentDecision(proposed, base, async () => manual, () => true))
      .resolves.toEqual({ state: 'complete' });
    expect(manual).toMatchObject({ tankLiters: 47, declaredKmPerLiter: 14.8 });
  });

  it('changes effect identity for account/car identity and missing-state changes only', () => {
    const original = vehicle(), key = vehicleEnrichmentRequestKey('owner', original);
    expect(vehicleEnrichmentRequestKey('other-owner', original)).not.toBe(key);
    for (const change of [{ id: 'v2' }, { year: 2013 }, { createdAt: 1700000000001 }, { tozeretCd: 502 },
      { tankLiters: 45, tankLitersSource: 'trusted' }, { tankLitersSource: 'user' }]) {
      expect(vehicleEnrichmentRequestKey('owner', { ...original, ...change } as Vehicle)).not.toBe(key);
    }
    expect(vehicleEnrichmentRequestKey('owner', { ...original, tankLiters: 47, declaredKmPerLiter: 14.8 })).toBeNull();
    expect(vehicleEnrichmentRequestKey('owner', { ...original, tankLitersSource: 'user', declaredSource: 'user' })).toBeNull();
  });

  it('does not consume an accepted receipt before its real settlement', async () => {
    const settled = gate<boolean>();
    let finished = false;
    const completion = vehicleEnrichmentSettled({ id: 'op', settled: settled.promise }, () => true)
      .then(result => { finished = true; return result; });
    await Promise.resolve(); expect(finished).toBe(false);
    settled.release(true);
    await expect(completion).resolves.toBe(true);
    await expect(vehicleEnrichmentSettled({ id: 'rejected', settled: Promise.resolve(false) }, () => true)).resolves.toBe(false);
    await expect(vehicleEnrichmentSettled({ id: 'stale', settled: Promise.resolve(true) }, () => false)).resolves.toBe(false);
    await expect(vehicleEnrichmentSettled(null, () => true)).resolves.toBe(false);
  });
});
