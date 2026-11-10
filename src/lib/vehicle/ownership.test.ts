import { describe, expect, it } from 'vitest';
import { carePayload, EMPTY_CARE, normalizeCareRecord, validCareRecord, type CareData, type VehicleExpense } from '../maintenance/model';
import { careCostsCsv, parseExcludedCell, readCareBackup, careBackup } from '../maintenance/export';
import { careCosts } from '../maintenance/costs';
import { careReplacementPatch } from '../maintenance/persistence';
import { spendingSummary } from '../../components/insights/presentation';
import { summariseLedger } from '../summary';
import { calculateTco } from '../tco';
import type { Fillup } from '../types';
import { buildLedger, mileageEvidence, periodSummary } from './derived';
import { financialTotals } from './financial';
import { EMPTY_EXTRA, vehiclePayload } from './model';
import { countsTowardOwnership, isExcludedFromOwnership, ownershipRows } from './ownership';

const fill = (id: string, day: string, odometer: number, totalCost = 300): Fillup => ({
  id, date: +new Date(`${day}T12:00:00`), odometer, liters: 40, pricePerLiter: 7.5, totalCost, totalCostUnknown: false, isFullTank: true,
});
const expense = (id: string, patch: Partial<VehicleExpense> = {}): VehicleExpense =>
  ({ id, schemaVersion: 1, version: 1, day: '2026-10-10', category: 'parking', title: id, costAgorot: 10000, notes: '', ...patch });
const fills = [fill('a', '2026-10-01', 10000), fill('b', '2026-10-25', 11000)];
const care: CareData = { ...EMPTY_CARE, vehicleExpenses: [
  expense('parking', { costAgorot: 10000 }),
  expense('fine', { category: 'other', costAgorot: 25000, excluded: true }),
  expense('refund', { category: 'refund', costAgorot: 4000 }),
] };
const ledger = buildLedger(fills, [], care, EMPTY_EXTRA);

describe('excluded flag — model and storage', () => {
  it('accepts true, false and missing; rejects non-boolean', () => {
    expect(validCareRecord('vehicleExpenses', expense('x'))).toBe(true);
    expect(validCareRecord('vehicleExpenses', expense('x', { excluded: true }))).toBe(true);
    expect(validCareRecord('vehicleExpenses', expense('x', { excluded: false }))).toBe(true);
    expect(validCareRecord('vehicleExpenses', { ...expense('x'), excluded: 'yes' })).toBe(false);
    expect(validCareRecord('vehicleExpenses', { ...expense('x'), excluded: 1 })).toBe(false);
    // Only expenses carry the flag.
    expect(validCareRecord('odometerReadings', { id: 'o', schemaVersion: 1, version: 1, day: '2026-10-10', odometer: 1, notes: '', excluded: true })).toBe(false);
  });
  it('writes the field only when true, so old records and old clients are unaffected', () => {
    expect(carePayload('vehicleExpenses', expense('x', { excluded: false }))).not.toHaveProperty('excluded');
    expect(carePayload('vehicleExpenses', expense('x'))).not.toHaveProperty('excluded');
    expect(carePayload('vehicleExpenses', expense('x', { excluded: true }))).toMatchObject({ excluded: true });
    expect(vehiclePayload('vehicleExpenses', expense('x', { excluded: false }))).not.toHaveProperty('excluded');
    expect(normalizeCareRecord('vehicleExpenses', expense('x', { excluded: true })).excluded).toBe(true);
  });
  it('an update that switches the expense back to included removes the stored flag', () => {
    const stored = carePayload('vehicleExpenses', expense('x', { excluded: true }));
    const next = carePayload('vehicleExpenses', expense('x', { version: 2 }));
    const patch = careReplacementPatch(next, stored);
    expect(Object.hasOwn(patch, 'excluded')).toBe(true);
    expect(patch.excluded).not.toBe(true);
    expect(careReplacementPatch(next, carePayload('vehicleExpenses', expense('x')))).toEqual(next);
  });
  it('JSON care backups round-trip the flag', () => {
    const data = { ...EMPTY_CARE, vehicleExpenses: [expense('x', { excluded: true })] };
    expect(readCareBackup(careBackup({ id: 'v', label: 'רכב' }, data, false)).records.vehicleExpenses[0].excluded).toBe(true);
  });
});

describe('excluded flag — the single predicate', () => {
  it('only excludes expenses explicitly marked', () => {
    expect(countsTowardOwnership({ kind: 'expense' })).toBe(true);
    expect(countsTowardOwnership({ kind: 'expense', excluded: true })).toBe(false);
    expect(countsTowardOwnership({ kind: 'expense', record: { excluded: true } })).toBe(false);
    expect(countsTowardOwnership({ kind: 'fuel', excluded: true })).toBe(true);
    expect(isExcludedFromOwnership(expense('x', { excluded: true }))).toBe(true);
    expect(ledger.find(row => row.id === 'fine')?.excluded).toBe(true);
    expect(ledger.find(row => row.id === 'parking')).not.toHaveProperty('excluded');
    expect(ownershipRows(ledger).map(row => row.id)).not.toContain('fine');
  });
});

describe('excluded flag — every aggregate', () => {
  it('journal record totals still include it, and report the excluded share', () => {
    const totals = financialTotals(ledger);
    expect(totals.total).toBe(60000 + 10000 + 25000 - 4000);
    expect(totals).toMatchObject({ excludedAgorot: 25000, excludedCount: 1 });
  });
  it('periodSummary (Home month, vehicle "כמה עלה", year screen, per-km) leaves it out', () => {
    const summary = periodSummary(ledger, mileageEvidence(fills, [], care), '2026-10-01', '2026-10-31');
    expect(summary.total).toBe(60000 + 10000 - 4000);
    expect(summary).toMatchObject({ excludedAgorot: 25000, excludedCount: 1, count: 5, distance: 1000 });
    expect(summary.costPerKm).toBeCloseTo((60000 + 10000 - 4000) / 100 / 1000);
  });
  it('TCO and its shared monthly figure leave it out', () => {
    const tco = calculateTco({ ledger, docs: { mandatory: { cost: 1200 }, coverage: { type: 'none' }, test: { cost: 0 } }, today: '2026-10-31', kmPerDay: 30 });
    const other = tco.parts.find(part => part.id === 'other')!;
    expect(other.value).toBe(60);
    expect(tco.excluded).toEqual({ monthly: 250, count: 1 });
    const withoutFine = calculateTco({ ledger: buildLedger(fills, [], { ...care, vehicleExpenses: care.vehicleExpenses.filter(e => e.id !== 'fine') }, EMPTY_EXTRA),
      docs: { mandatory: { cost: 1200 }, coverage: { type: 'none' }, test: { cost: 0 } }, today: '2026-10-31', kmPerDay: 30 });
    expect(tco.month).toBe(withoutFine.month);
    expect(tco.perKm).toBe(withoutFine.perKm);
  });
  it('an excluded expense alone does not open the TCO window early', () => {
    const early = buildLedger(fills, [], { ...care, vehicleExpenses: [expense('old', { day: '2026-01-05', excluded: true })] }, EMPTY_EXTRA);
    expect(calculateTco({ ledger: early, docs: null, today: '2026-10-31', kmPerDay: null }).window).toBe(1);
  });
  it('spending averages, chart series and the by-month table leave it out', () => {
    const summary = spendingSummary(ledger, '2026-10-01', '2026-10-31');
    expect(summary.amount).toBe(60000 + 10000 - 4000);
    expect(summary.expenseAmount).toBe(10000 - 4000);
    expect(summary.months[0]).toMatchObject({ other: 100, refunds: -40, total: 660 });
    expect(summary).toMatchObject({ excludedAmount: 25000, excludedCount: 1 });
  });
  it('the published ledger summary leaves the money out but still counts the record', () => {
    const summary = summariseLedger(ledger, +new Date('2026-10-31T12:00:00'));
    expect(summary.totalAgorot).toBe(66000);
    expect(summary.counts.expense).toBe(3);
    expect(summary.months.at(-1)).toMatchObject({ month: '2026-10', totalAgorot: 66000 });
  });
  it('account totals (careCosts) leave it out', () => {
    expect(careCosts(care, fills, '2026-10-01', '2026-10-31', false)).toMatchObject({ total: 66000, excludedAgorot: 25000, excludedCount: 1 });
  });
});

describe('excluded flag — CSV', () => {
  it('appends excluded_from_tco without moving existing columns', () => {
    const lines = careCostsCsv(care).replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('"סוג","תאריך","שם","קילומטראז׳","עלות בש״ח","עבודות / קטגוריה","מוסך","הערות","excluded_from_tco"');
    expect(lines.find(line => line.includes('"fine"'))!.endsWith(',"yes"')).toBe(true);
    expect(lines.find(line => line.includes('"parking"'))!.endsWith(',""')).toBe(true);
  });
  it('import reading of the column: absent or empty means included', () => {
    expect(['yes', 'TRUE', '1', 'כן', ' yes '].map(parseExcludedCell)).toEqual([true, true, true, true, true]);
    expect(['', 'no', '0', undefined, null].map(parseExcludedCell)).toEqual([false, false, false, false, false]);
  });
});
