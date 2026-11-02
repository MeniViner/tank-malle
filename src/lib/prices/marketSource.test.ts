import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedMarketPrice, MARKET_PRICE_URL, MARKET_REFRESH_MS, marketPriceIsStale, parseMarketPrice, readMarketPrice, refreshMarketPrice } from './marketSource';

const html = readFileSync(new URL('./__fixtures__/delek-list-2026-11.html', import.meta.url), 'utf8');
const now = Date.parse('2026-11-01T10:00:00Z');
const markdown = `עודכן בתאריך: 01/11/2026
| | שירות מלא | באילת |
| --- | --- | --- |
| בנזין 95 | ₪7.61 לליטר | ₪6.45 לליטר |
| בנזין 98 | ₪9.66 לליטר | ₪8.19 לליטר |
| סולר | ₪12.05 לליטר | ₪10.21 לליטר |`;

function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  return values;
}
afterEach(() => vi.unstubAllGlobals());

describe('Delek list prices are separate from the official 95 price', () => {
  it('reads the dated mainland full-service column of the real reduced table', () => {
    expect(parseMarketPrice(html, now)).toEqual({ prices: { '98': 9.66, diesel: 12.05 }, effectiveFrom: Date.parse('2026-10-31T22:00:00Z') });
    expect(Object.keys(parseMarketPrice(html, now)!.prices)).not.toContain('95');
  });

  it('follows the column heading when Eilat precedes mainland', () => {
    const reordered = html.replace(/<tr[^>]*>(.*?)<\/tr>/g, (row: string) => {
      const cells = row.match(/<t[dh]\b[^>]*>.*?<\/t[dh]>/g)!;
      return `<tr>${cells[0]}${cells[2]}${cells[1]}</tr>`;
    });
    expect(parseMarketPrice(reordered, now)?.prices).toEqual({ '98': 9.66, diesel: 12.05 });
  });

  it('parses the public reader table without flattening its columns', () => {
    expect(parseMarketPrice(markdown, now)).toEqual(parseMarketPrice(html, now));
    expect(parseMarketPrice(markdown.replace('שירות מלא', 'באילת'), now)).toBeNull();
  });

  it('rejects missing, duplicate and conflicting product readings', () => {
    expect(parseMarketPrice(markdown.replace('| סולר | ₪12.05 לליטר | ₪10.21 לליטר |', ''), now)).toBeNull();
    for (const value of ['12.05', '11.20']) {
      expect(parseMarketPrice(`${markdown}\n| סולר | ₪${value} לליטר | ₪10.21 לליטר |`, now)).toBeNull();
    }
    expect(parseMarketPrice(markdown.replace('₪12.05 לליטר', '₪12.05 / ₪11.20'), now)).toBeNull();
    expect(parseMarketPrice(markdown.replace('₪12.05', '₪1205'), now)).toBeNull();
  });

  it('requires one unambiguous valid publication date, allowing repeated identical labels on the source', () => {
    expect(parseMarketPrice(html.replace('עודכן בתאריך : 01/11/2026', ''), now)).toBeNull();
    expect(parseMarketPrice(html.replace('01/11/2026', '31/11/2026'), now)).toBeNull();
    expect(parseMarketPrice(`${html}<p>עודכן בתאריך: 01/10/2026</p>`, now)).toBeNull();
    expect(parseMarketPrice(`${html}<p>עודכן בתאריך: 01/11/2026</p>`, now)).toEqual(parseMarketPrice(html, now));
    expect(parseMarketPrice(html, Date.parse('2026-10-31T21:59:59Z'))).toBeNull();
  });

  it('uses the public reader after a failed direct request, with no credentials or referrer', async () => {
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      expect(options?.credentials).toBe('omit');
      expect(options?.referrerPolicy).toBe('no-referrer');
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      if (url === MARKET_PRICE_URL) throw new TypeError('CORS');
      expect(url).toBe(`https://r.jina.ai/${MARKET_PRICE_URL}`);
      return new Response(markdown);
    });
    const reading = await readMarketPrice(now, fetcher as typeof fetch);
    expect(reading.via).toBe('public-reader');
    expect(reading.prices).toEqual({ '98': 9.66, diesel: 12.05 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retains the last good cached prices when refresh fails and marks them stale', async () => {
    storage();
    const saved = await refreshMarketPrice(now, vi.fn(async () => new Response(html)), true);
    const later = now + MARKET_REFRESH_MS + 1;
    await expect(refreshMarketPrice(later, vi.fn(async () => new Response('down', { status: 503 })))).rejects.toThrow('המחיר האחרון נשמר');
    expect(cachedMarketPrice(later)).toEqual(saved);
    expect(marketPriceIsStale(saved, later)).toBe(true);
  });

  it('reuses a fresh cache and refuses an older upstream date without resetting freshness', async () => {
    storage();
    const saved = await refreshMarketPrice(now, vi.fn(async () => new Response(html)), true);
    const fetcher = vi.fn(async () => new Response(html.replace('01/11/2026', '01/10/2026')));
    expect(await refreshMarketPrice(now + 1, fetcher)).toEqual(saved);
    expect(fetcher).not.toHaveBeenCalled();
    const later = now + MARKET_REFRESH_MS + 1;
    expect(await refreshMarketPrice(later, fetcher)).toEqual(saved);
    expect(marketPriceIsStale(cachedMarketPrice(later)!, later)).toBe(true);
  });

  it('deduplicates simultaneous requests', async () => {
    storage();
    let release!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
    const first = refreshMarketPrice(now, fetcher, true);
    const second = refreshMarketPrice(now, fetcher, true);
    expect(first).toBe(second);
    release(new Response(html));
    await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects cache data from other fuel/service/region scopes', async () => {
    const values = storage();
    const saved = await refreshMarketPrice(now, vi.fn(async () => new Response(html)), true);
    const key = [...values.keys()][0];
    for (const extra of [{ prices: { ...saved.prices, '95': 7.61 } }, { region: 'eilat' }, { serviceMode: 'self' }, { effectiveFrom: now + 1 }]) {
      values.set(key, JSON.stringify({ ...saved, ...extra }));
      expect(cachedMarketPrice(now)).toBeNull();
    }
  });
});
