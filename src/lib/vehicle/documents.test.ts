import { describe, expect, it } from 'vitest';
import { GeoPoint, Timestamp } from 'firebase/firestore';
import { civilDaysBetween, readVehicleDocument, validVehicleDocChanges, validVehicleDocDay } from './documents';

describe('bounded licensing document view', () => {
  it.each([
    [undefined, 'missing-docs'], [null, 'null-docs'], [{}, 'missing-document'], [{ mandatory: null }, 'null-document'],
  ])('distinguishes optional emptiness without filling known leaves: %s', (docs, emptyKind) => {
    expect(readVehicleDocument(docs, 'mandatory', '2026-11-03')).toEqual({
      state: 'absent', key: 'mandatory', emptyKind, values: {}, due: null, daysLeft: null,
    });
  });

  it.each([7, '', [], new Timestamp(10, 5), new GeoPoint(1, 2)])('never treats a scalar/array/SDK object as an empty map: %s', value => {
    expect(readVehicleDocument(value, 'coverage', '2026-11-03').state).toBe('unavailable');
    expect(readVehicleDocument({ coverage: value }, 'coverage', '2026-11-03').state).toBe('unavailable');
  });

  it('reads exact null/missing/cost metadata without cleaning none coverage or unknown children', () => {
    const raw = { coverage: { type: 'none', cost: 123.456789, insurer: null, due: '2026-12-01', future: { precise: 1.23456789 } }, other: 'untouched' };
    const view = readVehicleDocument(raw, 'coverage', '2026-11-03');
    expect(view).toEqual({ state: 'ready', key: 'coverage', values: { type: 'none', cost: 123.456789, insurer: null, due: '2026-12-01' }, due: null, daysLeft: null });
    expect(raw.coverage.cost).toBe(123.456789); expect(raw.coverage.due).toBe('2026-12-01');
    expect(readVehicleDocument({ coverage: { due: '2026-12-01' } }, 'coverage', '2026-11-03')).toMatchObject({ state: 'ready', values: { due: '2026-12-01' }, due: '2026-12-01', daysLeft: 28 });
  });

  it('rejects invalid known leaves without poisoning another document or inventing defaults', () => {
    const docs = { mandatory: { insurer: 9, due: '2026-02-30', cost: Infinity }, test: { due: null, futureCost: 'unknown field here' } };
    expect(readVehicleDocument(docs, 'mandatory', '2026-11-03')).toMatchObject({ state: 'unavailable', invalidFields: ['insurer', 'due', 'cost'] });
    expect(readVehicleDocument(docs, 'test', '2026-11-03')).toEqual({ state: 'ready', key: 'test', values: { due: null }, due: null, daysLeft: null });
  });

  it('validates authored fields only, preserving decimal precision and strict bounds', () => {
    expect(validVehicleDocChanges('mandatory', { insurer: 'א'.repeat(160), cost: 1_000_000, due: null })).toBe(true);
    for (const changes of [{}, { insurer: 'א'.repeat(161) }, { cost: -1 }, { cost: 1_000_000.1 }, { cost: NaN }, { cost: Infinity }, { due: '2026-2-01' }, { future: 1 }, { type: 'none' }]) {
      expect(validVehicleDocChanges('mandatory', changes)).toBe(false);
    }
    expect(validVehicleDocChanges('coverage', { type: 'none' })).toBe(true);
    expect(validVehicleDocChanges('mandatory', { cost: 0.123456789 })).toBe(true);
    expect(validVehicleDocChanges('test', { cost: 10 })).toBe(true);
    expect(validVehicleDocChanges('test', { insurer: 'A' })).toBe(false);
  });

  it('reads test cost as an optional exact known field and refuses malformed values', () => {
    for (const cost of [null, 0, 1420.123456, 1000000]) {
      expect(readVehicleDocument({ test: { cost } }, 'test', '2026-11-04')).toMatchObject({ state: 'ready', values: { cost } });
    }
    for (const cost of ['100', NaN, Infinity, -1, 1000001]) {
      expect(readVehicleDocument({ test: { cost } }, 'test', '2026-11-04')).toMatchObject({ state: 'unavailable', invalidFields: ['cost'] });
    }
  });

  it('uses strict Gregorian civil dates independent of daylight-saving elapsed hours', () => {
    for (const day of ['1900-01-01', '2199-12-31', '2000-02-29', '2028-02-29']) expect(validVehicleDocDay(day)).toBe(true);
    for (const day of ['1899-12-31', '2200-01-01', '1900-02-29', '2100-02-29', '2026-04-31', '2026-11-3']) expect(validVehicleDocDay(day)).toBe(false);
    expect(civilDaysBetween('2026-03-26', '2026-03-28')).toBe(2);
    expect(civilDaysBetween('2026-11-03', '2026-11-02')).toBe(-1);
    expect(civilDaysBetween('2026-02-30', '2026-03-01')).toBeNull();
  });
});
