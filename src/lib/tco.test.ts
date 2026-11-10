import { describe, expect, it } from 'vitest';
import { calculateTco, tcoLegendParts, type TcoInput, type TcoPart } from './tco';
import { EMPTY_CARE, type ServiceEvent, type VehicleExpense } from './maintenance/model';
import { buildLedger } from './vehicle/derived';
import { EMPTY_EXTRA } from './vehicle/model';
import type { Fillup } from './types';

const fill = (id: string, day = '2026-11-01', totalCost = 120, unknown = false): Fillup => ({
  id, date: +new Date(`${day}T12:00:00`), odometer: 100000, liters: 20, pricePerLiter: 6,
  totalCost, totalCostUnknown: unknown, isFullTank: true,
});
const expense = (category: VehicleExpense['category'], costAgorot: number | null, day = '2026-11-01'): VehicleExpense =>
  ({ id: category, schemaVersion: 1, version: 1, day, category, title: category, costAgorot, notes: '' });
const service = (costAgorot: number | null, day = '2026-11-01'): ServiceEvent =>
  ({ id: 'service', schemaVersion: 1, version: 1, day, title: 'טיפול', jobs: ['oil'], costAgorot, odometer: null, garage: '', notes: '', completedPlanIds: [] });
const rows = (fills = [fill('fuel')], expenses: VehicleExpense[] = [], services: ServiceEvent[] = []) =>
  buildLedger(fills, [], { ...EMPTY_CARE, vehicleExpenses: expenses, serviceEvents: services }, EMPTY_EXTRA);
const input = (patch: Partial<TcoInput> = {}): TcoInput => ({
  ledger: rows(), docs: { mandatory: { cost: 1200 }, coverage: { type: 'third', cost: 600 }, test: { cost: 120 } },
  today: '2026-11-04', kmPerDay: 20, ...patch,
});
const part = (result: ReturnType<typeof calculateTco>, id: string) => result.parts.find(item => item.id === id)!;

describe('true cost of ownership', () => {
  it('labels the energy part "חשמל" for an EV without changing any value (Stage 7 D2)', () => {
    const fuel = calculateTco(input()), ev = calculateTco(input({ ev: true }));
    expect(part(fuel, 'fuel').label).toBe('דלק');
    expect(part(ev, 'fuel').label).toBe('חשמל');
    expect({ ...ev, parts: ev.parts.map(item => ({ ...item, label: '' })), missing: [] })
      .toEqual({ ...fuel, parts: fuel.parts.map(item => ({ ...item, label: '' })), missing: [] });
  });
  it('combines one recorded calendar month with amortised annual documents', () => {
    const result = calculateTco(input({ ledger: rows([fill('fuel')], [expense('parking', 500)], [service(3000)]) }));
    expect(result.window).toBe(1);
    expect(result.month).toBe(315);
    expect(result.year).toBe(3780);
    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
  });
  it('caps at twelve calendar months and excludes older and future costs', () => {
    const result = calculateTco(input({ ledger: rows([fill('old', '2024-01-01', 9000), fill('excluded', '2025-11-30', 5000),
      fill('start', '2025-12-01', 120), fill('current', '2026-11-01', 240), fill('future', '2026-11-05', 10000)]) }));
    expect(result.window).toBe(12); expect(result.windowStart).toBe('2025-12-01');
    expect(part(result, 'fuel').value).toBe(30);
  });
  it('keeps empty intervening months in the denominator', () => {
    const result = calculateTco(input({ ledger: rows([fill('a', '2026-09-30', 300)]) }));
    expect(result.window).toBe(3); expect(part(result, 'fuel').value).toBe(100);
    expect(result.fuelThisMonth).toBe(0);
  });
  it('uses the first vehicle record, including maintenance before the first fill-up', () => {
    const result = calculateTco(input({ ledger: rows([fill('fuel')], [], [service(40000, '2026-08-01')]) }));
    expect(result.window).toBe(4); expect(part(result, 'service').value).toBe(100);
  });
  it('keeps every absent annual cost missing rather than presenting it as zero', () => {
    const result = calculateTco(input({ docs: undefined }));
    expect(result.missing.map(item => item.id)).toEqual(['mandatory', 'coverage', 'test']);
    expect(part(result, 'mandatory').value).toBeNull(); expect(result.month).toBe(120);
    expect(result.complete).toBe(false);
  });
  it('recognises explicit no optional insurance as zero without hiding an insurance invoice', () => {
    const result = calculateTco(input({ docs: { coverage: { type: 'none' } }, ledger: rows([fill('fuel')], [expense('insurance', 6000)]) }));
    expect(part(result, 'coverage').value).toBe(0);
    expect(part(result, 'other').value).toBe(60);
    expect(result.missing.map(item => item.id)).toEqual(['mandatory', 'test']);
  });
  it('preserves explicitly entered zero annual costs', () => {
    const result = calculateTco(input({ ledger: rows([fill('free', '2026-11-01', 0)]),
      docs: { mandatory: { cost: 0 }, coverage: { type: 'third', cost: 0 }, test: { cost: 0 } } }));
    expect(result.complete).toBe(true); expect(result.month).toBe(0); expect(result.year).toBe(0);
  });
  it('includes insurance journal costs while document costs are unknown', () => {
    const result = calculateTco(input({ docs: {}, ledger: rows([fill('fuel')], [expense('insurance', 90000)]) }));
    expect(part(result, 'other').value).toBe(900);
  });
  it.each(['mandatory', 'coverage'] as const)('does not also count an insurance invoice when %s carries an annual cost', key => {
    const docs = key === 'mandatory' ? { mandatory: { cost: 2400 } } : { coverage: { type: 'third', cost: 2400 } };
    const result = calculateTco(input({ docs, ledger: rows([fill('fuel')], [expense('insurance', 240000)]) }));
    expect(part(result, 'other').value).toBe(0); expect(part(result, key).value).toBe(200);
  });
  it('deduplicates registration invoices only after an annual test cost exists', () => {
    const ledger = rows([fill('fuel')], [expense('registration', 120000)]);
    expect(part(calculateTco(input({ ledger, docs: {} })), 'other').value).toBe(1200);
    const result = calculateTco(input({ ledger, docs: { test: { cost: 1200 } } }));
    expect(part(result, 'other').value).toBe(0); expect(part(result, 'test').value).toBe(100);
  });
  it('retains the available subtotal while an unpriced fill-up remains explicitly unknown', () => {
    const result = calculateTco(input({ docs: {}, ledger: rows([fill('known'), fill('unknown', '2026-11-02', 0, true)]) }));
    expect(part(result, 'fuel')).toMatchObject({ value: null, knownValue: 120 });
    expect(result.month).toBe(120); expect(result.complete).toBe(false); expect(result.lowerBound).toBe(true);
    expect(result.fuelThisMonth).toBeNull();
  });
  it('keeps a known current month separate from an unpriced prior month', () => {
    const result = calculateTco(input({ ledger: rows([fill('prior', '2026-10-28', 0, true), fill('current', '2026-11-01', 175)]) }));
    expect(result.fuelThisMonth).toBe(175); expect(part(result, 'fuel').value).toBeNull();
  });
  it('does not invent a zero total when no actual monetary amount is known', () => {
    const result = calculateTco(input({ docs: { coverage: { type: 'none' } }, ledger: rows([fill('unknown', '2026-11-01', 0, true)]) }));
    expect(result.month).toBeNull(); expect(result.year).toBeNull(); expect(result.perKm).toBeNull();
  });
  it('does not invent a zero fuel tile for a vehicle without a fill-up history', () => {
    expect(calculateTco(input({ ledger: [] })).fuelThisMonth).toBeNull();
  });
  it('uses the exact stored fuel cost rather than rounding an intermediate value to agorot', () => {
    const result = calculateTco(input({ docs: {}, ledger: rows([fill('precise', '2026-11-01', 1.23456789)]) }));
    expect(part(result, 'fuel').value).toBe(1.23456789);
  });
  it.each([null, 0, -1, NaN, Infinity])('withholds cost per kilometre for unknown or invalid mobility %s', kmPerDay => {
    expect(calculateTco(input({ kmPerDay })).perKm).toBeNull();
  });
  it('uses 30.4 days consistently and annualises the same monthly total', () => {
    const result = calculateTco(input());
    expect(result.perKm).toBe(result.month! / (20 * 30.4));
    expect(result.year).toBe(result.month! * 12);
  });
  it('subtracts recorded refunds exactly once', () => {
    const result = calculateTco(input({ docs: {}, ledger: rows([fill('fuel')], [expense('refund', 3000)]) }));
    expect(part(result, 'other').value).toBe(-30); expect(result.month).toBe(90);
  });
  it('does not describe an unknown refund as a guaranteed lower bound', () => {
    const result = calculateTco(input({ ledger: rows([fill('fuel')], [expense('refund', null)]) }));
    expect(result.lowerBound).toBe(false); expect(part(result, 'other').value).toBeNull();
  });
  it('does not certify a cached, malformed or unresolved history as complete', () => {
    const result = calculateTco(input({ incomplete: true }));
    expect(result.complete).toBe(false); expect(result.lowerBound).toBe(false); expect(result.fuelThisMonth).toBeNull();
    expect(part(result, 'fuel').knownValue).toBe(120);
  });
  it.each([null, '1200', -1, NaN, Infinity, 1000001])('refuses an invalid annual test cost %s', cost => {
    expect(part(calculateTco(input({ docs: { test: { cost } } })), 'test').value).toBeNull();
  });
  it('does not infer insurance cover from a cost without an explicit type', () => {
    expect(part(calculateTco(input({ docs: { coverage: { cost: 1200 } } })), 'coverage').value).toBeNull();
  });
  it('keeps the required part order and document destinations', () => {
    const result = calculateTco(input());
    expect(result.parts.map(item => item.id)).toEqual(['fuel', 'service', 'mandatory', 'coverage', 'test', 'other']);
    expect(result.parts.filter(item => item.docKey).map(item => item.docKey)).toEqual(['mandatory', 'coverage', 'test']);
  });
  it('does not mutate the source ledger or document metadata', () => {
    const source = input(); const before = JSON.stringify(source); calculateTco(source);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('requires a real civil date', () => {
    expect(() => calculateTco(input({ today: '2026-02-31' }))).toThrow(TypeError);
  });
});

describe('v3 TCO legend order', () => {
  const part = (id: TcoPart['id'], knownValue: number): TcoPart => ({ id, label: id, value: knownValue, knownValue });
  it('lists every non-zero part, largest first, ties in engine order', () => {
    const parts = [part('fuel', 295), part('service', 175), part('mandatory', 98), part('coverage', 80), part('test', 118), part('other', 0)];
    expect(tcoLegendParts({ parts }).map(row => row.id)).toEqual(['fuel', 'service', 'test', 'mandatory', 'coverage']);
    expect(tcoLegendParts({ parts: [part('other', 10), part('fuel', 10)] }).map(row => row.id)).toEqual(['other', 'fuel']);
    expect(tcoLegendParts({ parts: [part('fuel', 0)] })).toEqual([]);
  });
});
