import { describe, expect, it } from 'vitest';
import { EMPTY_CARE, type CareData, type OdometerReading, type ServiceEvent, type VehicleExpense } from '../maintenance/model';
import type { Fillup, Vehicle } from '../types';
import { buildLedger, mileageEvidence } from '../vehicle/derived';
import { EMPTY_EXTRA } from '../vehicle/model';
import { buildMonthlyStatement, monthBounds, statementCsv, statementHtml, statementMonths, type StatementRecords } from './statement';

const vehicle: Vehicle = { id: 'v', make: 'מאזדה', model: '3', year: 2020, plateNumber: '12345678', fuelType: '95', priceAdjustment: 0, archived: false,
  biz: { company: 'א.ב. הובלות <בע"מ>', driver: 'דנה', usagePct: 60 } };
const fill = (id: string, day: string, odometer: number, totalCost: number, patch: Partial<Fillup> = {}): Fillup => ({
  id, date: +new Date(`${day}T09:30:00`), odometer, liters: 40.123, pricePerLiter: 7.351, totalCost, totalCostUnknown: false, isFullTank: true,
  station: { stationId: 's1', name: 'פז הרצליה', brand: 'פז' } as Fillup['station'], ...patch,
});
const expense = (id: string, day: string, category: VehicleExpense['category'], costAgorot: number | null, patch: Partial<VehicleExpense> = {}): VehicleExpense =>
  ({ id, schemaVersion: 1, version: 1, day, category, title: id, costAgorot, notes: '', ...patch });
const service = (id: string, day: string, costAgorot: number | null, odometer: number | null): ServiceEvent =>
  ({ id, schemaVersion: 1, version: 1, day, title: 'טיפול 30,000', jobs: ['periodic'], odometer, costAgorot, garage: 'מוסך הצפון', notes: '', completedPlanIds: [] });
const reading = (id: string, day: string, odometer: number): OdometerReading => ({ id, schemaVersion: 1, version: 1, day, odometer, notes: '' });

const fills = [
  fill('f-sep', '2026-09-28', 29_500, 250),
  fill('f1', '2026-10-03', 30_000, 300.45),
  fill('f2', '2026-10-20', 30_800, 280, { totalCostUnknown: true }),
];
const care: CareData = { ...EMPTY_CARE,
  serviceEvents: [service('s1', '2026-10-12', 120_000, 30_400), service('s2', '2026-10-15', null, null)],
  vehicleExpenses: [
    expense('parking', '2026-10-05', 'parking', 4_550),
    expense('toll', '2026-10-06', 'toll', 1_290),
    expense('refund', '2026-10-18', 'refund', 20_000, { title: 'החזר מהמוסך' }),
    expense('unknown-wash', '2026-10-19', 'wash', null),
    expense('fine', '2026-10-22', 'other', 25_000, { excluded: true, title: 'דוח חניה' }),
    expense('fine-refund', '2026-10-23', 'refund', 5_000, { excluded: true }),
    expense('nov', '2026-11-01', 'parking', 999),
  ],
  odometerReadings: [reading('o-end', '2026-10-30', 31_250)],
};
const records = (c = care, f = fills): StatementRecords => ({ ledger: buildLedger(f, [], c, EMPTY_EXTRA), mileage: mileageEvidence(f, [], c) });

describe('buildMonthlyStatement — grouping and totals', () => {
  const statement = buildMonthlyStatement(vehicle, records(), '2026-10');

  it('covers exactly the calendar month', () => {
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(() => monthBounds('2026-13')).toThrow();
    const keys = [...statement.groups.flatMap(g => g.rows), ...statement.excludedGroup!.rows].map(r => r.key);
    expect(keys).not.toContain('fillups/f-sep');
    expect(keys).not.toContain('vehicleExpenses/nov');
  });
  it('groups fuel, service, then each expense kind in category order', () => {
    expect(statement.groups.map(g => g.id)).toEqual(['fuel', 'service', 'expense:parking', 'expense:toll', 'expense:wash', 'expense:refund']);
    expect(statement.groups.map(g => g.label)).toEqual(['דלק', 'טיפולים ותיקונים', 'חניה', 'כבישי אגרה', 'שטיפה', 'החזר / זיכוי']);
    expect(statement.groups.every(g => g.inTotal)).toBe(true);
  });
  it('nets refunds and leaves unknown amounts out of the total, counted', () => {
    const fuel = statement.groups[0];
    expect(fuel).toMatchObject({ totalAgorot: 30_045, unknown: 1 });
    expect(statement.groups.find(g => g.id === 'expense:refund')).toMatchObject({ totalAgorot: -20_000 });
    expect(statement.totalAgorot).toBe(30_045 + 120_000 + 4_550 + 1_290 - 20_000);
    expect(statement.refundsAgorot).toBe(20_000);
    expect(statement.unknownCount).toBe(3); // unknown fill, unknown service, unknown wash
    expect(statement.recordCount).toBe(8);
  });
  it('keeps "לא בעלות הרכב" separate and outside the total, refund included', () => {
    expect(statement.excludedGroup).toMatchObject({ id: 'excluded', label: 'לא בעלות הרכב', inTotal: false, totalAgorot: 25_000 - 5_000 });
    expect(statement.excludedGroup!.rows.map(r => r.key)).toEqual(['vehicleExpenses/fine', 'vehicleExpenses/fine-refund']);
    const withoutExcluded = buildMonthlyStatement(vehicle, records({ ...care, vehicleExpenses: care.vehicleExpenses.filter(e => !e.excluded) }), '2026-10');
    expect(withoutExcluded.totalAgorot).toBe(statement.totalAgorot);
    expect(withoutExcluded.excludedGroup).toBeNull();
  });
  it('km = first to last reading recorded inside the month (fills, services, odometer readings)', () => {
    expect(statement.km).toBe(31_250 - 30_000);
    expect(statement.kmBasis).toMatchObject({ fromDay: '2026-10-03', toDay: '2026-10-30', ambiguous: false, inconsistent: false });
    const single = buildMonthlyStatement(vehicle, records({ ...care, serviceEvents: [], odometerReadings: [] }, [fills[1]]), '2026-10');
    expect(single.km).toBeNull();
    const backwards = buildMonthlyStatement(vehicle, records({ ...care, odometerReadings: [reading('bad', '2026-10-30', 29_000)] }), '2026-10');
    expect(backwards.km).toBeNull();
    expect(backwards.kmBasis.inconsistent).toBe(true);
  });
  it('keeps exact fill-up values and the business share is derived, not stored', () => {
    const row = statement.groups[0].rows[0];
    expect(row).toMatchObject({ quantity: 40.123, unitPrice: 7.351, amountAgorot: 30_045, supplier: 'פז הרצליה', odometer: 30_000, title: 'תדלוק' });
    expect(statement.groups[0].rows[1]).toMatchObject({ amountAgorot: null, unitPrice: null });
    expect(statement.businessShareAgorot).toBe(Math.round(statement.totalAgorot * 0.6));
    expect(buildMonthlyStatement({ ...vehicle, biz: null }, records(), '2026-10').businessShareAgorot).toBeNull();
    expect(buildMonthlyStatement({ ...vehicle, biz: { usagePct: 400 } as never }, records(), '2026-10').biz).toBeNull();
  });
  it('an EV statement labels the energy group "חשמל"', () => {
    const ev = buildMonthlyStatement({ ...vehicle, fuelType: 'other', powertrain: 'ev' }, records(), '2026-10');
    expect(ev.groups[0]).toMatchObject({ id: 'electric', label: 'חשמל' });
    expect(ev.vehicle.ev).toBe(true);
  });
  it('an empty month is a valid, empty statement', () => {
    const empty = buildMonthlyStatement(vehicle, records(), '2025-01');
    expect(empty).toMatchObject({ groups: [], excludedGroup: null, totalAgorot: 0, unknownCount: 0, km: null });
  });
  it('lists months with financial records, newest first', () => {
    expect(statementMonths(records().ledger)).toEqual(['2026-11', '2026-10', '2026-09']);
  });
});

describe('statementCsv', () => {
  const csv = statementCsv(buildMonthlyStatement(vehicle, records(), '2026-10'));
  const lines = csv.replace('﻿', '').trimEnd().split('\r\n');
  it('starts with a UTF-8 BOM and Hebrew headers', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('"תאריך","קטגוריה","פירוט","ספק / תחנה","כמות","יחידה","מחיר ליחידה (₪)","קילומטראז׳","סכום (₪)","נכלל בעלות הרכב","הערות"');
  });
  it('writes exact values (no display rounding), negative refunds stay numeric', () => {
    expect(lines.find(l => l.includes('"פז הרצליה"') && l.includes('"30000"'))).toContain('"40.123","ליטר","7.351","30000","300.45","כן"');
    expect(lines.find(l => l.includes('"החזר מהמוסך"'))).toContain('"-200"');
    expect(lines.find(l => l.includes('"החזר מהמוסך"'))).not.toContain("'-200");
    expect(lines.find(l => l.includes('"דוח חניה"'))).toContain('"לא בעלות הרכב"');
    expect(lines.find(l => l.includes('"דוח חניה"'))!.endsWith(',"250","לא",""')).toBe(true);
    expect(lines.find(l => l.startsWith('"סה״כ לחודש"'))).toContain(`"${(30_045 + 120_000 + 4_550 + 1_290 - 20_000) / 100}"`);
    expect(lines.find(l => l.startsWith('"ק״מ שתועדו בחודש"'))).toContain('"1250"');
    expect(lines.find(l => l.startsWith('"חלק עסקי (60%)"'))).toBeDefined();
  });
  it('excluded rows come after every included row', () => {
    const fine = lines.findIndex(l => l.includes('"דוח חניה"'));
    const lastIncluded = lines.findLastIndex(l => l.endsWith('"כן",""'));
    expect(fine).toBeGreaterThan(lastIncluded);
  });
  it('neutralises formula-like text', () => {
    const tricky = statementCsv(buildMonthlyStatement(vehicle, records({ ...EMPTY_CARE, vehicleExpenses: [expense('x', '2026-10-05', 'other', 100, { title: '=HYPERLINK("x")' })] }, []), '2026-10'));
    expect(tricky).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('statementHtml', () => {
  const html = statementHtml(buildMonthlyStatement(vehicle, records(), '2026-10'), new Date('2026-11-02T10:00:00'));
  it('is a self-contained RTL document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).not.toMatch(/<script|<link |src="http|href="http/);
    expect(html).toContain('<title>דוח הוצאות רכב · אוקטובר 2026</title>');
  });
  it('has meta tiles, group tables, the excluded group, signature lines and a disclaimer', () => {
    for (const text of ['סה״כ הוצאות החודש', 'ק״מ שתועדו בחודש', 'חלק עסקי', 'טיפולים ותיקונים', 'לא בעלות הרכב', 'מחוץ לסה״כ', 'חתימת הנהג', 'אישור הנהלת חשבונות', 'אינו חשבונית']) expect(html).toContain(text);
    expect(html.match(/<table>/g)?.length).toBe(7);
  });
  it('escapes user text', () => {
    expect(html).toContain('א.ב. הובלות &lt;בע&quot;מ&gt;');
    expect(html).not.toContain('<בע"מ>');
  });
  it('shows whole shekels for amounts and two decimals per litre (AGENTS.md)', () => {
    expect(html).toContain('₪7.35');
    expect(html).toContain('₪300');
    expect(html).not.toContain('300.45');
    expect(html).toContain('03.10.2026');
  });
});
