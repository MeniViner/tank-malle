import { describe, expect, it } from 'vitest';
import { benchmarkDocId, modelKey } from './benchmarkIdentity';
import { compareCosts, costBenchmark, COST_MAX_AGE_MS, type CostPeer } from './costBenchmarkModel';
import type { Vehicle } from './types';
import { calculateTco } from './tco';
import { buildLedger } from './vehicle/derived';
import { EMPTY_CARE } from './maintenance/model';
import { EMPTY_EXTRA } from './vehicle/model';

const car = { id: 'v1', make: 'Toyota', model: ' Corolla ', fuelType: '95', archived: false, priceAdjustment: 0 } as Vehicle;
const now = +new Date('2026-11-04T12:00:00Z');
const peer = (uid: string, cost = 1000, patch: Partial<CostPeer> = {}): CostPeer => ({
  id: benchmarkDocId(uid, 'car'), vehicleId: 'car', modelKey: modelKey(car), fuelType: '95', monthlyCost: cost,
  months: 12, method: 1, updatedAt: now, ...patch,
});
const four = () => ['a', 'b', 'c', 'd'].map(uid => peer(uid));
const full = () => calculateTco({ today: '2026-11-04', kmPerDay: null,
  docs: { mandatory: { cost: 1200 }, coverage: { type: 'none' }, test: { cost: 1200 } },
  ledger: buildLedger([{ id: 'f', date: now, odometer: 100000, liters: 20, totalCost: 120.123456, pricePerLiter: 6, isFullTank: true }], [], EMPTY_CARE, EMPTY_EXTRA) });

describe('opt-in ownership cost summary', () => {
  it('shares only the full aggregate and preserves exact calculation values', () => {
    const result = costBenchmark(car, full())!;
    expect(Object.keys(result).sort()).toEqual(['fuelType', 'method', 'modelKey', 'monthlyCost', 'months', 'vehicleId']);
    expect(result.monthlyCost).toBe(full().month);
    expect(result.monthlyCost).toBeCloseTo(320.123456, 10); expect(result).not.toHaveProperty('parts');
  });
  it('never publishes incomplete, zero, negative, nonfinite or excessive totals', () => {
    expect(costBenchmark(car, { ...full(), complete: false })).toBeNull();
    for (const month of [null, 0, -1, NaN, Infinity, 1000000.01]) expect(costBenchmark(car, { ...full(), month })).toBeNull();
  });
  it('requires a supported calendar window and an active, usable vehicle', () => {
    for (const window of [0, 1.5, 13, NaN]) expect(costBenchmark(car, { ...full(), window })).toBeNull();
    expect(costBenchmark({ ...car, archived: true }, full())).toBeNull();
    expect(costBenchmark({ ...car, deletionPending: true }, full())).toBeNull();
    expect(costBenchmark({ ...car, make: '', model: '' }, full())).toBeNull();
  });
  it('requires four different other accounts, not four vehicles', () => {
    const rows = [peer('a'), peer('a', 1200, { id: 'a__other', vehicleId: 'other' }), peer('b'), peer('c')];
    expect(compareCosts('me', car, 800, rows, now)).toEqual({ kind: 'insufficient', peers: 3, required: 4 });
  });
  it('excludes every own car even when the uid itself contains separators', () => {
    const rows = [...four(), peer('me__account', 9999), peer('me__account', 8888, { id: 'me__account__other', vehicleId: 'other' })];
    expect(compareCosts('me__account', car, 800, rows, now)).toMatchObject({ kind: 'ready', peers: 4, peerAverage: 1000 });
  });
  it('uses only the latest vehicle summary per driver with deterministic ties', () => {
    const rows = [...four(), peer('a', 5000, { updatedAt: now - 1, id: 'a__old', vehicleId: 'old' })];
    expect(compareCosts('me', car, 800, rows, now)).toMatchObject({ kind: 'ready', peers: 4, peerAverage: 1000 });
    expect(compareCosts('me', car, 800, rows.reverse(), now)).toMatchObject({ kind: 'ready', peerAverage: 1000 });
  });
  it.each([3, 2, 1, 0])('withholds percentages with only %s peers', count => {
    expect(compareCosts('me', car, 800, four().slice(0, count), now)).toEqual({ kind: 'insufficient', peers: count, required: 4 });
  });
  it('uses a real peer mean and a truthful cheaper/more expensive direction', () => {
    expect(compareCosts('me', car, 800, four(), now)).toMatchObject({ kind: 'ready', differencePercent: -20 });
    expect(compareCosts('me', car, 1200, four(), now)).toMatchObject({ kind: 'ready', differencePercent: 20 });
    expect(compareCosts('me', car, 1000, four(), now)).toMatchObject({ kind: 'ready', differencePercent: 0 });
  });
  it('never falls back to a different model or fuel type', () => {
    const rows = [...four().map(row => ({ ...row, modelKey: 'toyota yaris' })), ...four().map(row => ({ ...row, fuelType: 'diesel' }))];
    expect(compareCosts('me', car, 800, rows, now)).toMatchObject({ kind: 'insufficient', peers: 0 });
  });
  it('excludes stale, future, malformed and incompatible summaries', () => {
    const invalid = [peer('old', 1000, { updatedAt: now - COST_MAX_AGE_MS - 1 }), peer('future', 1000, { updatedAt: now + 300001 }),
      peer('bad', NaN), peer('bad', Infinity), peer('bad', 0), peer('bad', -10), peer('bad', 1000001),
      peer('bad', 1000, { months: 0 }), peer('bad', 1000, { months: 1.5 }), peer('bad', 1000, { months: 13 }),
      peer('bad', 1000, { method: 2 as 1 }), peer('bad', 1000, { id: 'unowned' }), {}, null];
    expect(compareCosts('me', car, 800, invalid, now)).toMatchObject({ kind: 'insufficient', peers: 0 });
  });
  it('withholds comparison when the own full cost is not a positive known number', () => {
    for (const value of [null, 0, -1, NaN, Infinity]) expect(compareCosts('me', car, value, four(), now)).toEqual({ kind: 'unavailable' });
  });
  it('does not mutate peer values or let an old fuel-only summary qualify', () => {
    const rows = [...four(), { id: 'economy__v', modelKey: modelKey(car), fuelType: '95', avgKmPerLiter: 12 }];
    const before = JSON.stringify(rows); compareCosts('me', car, 800, rows, now); expect(JSON.stringify(rows)).toBe(before);
    expect(compareCosts('me', car, 800, rows.slice(-1), now)).toMatchObject({ kind: 'insufficient', peers: 0 });
  });
});
