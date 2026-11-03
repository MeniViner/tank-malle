import { describe, expect, it } from 'vitest';
import { visibleSpotlight } from '../home/spotlight';
import { vehicleDocumentOccurrences, vehicleDocumentSpotlights } from './documentNotifications';

const vehicle = { id: 'car with space', docs: { test: { due: '2026-12-03' } } };

describe('document calendar occurrences', () => {
  it('enters the monthly and weekly windows separately and remains valid through its due day', () => {
    expect(vehicleDocumentOccurrences(vehicle, '2026-11-02')).toEqual([]);
    for (const [today, daysLeft, period, urgent] of [
      ['2026-11-03', 30, 'month', false], ['2026-11-25', 8, 'month', false],
      ['2026-11-26', 7, 'week', false], ['2026-11-27', 6, 'week', true],
      ['2026-12-02', 1, 'week', true], ['2026-12-03', 0, 'week', true], ['2026-12-04', -1, 'expired', true],
    ] as const) {
      const [occurrence] = vehicleDocumentOccurrences(vehicle, today);
      expect(occurrence).toMatchObject({ daysLeft, period, urgent, occurrence: `doc:test:2026-12-03:${period}`, to: '/vehicle?doc=test&vehicle=car%20with%20space' });
      expect(occurrence.title.includes('פג תוקף')).toBe(daysLeft < 0);
    }
  });

  it('does not reset an occurrence on insurer/cost edits and gives renewed dates a new identity', () => {
    const original = { id: 'v', docs: { mandatory: { due: '2026-11-30', insurer: 'A', cost: 1234.5678 } } };
    const edited = { ...original, docs: { mandatory: { ...original.docs.mandatory, insurer: 'B', cost: 0 } } };
    expect(vehicleDocumentOccurrences(edited, '2026-11-03')).toEqual(vehicleDocumentOccurrences(original, '2026-11-03'));
    const renewed = { ...original, docs: { mandatory: { due: '2026-12-01' } } };
    expect(vehicleDocumentOccurrences(renewed, '2026-11-03')[0].occurrence).not.toBe(vehicleDocumentOccurrences(original, '2026-11-03')[0].occurrence);
  });

  it('uses civil dates across leap days and DST boundaries rather than elapsed local hours', () => {
    expect(vehicleDocumentOccurrences({ id: 'v', docs: { test: { due: '2028-03-01' } } }, '2028-02-29')[0].daysLeft).toBe(1);
    expect(vehicleDocumentOccurrences({ id: 'v', docs: { test: { due: '2026-10-26' } } }, '2026-10-25')[0].daysLeft).toBe(1);
  });

  it('suppresses none/missing/unreadable rows without turning them into invented expiry dates', () => {
    for (const docs of [undefined, null, {}, { test: null }, { test: { due: '2026-02-30' } }, { mandatory: { due: '2026-11-10', cost: -1 } },
      { coverage: { type: 'none', due: '2026-11-03', cost: 123 } }, { coverage: [] }]) {
      expect(vehicleDocumentOccurrences({ id: 'v', docs }, '2026-11-03')).toEqual([]);
    }
    expect(vehicleDocumentOccurrences(null, '2026-11-03')).toEqual([]);
    expect(vehicleDocumentOccurrences(vehicle, 'invalid')).toEqual([]);
    expect(vehicleDocumentOccurrences({ id: 'v', docs: { coverage: { type: null, due: '2026-11-03' } } }, '2026-11-03')).toHaveLength(1);
  });

  it('keeps unknown siblings and notification read/archive/snooze state outside expiry derivation', () => {
    const docs = { future: ['extension'], test: { due: '2026-12-03', future: true }, mandatory: { due: '2026-11-08' }, coverage: { type: 'third', due: '2026-11-01' } };
    const rows = vehicleDocumentOccurrences({ id: 'v', docs }, '2026-11-03');
    expect(rows.map(row => row.key)).toEqual(['coverage', 'mandatory', 'test']);
    expect(rows.map(row => row.urgent)).toEqual([true, true, false]);
    expect(docs.test).toEqual({ due: '2026-12-03', future: true });
  });

  it('allows monthly dismissal without hiding the new weekly item, and makes the last six days sticky', () => {
    const month = vehicleDocumentSpotlights(vehicleDocumentOccurrences(vehicle, '2026-11-03'));
    const dismissals = new Set([month[0].id]);
    expect(visibleSpotlight(month, dismissals)).toEqual([]);
    const week = vehicleDocumentSpotlights(vehicleDocumentOccurrences(vehicle, '2026-11-26'));
    expect(visibleSpotlight(week, dismissals)).toEqual(week);
    dismissals.add(week[0].id);
    expect(visibleSpotlight(week, dismissals)).toEqual([]);
    const lastSix = vehicleDocumentSpotlights(vehicleDocumentOccurrences(vehicle, '2026-11-27'));
    expect(visibleSpotlight(lastSix, dismissals)).toEqual(lastSix);
    expect(lastSix[0]).toMatchObject({ tone: 'danger', sticky: true, icon: 'doc' });
  });
});
