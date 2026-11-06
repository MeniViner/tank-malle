import { describe, expect, it, vi } from 'vitest';
import { announcementTarget, fetchBrowserPrice, parseBrowserAnnouncement } from './browserFetch';
import { PRICE_NEWS_URL } from './publicSource';
import { adminMonthlyNoticeFixture } from './__fixtures__/officialNotices';
const body = 'המחיר המרבי לליטר בנזין 95 בשירות עצמי לא יעלה על 8.27 שקלים. המחיר באילת בשירות עצמי לא יעלה על 7.01 שקלים.';
describe('independent browser price read', () => {
  it('uses the current Israel month at the UTC boundary', () => {
    expect(announcementTarget(Date.parse('2026-09-30T22:00:00Z'))).toEqual({month:'2026-10',url:'https://www.gov.il/he/pages/fuel-october-2026'});
  });
  it('accepts only the explicit mainland self-service price', () => {
    expect(parseBrowserAnnouncement(body)).toBe(8.27);
    expect(parseBrowserAnnouncement('באילת בשירות עצמי לא יעלה על 7.01 שקלים.')).toBeNull();
    expect(parseBrowserAnnouncement('שירות מלא לא יעלה על 8.53 שקלים.')).toBeNull();
    expect(parseBrowserAnnouncement(body.replace('8.27','827'))).toBeNull();
  });
  it('discovers a mid-month publication and uses the public reader after CORS failure', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (!url.startsWith('https://r.jina.ai/')) throw new TypeError('CORS');
      if (url.includes('collectors')) return new Response('https://www.gov.il/he/pages/fuel-october-5-2026 https://www.gov.il/he/pages/fuel-october-2026');
      return url.endsWith('fuel-october-5-2026') ? new Response('בחצות הלילה (5.10.2026), יעודכנו המחירים. ' + body.replace('8.27', '7.77')) : new Response('', { status: 404 });
    });
    const result = await fetchBrowserPrice(Date.parse('2026-10-16'), fetcher as typeof fetch);
    expect(result.price).toBe(7.77);
    expect(result.effectiveFrom).toBe(Date.parse('2026-10-04T21:00:00Z'));
    expect(result.via).toBe('public-reader');
    expect(fetcher.mock.calls.some(([url]) => url === 'https://r.jina.ai/https://www.gov.il/he/pages/fuel-october-5-2026')).toBe(true);
  });
  it('reads the same dated monthly fixture used by the admin browser test, including at the Israel month boundary', async () => {
    const now = Date.parse('2026-10-31T22:00:00Z');
    const notice = adminMonthlyNoticeFixture(now);
    const fetcher = vi.fn(async (url: string) => {
      if (!url.startsWith('https://r.jina.ai/')) throw new TypeError('CORS');
      if (url === `https://r.jina.ai/${PRICE_NEWS_URL}`) return new Response(notice.url);
      return url === `https://r.jina.ai/${notice.url}` ? new Response(notice.body) : new Response('', { status: 404 });
    });
    expect(await fetchBrowserPrice(now, fetcher as typeof fetch)).toMatchObject({
      price: 8.27, month: '2026-11', effectiveFrom: Date.parse('2026-10-31T22:00:00Z'),
      effectiveDateSource: 'notice', via: 'public-reader', url: 'https://www.gov.il/he/pages/fuel-november-2026',
    });
    const targets = [PRICE_NEWS_URL, 'https://www.gov.il/he/pages/fuel-october-2026', notice.url, 'https://www.gov.il/he/pages/fuel-december-2026'];
    expect(fetcher.mock.calls.map(([url]) => url).toSorted()).toEqual(targets.flatMap(url => [url, `https://r.jina.ai/${url}`]).toSorted());
  });
  it('rejects an undated price even when fetched from a monthly official URL', async () => {
    const fetcher = vi.fn(async () => new Response(body));
    await expect(fetchBrowserPrice(Date.parse('2026-11-06T12:00:00Z'), fetcher)).rejects.toThrow('המקור אינו זמין');
  });
  it('rejects challenge pages instead of presenting them as a successful update', async () => {
    const fetcher = vi.fn(async () => new Response(`Target URL returned error 403 ${body}`));
    await expect(fetchBrowserPrice(Date.parse('2026-10-01'), fetcher)).rejects.toThrow('המקור אינו זמין');
  });
});
