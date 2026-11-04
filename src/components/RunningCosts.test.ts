import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useVehicleData } from '../context/VehicleDataContext';
import { buildLedger, mileageEvidence } from '../lib/vehicle/derived';
import { EMPTY_CARE, type CareData, type ServiceEvent } from '../lib/maintenance/model';
import { EMPTY_EXTRA } from '../lib/vehicle/model';
import { parseFillupDocument } from '../lib/fillupSerializer';
import { TANK_SCHEMA_VERSION } from '../lib/tank/config';
import type { Fillup } from '../lib/types';
import { RunningCosts } from './RunningCosts';

vi.mock('../context/VehicleDataContext', () => ({ useVehicleData: vi.fn() }));

const service: ServiceEvent = { id: 'service', schemaVersion: 1, version: 1, day: '2026-10-10',
  title: 'טיפול', jobs: ['oil'], costAgorot: 50000, odometer: 1100, garage: '', notes: '', completedPlanIds: [] };
function fillup(id: string, day: string, odometer: number): Fillup {
  const result = parseFillupDocument(id, { date: Date.parse(`${day}T12:00:00+03:00`), odometer,
    liters: 20, totalCost: 150, pricePerLiter: 7.5, isFullTank: true, fillEndState: 'full',
    fillEndStateSource: 'user-confirmed', tankSchemaVersion: TANK_SCHEMA_VERSION });
  if (!result.ok) throw new Error('Invalid running-cost fixture');
  return result.fillup;
}
const fuel = [fillup('start', '2026-10-01', 1000), fillup('end', '2026-10-20', 1400)];
function render(care: CareData, fillups = fuel, incomplete = false, from = '2026-10-01') {
  vi.mocked(useVehicleData).mockReturnValue({ ledger: buildLedger(fillups, [], care, EMPTY_EXTRA),
    mileage: mileageEvidence(fillups, [], care), incomplete } as ReturnType<typeof useVehicleData>);
  return renderToStaticMarkup(createElement(StaticRouter, { location: '/vehicle' },
    createElement(RunningCosts, { from, to: '2026-10-31' })));
}
const value = (markup: string, id: string) => markup.match(new RegExp(`data-testid="${id}"><bdi[^>]*>([^<]*)</bdi>`))?.[1];

describe('vehicle running-cost display boundaries', () => {
  it('shows agorot/km from the real shared interval while whole-shekel totals retain exact source money', () => {
    const care = { ...EMPTY_CARE, serviceEvents: [{ ...service, costAgorot: 50049 }] };
    const before = JSON.stringify({ care, fuel });
    const markup = render(care);
    expect(value(markup, 'running-total')).toBe('₪800');
    expect(value(markup, 'running-cost-per-km')).toBe('200');
    expect(value(markup, 'running-fuel-per-km')).toBe('75');
    expect(markup.match(/אג׳ לק״מ/g)).toHaveLength(2);
    expect(JSON.stringify({ care, fuel })).toBe(before);
    for (const run of markup.matchAll(/<bdi[^>]*>([^<]*)<\/bdi>/g)) expect(run[1]).not.toMatch(/[א-ת]/);
  });

  it.each(['missing-cost', 'incomplete-source'] as const)('keeps unavailable ratios unknown for %s', reason => {
    const markup = render({ ...EMPTY_CARE, serviceEvents: [{ ...service,
      costAgorot: reason === 'missing-cost' ? null : service.costAgorot }] }, fuel, reason === 'incomplete-source');
    expect(value(markup, 'running-cost-per-km')).toBe('—');
    expect(value(markup, 'running-fuel-per-km')).toBe('—');
    if (reason === 'missing-cost') expect(markup).toContain('עלות חסרה');
  });

  it('distinguishes a known zero rate from unknown mileage', () => {
    const care: CareData = { ...EMPTY_CARE, odometerReadings: [
      { id: 'start', schemaVersion: 1, version: 1, day: '2026-10-01', odometer: 1000, notes: '' },
      { id: 'end', schemaVersion: 1, version: 1, day: '2026-10-20', odometer: 1400, notes: '' },
    ] };
    expect(value(render(care, []), 'running-cost-per-km')).toBe('0');
    expect(value(render(EMPTY_CARE, []), 'running-cost-per-km')).toBe('—');
  });

  it('shows Hebrew civil dates but retains ISO route filters and keeps the coverage explanation behind a tap', () => {
    const markup = render({ ...EMPTY_CARE, serviceEvents: [service] });
    const visibleText = markup.replace(/<[^>]*>/g, '');
    expect(visibleText).not.toMatch(/2026-10-\d{2}/);
    expect(visibleText).toMatch(/1 באוק.*2026/);
    expect(markup).toContain('/history?from=2026-10-01&amp;to=2026-10-31');
    expect(markup).toContain('<summary>איך מחושבות העלויות?</summary>');
    expect(markup).not.toMatch(/<details[^>]*\bopen\b/);
    const all = render(EMPTY_CARE, [], false, '1900-01-01');
    expect(all.replace(/<[^>]*>/g, '')).toContain('כל התקופה');
    expect(all.replace(/<[^>]*>/g, '')).not.toContain('1900');
  });
});
