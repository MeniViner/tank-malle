import { isPlausiblePrice } from './types';

/** A network's published list price, never an official ceiling or a paid receipt. */
export const MARKET_PRICE_URL = 'https://delek.co.il/מחירון/';
export const MARKET_REFRESH_MS = 6 * 3_600_000;
const KEY = 'tm.delek-list-price.v1';
export type MarketFuelType = '98' | 'diesel';
export interface MarketPriceReading {
  prices: Record<MarketFuelType, number>;
  effectiveFrom: number;
  readAt: number;
  url: typeof MARKET_PRICE_URL;
  provider: 'delek';
  serviceMode: 'full';
  region: 'mainland';
  via: 'direct' | 'public-reader';
}

function text(raw: string): string {
  return raw.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&#8362;|&#x20aa;/gi, '₪')
    .replace(/[\u200e\u200f\u202a-\u202e*_`]/g, '').replace(/\s+/g, ' ').trim();
}

function datedPublication(raw: string, now: number): number | null {
  const dates = [...text(raw).matchAll(/עודכן בתאריך\s*:\s*(\S+)/g)].map(match => match[1]);
  if (!dates.length || new Set(dates).size !== 1) return null;
  const date = dates[0].match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!date) return null;
  const [, day, month, year] = date.map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const value = new Date(utc);
  if (year < 2000 || value.getUTCDate() !== day || value.getUTCMonth() !== month - 1 || value.getUTCFullYear() !== year) return null;
  const offset = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' })
    .formatToParts(utc).find(part => part.type === 'timeZoneName')?.value;
  const hours = Number(offset?.replace('GMT', ''));
  if (!Number.isFinite(hours)) return null;
  const at = utc - hours * 3_600_000;
  return at <= now ? at : null;
}

function tables(raw: string): string[][][] {
  if (/<table\b/i.test(raw)) return [...raw.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(table =>
    [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => text(cell[1]))));
  // The public reader emits Markdown. Keep column boundaries and the empty
  // product-header cell; flattening the text would confuse mainland and Eilat.
  const result: string[][][] = [];
  let rows: string[][] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split('|').map(text);
      if (!cells.every(cell => /^:?-+:?$/.test(cell))) rows.push(cells);
    } else if (rows.length) { result.push(rows); rows = []; }
  }
  if (rows.length) result.push(rows);
  return result;
}

/** Fail closed if the labelled column, products or dated publication is ambiguous. */
export function parseMarketPrice(raw: string, now = Date.now()): Pick<MarketPriceReading, 'prices' | 'effectiveFrom'> | null {
  if (raw.length > 2_000_000 || /Target URL returned error|Just a moment|Attention Required/i.test(raw)) return null;
  const effectiveFrom = datedPublication(raw, now);
  if (effectiveFrom === null) return null;
  const candidates = tables(raw).filter(rows => rows.some(row => row.includes('שירות מלא'))
    && rows.some(row => row.includes('בנזין 98')) && rows.some(row => row.includes('סולר')));
  if (candidates.length !== 1) return null;
  const rows = candidates[0];
  const headers = rows.filter(row => row.includes('שירות מלא'));
  if (headers.length !== 1 || headers[0].filter(cell => cell === 'שירות מלא').length !== 1) return null;
  const column = headers[0].indexOf('שירות מלא');
  const prices = {} as Record<MarketFuelType, number>;
  for (const [fuel, label] of [['98', 'בנזין 98'], ['diesel', 'סולר']] as const) {
    const matching = rows.filter(row => row.includes(label));
    if (matching.length !== 1 || matching[0].length !== headers[0].length) return null;
    const match = matching[0][column]?.match(/^₪\s*(\d+(?:[.,]\d{1,3})?)\s*(?:לליטר)?$/);
    const value = match ? Number(match[1].replace(',', '.')) : NaN;
    if (!isPlausiblePrice(fuel, value)) return null;
    prices[fuel] = value;
  }
  return { prices, effectiveFrom };
}

export async function readMarketPrice(now = Date.now(), fetcher: typeof fetch = fetch): Promise<MarketPriceReading> {
  for (const via of ['direct', 'public-reader'] as const) {
    try {
      const response = await fetcher(via === 'direct' ? MARKET_PRICE_URL : `https://r.jina.ai/${MARKET_PRICE_URL}`, {
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) continue;
      const parsed = parseMarketPrice(await response.text(), now);
      if (parsed) return { ...parsed, url: MARKET_PRICE_URL, provider: 'delek', serviceMode: 'full', region: 'mainland', via, readAt: now };
    } catch { /* Retry the same public publication, without account information. */ }
  }
  throw new Error('מחירון דלק לא זמין כרגע. המחיר האחרון נשמר.');
}

export function cachedMarketPrice(now = Date.now()): MarketPriceReading | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null') as MarketPriceReading | null;
    return p && p.provider === 'delek' && p.serviceMode === 'full' && p.region === 'mainland' && p.url === MARKET_PRICE_URL
      && (p.via === 'direct' || p.via === 'public-reader') && p.prices && Object.keys(p.prices).sort().join(',') === '98,diesel'
      && isPlausiblePrice('98', p.prices['98']) && isPlausiblePrice('diesel', p.prices.diesel)
      && Number.isFinite(p.effectiveFrom) && p.effectiveFrom > 0 && p.effectiveFrom <= now
      && Number.isFinite(p.readAt) && p.readAt >= p.effectiveFrom && p.readAt <= now ? p : null;
  } catch { return null; }
}

let inFlight: Promise<MarketPriceReading> | null = null;
export function refreshMarketPrice(now = Date.now(), fetcher: typeof fetch = fetch, force = false): Promise<MarketPriceReading> {
  const cached = cachedMarketPrice(now);
  if (!force && cached && now - cached.readAt < MARKET_REFRESH_MS) return Promise.resolve(cached);
  if (!inFlight) inFlight = readMarketPrice(now, fetcher).then(reading => {
    // A stale upstream page must not roll back a newer known publication.
    const latest = cached && cached.effectiveFrom > reading.effectiveFrom ? cached : reading;
    try { localStorage.setItem(KEY, JSON.stringify(latest)); } catch { /* Private mode may disable storage. */ }
    return latest;
  }).finally(() => { inFlight = null; });
  return inFlight;
}

export function marketPriceIsStale(reading: MarketPriceReading, now = Date.now()): boolean {
  return now - reading.readAt >= MARKET_REFRESH_MS || now - reading.effectiveFrom > 35 * 86_400_000;
}
