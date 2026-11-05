import { describe, expect, it, vi } from 'vitest';
import { announcementTarget, israelMidnight, mergePublicSnapshots, parsePublicNotice, publicationLinks, readPublicPrices } from './publicSource';
import { CHECKED_AT, FIFTH, NOVEMBER, NOVEMBER_BODY, NOVEMBER_FIFTH, NOVEMBER_FIFTH_BODY, NOVEMBER_START, OCTOBER, SNAPSHOT } from './__fixtures__/officialNotices';

describe('official dated notices', () => {
  it('uses the explicit midnight date, separately from publication date and a zero-padded URL', () => {
    expect(parsePublicNotice(NOVEMBER_FIFTH_BODY)).toEqual({ price: 7.85, fullService: 8.11, effectiveFrom: NOVEMBER_FIFTH, publishedOn: '2026-11-04' });
  });
  it('keeps a conditional excise scenario out of confirmed upcoming prices', () => {
    expect(parsePublicNotice(NOVEMBER_BODY)).toMatchObject({ price: 7.35, effectiveFrom: NOVEMBER_START });
    expect(parsePublicNotice('אם ההקלה לא תחודש, ' + NOVEMBER_FIFTH_BODY.slice(NOVEMBER_FIFTH_BODY.indexOf('בחצות')))).toBeNull();
    expect(parsePublicNotice('בהתאם לצו, ' + NOVEMBER_FIFTH_BODY.slice(NOVEMBER_FIFTH_BODY.indexOf('בחצות')))?.price).toBe(7.85);
  });
  it('requires an explicit unambiguous effective date instead of inferring it from relative midnight or metadata', () => {
    expect(parsePublicNotice(NOVEMBER_FIFTH_BODY.replace('(4.11.2026-5.11.2026)', 'היום'))).toBeNull();
    expect(parsePublicNotice(NOVEMBER_FIFTH_BODY.replace('(4.11.2026-5.11.2026)', '(4.11.2026 או 5.11.2026)'))).toBeNull();
    expect(parsePublicNotice(NOVEMBER_FIFTH_BODY.replace('(4.11.2026-5.11.2026)', '(4.11.2026-6.11.2026)'))).toBeNull();
    expect(parsePublicNotice(NOVEMBER_FIFTH_BODY.replace('(4.11.2026-5.11.2026)', '(31.11.2026)'))).toBeNull();
  });
  it('handles month/year and DST boundaries at Israel midnight', () => {
    expect(israelMidnight(2026, 3, 27)).toBe(Date.parse('2026-03-26T22:00:00Z'));
    expect(israelMidnight(2026, 10, 25)).toBe(Date.parse('2026-10-24T21:00:00Z'));
    expect(parsePublicNotice(NOVEMBER_FIFTH_BODY.replace('(4.11.2026-5.11.2026)', '(31.12.2026-1.1.2027)'))?.effectiveFrom).toBe(Date.parse('2026-12-31T22:00:00Z'));
    expect(announcementTarget(Date.parse('2026-10-31T22:00:00Z')).month).toBe('2026-11');
  });
  it('discovers future and relative official links but never adopts a foreign hostname or a far-off notice', () => {
    const links = publicationLinks(`${FIFTH.url} ${NOVEMBER.url} https://evil.example/he/pages/fuel-november-04-2026 /he/pages/fuel-december-2026 https://www.gov.il/he/pages/fuel-march-2027`, CHECKED_AT);
    expect(links).toEqual(['https://www.gov.il/he/pages/fuel-december-2026', FIFTH.url, NOVEMBER.url]);
  });
  it('reads the monthly baseline and future dated notice together, even if the user missed the month start', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('collectors')) return new Response(FIFTH.url);
      if (value === FIFTH.url) return new Response(NOVEMBER_FIFTH_BODY);
      if (value === NOVEMBER.url) return new Response(NOVEMBER_BODY);
      return new Response('', { status: 404 });
    });
    const result = await readPublicPrices(CHECKED_AT, fetcher);
    expect(result.notices.map(p => [p.price, p.effectiveFrom])).toEqual([[7.35, NOVEMBER_START], [7.85, NOVEMBER_FIFTH]]);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('fuel-december-2026'))).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('fuel-october-2026'))).toBe(true);
  });
  it('uses body dates even when the URL disagrees, and never manufactures activation from the URL', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('collectors') ? new Response(FIFTH.url)
      : String(url) === FIFTH.url ? new Response(NOVEMBER_BODY) : new Response('', { status: 404 }));
    const snapshot = await readPublicPrices(CHECKED_AT, fetcher);
    expect(snapshot.notices[0].effectiveFrom).toBe(NOVEMBER_START);
  });
  it('does not roll back a correction or preserve a superseded future date from a reread page', () => {
    const corrected = { ...FIFTH, price: 7.8, readAt: CHECKED_AT + 1000 };
    expect(mergePublicSnapshots(SNAPSHOT, { notices: [corrected], readAt: corrected.readAt }).notices.at(-1)?.price).toBe(7.8);
    expect(mergePublicSnapshots({ notices: [corrected], readAt: corrected.readAt }, SNAPSHOT).notices.at(-1)?.price).toBe(7.8);
    const withdrawn = mergePublicSnapshots(SNAPSHOT, { notices: [OCTOBER, NOVEMBER], checkedUrls: [FIFTH.url], readAt: CHECKED_AT + 1000 });
    expect(withdrawn.notices.some(p => p.url === FIFTH.url)).toBe(false);
    const afterMidnight = mergePublicSnapshots(SNAPSHOT, { notices: [NOVEMBER], checkedUrls: [FIFTH.url], readAt: NOVEMBER_FIFTH + 1 });
    expect(afterMidnight.notices.some(p => p.url === FIFTH.url)).toBe(false);
  });
});
