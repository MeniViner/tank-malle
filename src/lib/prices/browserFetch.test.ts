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
  it('attempts direct reading first, then the public reader on CORS failure', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('CORS')).mockResolvedValueOnce(new Response(body));
    const result = await fetchBrowserPrice(Date.parse('2026-10-01'), fetcher);
    expect(result.price).toBe(8.27);
    expect(result.via).toBe('public-reader');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toContain('https://www.gov.il/');
    expect(fetcher.mock.calls[1][1].credentials).toBe('omit');
  });
  it('never falls back to a previous month or mistakes a failed reader for success', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(`Target URL returned error 403 ${body}`));
    await expect(fetchBrowserPrice(Date.parse('2026-10-01'), fetcher)).rejects.toThrow('לא הצלחנו');
    expect(fetcher.mock.calls.every(call => call[0].includes('october-2026'))).toBe(true);
  });
});
