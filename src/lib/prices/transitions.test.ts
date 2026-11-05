import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedPublicPrices } from './browserFetch';
import { latestOfficialPriceChange, normalizePriceDocument, officialPriceFor, regulatedMaxPrice, suggestPricePerLiter, upcomingOfficialPrice, withPublicPrices, type RegulatedPriceConfig } from './regulated';
import { CHECKED_AT, FIFTH, NOVEMBER, NOVEMBER_FIFTH, NOVEMBER_START, OCTOBER, OCTOBER_START, SNAPSHOT } from './__fixtures__/officialNotices';

const config = () => withPublicPrices(null, SNAPSHOT, CHECKED_AT)!;
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('active and upcoming official prices', () => {
  it('preserves all transitions for someone who never opened on 1–4 November', () => {
    const data = config();
    expect(officialPriceFor(data, '95', OCTOBER_START + 1000).price).toBe(7.77);
    expect(officialPriceFor(data, '95', NOVEMBER_START + 1000).price).toBe(7.35);
    expect(latestOfficialPriceChange(data, CHECKED_AT)).toMatchObject({ price: 7.35, previousPrice: 7.77, delta: expect.closeTo(-.42) });
    expect(latestOfficialPriceChange(data, NOVEMBER_FIFTH)).toMatchObject({ price: 7.85, previousPrice: 7.35, delta: expect.closeTo(.5) });
  });
  it('changes the lookup at Israel midnight without a new server/browser read', () => {
    const data = config();
    expect(data.byFuelType?.['95']?.self?.current?.pricePerLiter).toBe(7.35);
    expect(data.byFuelType?.['95']?.self?.history['2026-11']).toBe(7.35);
    expect(officialPriceFor(data, '95', NOVEMBER_FIFTH - 1).price).toBe(7.35);
    expect(upcomingOfficialPrice(data, NOVEMBER_FIFTH - 1)?.pricePerLiter).toBe(7.85);
    expect(officialPriceFor(data, '95', NOVEMBER_FIFTH).price).toBe(7.85);
    expect(officialPriceFor(data, '95', NOVEMBER_FIFTH + 1).price).toBe(7.85);
    expect(upcomingOfficialPrice(data, NOVEMBER_FIFTH)).toBeNull();
    expect(suggestPricePerLiter(NOVEMBER_FIFTH - 1, { fuelType: '95', priceAdjustment: 0 }, data).price).toBe(7.35);
    expect(suggestPricePerLiter(NOVEMBER_FIFTH, { fuelType: '95', priceAdjustment: 0 }, data).price).toBe(7.85);
  });
  it('round-trips future evidence through normalization and browser cache', () => {
    vi.useFakeTimers(); vi.setSystemTime(CHECKED_AT);
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(SNAPSHOT) });
    const snapshot = cachedPublicPrices();
    expect(snapshot?.notices.at(-1)?.effectiveFrom).toBe(NOVEMBER_FIFTH);
    const data = normalizePriceDocument(JSON.parse(JSON.stringify(withPublicPrices(null, snapshot, CHECKED_AT))));
    expect(upcomingOfficialPrice(data, CHECKED_AT)).toMatchObject({ pricePerLiter: 7.85, sourceUrl: FIFTH.url, publishedOn: '2026-11-04' });
    expect(officialPriceFor(data, '95', NOVEMBER_FIFTH).price).toBe(7.85);
  });
  it('does not invent an earlier price from a same-month latest bucket or skip a missing month-start event', () => {
    const incomplete: RegulatedPriceConfig = { byFuelType: { '95': { self: { source: 'scheduled', history: { '2026-10': 7.77, '2026-11': 7.85 },
      current: { pricePerLiter: 7.85, effectiveFrom: NOVEMBER_FIFTH }, timeline: { [NOVEMBER_FIFTH]: 7.85 } } } } };
    expect(officialPriceFor(incomplete, '95', NOVEMBER_START).price).toBeNull();
    expect(latestOfficialPriceChange(incomplete, NOVEMBER_FIFTH)).toBeNull();
    const missingNovember = withPublicPrices(null, { notices: [OCTOBER, FIFTH], readAt: CHECKED_AT }, CHECKED_AT);
    expect(latestOfficialPriceChange(missingNovember, NOVEMBER_FIFTH)).toBeNull();
    expect(upcomingOfficialPrice(missingNovember, CHECKED_AT)?.change).toBeNull();
  });
  it('supports a genuine legacy month boundary while refusing an undated current price', () => {
    const legacy: RegulatedPriceConfig = { byFuelType: { '95': { self: { source: 'scheduled', history: { '2026-10': 7.77, '2026-11': 7.35 }, current: { pricePerLiter: 7.35, effectiveFrom: NOVEMBER_START } } } } };
    expect(latestOfficialPriceChange(legacy, CHECKED_AT)?.delta).toBeCloseTo(-.42);
    expect(latestOfficialPriceChange({ byFuelType: { '95': { self: { ...legacy.byFuelType!['95']!.self!, current: { pricePerLiter: 7.35 } } } } }, CHECKED_AT)).toBeNull();
  });
  it('does not repeat a change for a same-price notice', () => {
    const data = withPublicPrices(null, { ...SNAPSHOT, notices: [OCTOBER, NOVEMBER, { ...FIFTH, price: 7.35 }] }, CHECKED_AT);
    expect(latestOfficialPriceChange(data, NOVEMBER_FIFTH)).toBeNull();
  });
  it('preserves a later admin override and does not recast the manual price as official evidence', () => {
    const now = NOVEMBER_FIFTH + 2000;
    const manual: RegulatedPriceConfig = { byFuelType: { '95': { self: { history: { '2026-11': 7.5 }, source: 'manual',
      current: { pricePerLiter: 7.5, effectiveFrom: NOVEMBER_START }, manualOverride: { month: '2026-11', pricePerLiter: 7.5, setAt: NOVEMBER_FIFTH + 1000 } } } } };
    const data = withPublicPrices(manual, { ...SNAPSHOT, readAt: now, notices: SNAPSHOT.notices.map(p => ({ ...p, readAt: now })) }, now);
    expect(officialPriceFor(data, '95', now)).toMatchObject({ price: 7.5, isManual: true, isRegulated: false });
    expect(data?.byFuelType?.['95']?.self?.manualOverride?.pricePerLiter).toBe(7.5);
    expect(Object.values(data?.byFuelType?.['95']?.self?.timeline ?? {})).not.toContain(7.5);
    expect(latestOfficialPriceChange(data, now)).toBeNull();
  });
  it('keeps an override before activation and expires only an older override under the existing policy', () => {
    const data = config();
    data.byFuelType!['95']!.self!.manualOverride = { month: '2026-11', pricePerLiter: 7.5, setAt: CHECKED_AT - 1000 };
    expect(officialPriceFor(data, '95', CHECKED_AT)).toMatchObject({ price: 7.5, isManual: true });
    expect(upcomingOfficialPrice(data, CHECKED_AT)?.change).toBeNull();
    expect(officialPriceFor(data, '95', NOVEMBER_FIFTH)).toMatchObject({ price: 7.85, isRegulated: true });
  });
  it('expires advance confidence and refuses to activate a distant notice without a timely recheck', () => {
    const stale = { ...FIFTH, readAt: NOVEMBER_FIFTH - 4 * 86_400_000 };
    const data = withPublicPrices(null, { notices: [NOVEMBER, stale], readAt: CHECKED_AT }, CHECKED_AT);
    expect(upcomingOfficialPrice(data, CHECKED_AT)).toBeNull();
    expect(officialPriceFor(data, '95', NOVEMBER_FIFTH).price).toBe(7.35);
    const reopened = withPublicPrices(data, { notices: [NOVEMBER, stale], readAt: CHECKED_AT }, NOVEMBER_FIFTH + 1000);
    expect(officialPriceFor(reopened, '95', NOVEMBER_FIFTH + 1000).price).toBe(7.35);
  });
  it('does not let an old checked-URL cache cancel a newer server notice', () => {
    const data = config();
    const older = { notices: [NOVEMBER], checkedUrls: [FIFTH.url], readAt: CHECKED_AT - 1000 };
    expect(upcomingOfficialPrice(withPublicPrices(data, older, CHECKED_AT), CHECKED_AT)?.pricePerLiter).toBe(7.85);
  });
  it('preserves a withdrawal through normalization and prevents a stale cache from restoring it', () => {
    const nextTime = CHECKED_AT + 1000;
    const cancelled = withPublicPrices(config(), { notices: [NOVEMBER], checkedUrls: [FIFTH.url], readAt: nextTime }, nextTime);
    const normalized = normalizePriceDocument(JSON.parse(JSON.stringify(cancelled)));
    expect(normalized.byFuelType?.['95']?.self?.notices?.[NOVEMBER_FIFTH]).toMatchObject({ withdrawn: true, retrievedAt: nextTime });
    const replayed = withPublicPrices(normalized, SNAPSHOT, nextTime);
    expect(upcomingOfficialPrice(replayed, nextTime)).toBeNull();
    expect(officialPriceFor(replayed, '95', NOVEMBER_FIFTH).price).toBe(7.35);
  });
  it('keeps a current price on unavailable data and never supplies 95 to diesel', () => {
    const data = config();
    expect(withPublicPrices(data, null)).toBe(data);
    expect(regulatedMaxPrice(data, 'diesel', CHECKED_AT).price).toBeNull();
  });
});

describe('withdrawal learned after the scheduled activation', () => {
  it('revokes an advance-only notice and its already-promoted local timeline/current aliases', () => {
    const justAfter = NOVEMBER_FIFTH + 1;
    const promoted = withPublicPrices(config(), SNAPSHOT, justAfter)!;
    expect(promoted.byFuelType?.['95']?.self?.current?.pricePerLiter).toBe(7.85);
    const rechecked = { notices: [{ ...NOVEMBER, readAt: justAfter }], checkedUrls: [FIFTH.url, NOVEMBER.url], readAt: justAfter };
    const cancelled = withPublicPrices(promoted, rechecked, justAfter)!;
    expect(cancelled.byFuelType?.['95']?.self?.current?.pricePerLiter).toBe(7.35);
    expect(officialPriceFor(cancelled, '95', justAfter).price).toBe(7.35);
    expect(officialPriceFor(normalizePriceDocument(JSON.parse(JSON.stringify(cancelled))), '95', justAfter).price).toBe(7.35);
  });
  it('does not erase an active price that the official page had already confirmed after activation', () => {
    const after = NOVEMBER_FIFTH + 1000;
    const active = withPublicPrices(config(), { ...SNAPSHOT, readAt: after, notices: [{ ...FIFTH, readAt: after }] }, after);
    const later = after + 1000;
    const rechecked = withPublicPrices(active, { notices: [{ ...NOVEMBER, readAt: later }], checkedUrls: [FIFTH.url], readAt: later }, later);
    expect(officialPriceFor(rechecked, '95', later).price).toBe(7.85);
    expect(rechecked?.byFuelType?.['95']?.self?.notices?.[NOVEMBER_FIFTH]?.withdrawn).toBe(false);
  });
});
