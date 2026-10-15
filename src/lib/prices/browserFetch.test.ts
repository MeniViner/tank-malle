import { describe, expect, it, vi } from 'vitest';
import { announcementTarget, fetchBrowserPrice, parseBrowserAnnouncement } from './browserFetch';
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
      return new Response(body.replace('8.27', '7.77'));
    });
    const result = await fetchBrowserPrice(Date.parse('2026-10-16'), fetcher as typeof fetch);
    expect(result.price).toBe(7.77);
    expect(result.effectiveFrom).toBe(Date.parse('2026-10-04T21:00:00Z'));
    expect(result.via).toBe('public-reader');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('rejects challenge pages instead of presenting them as a successful update', async () => {
    const fetcher = vi.fn(async () => new Response(`Target URL returned error 403 ${body}`));
    await expect(fetchBrowserPrice(Date.parse('2026-10-01'), fetcher)).rejects.toThrow('המקור אינו זמין');
  });
});
