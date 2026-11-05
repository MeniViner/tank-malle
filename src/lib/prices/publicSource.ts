/** Public Ministry notices only. Shared by the browser and the Node job. */
export const PRICE_NEWS_URL = "https://www.gov.il/he/collectors/news?officeId=0caee7eb-1ebb-4c12-9ed8-7dce94badcb2&limit=50";
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAY = 86_400_000;
const NOTICE_URL = /^https:\/\/www\.gov\.il\/he\/pages\/fuel-[a-z]+(?:-\d{1,2})?-\d{4}$/;
const CONDITIONAL = /\bif\b|(?:^|[\s:;(])(?:אם|ככל|במידה|בכפוף)(?=\s)|צפוי|הערכה|טרם אושר/i;
export const NOTICE_FRESHNESS_MS = 48 * 3_600_000;

export interface PublicPriceReading {
  price: number;
  fullService: number | null;
  month: string;
  effectiveFrom: number;
  /** A date printed by the publisher, not an invented publication clock time. */
  publishedOn?: string | null;
  /** Older caches inferred the date from the URL and cannot establish a future notice. */
  effectiveDateSource?: 'notice';
  url: string;
  via: 'direct' | 'public-reader';
  readAt: number;
}

export interface PublicPriceSnapshot {
  notices: PublicPriceReading[];
  readAt: number;
  /** Successfully read pages; a former future notice absent from its page is no longer confirmed. */
  checkedUrls?: string[];
}

/** Per-service evidence. Future notices are separate from current/history. */
export interface OfficialPriceNotice {
  pricePerLiter: number;
  effectiveFrom: number;
  sourceUrl: string;
  retrievedAt: number;
  publishedOn: string | null;
  via: 'direct' | 'public-reader';
  withdrawn?: boolean;
}

export function israelMonthKey(now: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`;
}

export function announcementTarget(now: number) {
  const month = israelMonthKey(now);
  return { month, url: `https://www.gov.il/he/pages/fuel-${MONTHS[Number(month.slice(5)) - 1]}-${month.slice(0, 4)}` };
}

/** Israel midnight, independent of the browser/runner timezone and including DST. */
export function israelMidnight(year: number, month: number, day: number): number | null {
  const utc = Date.UTC(year, month - 1, day);
  const calendar = new Date(utc);
  if (year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1 || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const formatter = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' });
  let at = utc;
  for (let i = 0; i < 3; i++) {
    const zone = formatter.formatToParts(at).find(p => p.type === 'timeZoneName')!.value;
    at = utc - Number(zone.replace('GMT', '')) * 3_600_000;
  }
  return at;
}

/** URL dates are discovery hints ONLY. An effective date must come from the notice body. */
export function publicationDate(url: string): number | null {
  const m = url.match(/^https:\/\/www\.gov\.il\/he\/pages\/fuel-([a-z]+)(?:-(\d{1,2}))?-(\d{4})$/);
  return m && MONTHS.includes(m[1]) ? israelMidnight(Number(m[3]), MONTHS.indexOf(m[1]) + 1, Number(m[2] || 1)) : null;
}

function plainText(raw: string): string {
  return raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&quot;|&#34;/g, '"')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
}

function mainlandQuote(text: string) {
  for (const match of text.matchAll(/[\s\S]+?(?:[.!?](?=\s)|$)/g)) {
    const sentence = match[0];
    if (!/בנזין\s+95/.test(sentence) || !sentence.includes('שירות עצמי') || sentence.includes('אילת') || CONDITIONAL.test(sentence)) continue;
    const amount = sentence.match(/לא יעלה על\s+(\d+[.,]\d+)\s*ש/);
    const price = amount ? Number(amount[1].replace(',', '.')) : NaN;
    if (Number.isFinite(price) && price >= 3 && price <= 15) return { price, index: match.index!, end: match.index! + sentence.length };
  }
  return null;
}

export function parsePublicAnnouncement(raw: string) {
  const text = plainText(raw);
  const quote = mainlandQuote(text);
  if (!quote) return null;
  const after = text.slice(quote.end, quote.end + 350);
  const surcharge = after.match(/תוספת בעד שירות מלא תעמוד על\s+(\d+)\s*אגורות/);
  if (surcharge && after.slice(0, surcharge.index).includes('אילת')) return { price: quote.price, fullService: null };
  const amount = surcharge ? Number(surcharge[1]) : NaN;
  return { price: quote.price, fullService: Number.isFinite(amount) && amount >= 0 && amount <= 200 ? Math.round((quote.price + amount / 100) * 100) / 100 : null };
}

function calendarDate(text: string) {
  const match = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  const at = israelMidnight(year, month, day);
  return at === null ? null : { at, calendar: Date.UTC(year, month - 1, day), day: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

/** Only an explicit, unconditional dated midnight clause establishes activation. */
export function parsePublicNotice(raw: string) {
  const text = plainText(raw), price = parsePublicAnnouncement(raw), quote = mainlandQuote(text);
  if (!price || !quote) return null;
  // The operative clause precedes the mainland price. Later tax scenarios are not notices.
  const introduction = text.slice(0, quote.end);
  const effective: number[] = [];
  for (const match of introduction.matchAll(/בחצות(?:\s+הלילה|\s+לילה)?[^()]{0,160}\(([^()]{1,100})\)/g)) {
    const previousStop = introduction.lastIndexOf('. ', match.index!);
    const sentenceStart = previousStop < 0 ? 0 : previousStop + 2;
    if (CONDITIONAL.test(introduction.slice(sentenceStart, match.index! + match[0].length))) continue;
    const dates = [...match[1].matchAll(/\d{1,2}[./]\d{1,2}[./]\d{4}/g)];
    if (dates.length === 1 && match[1].trim() === dates[0][0]) {
      const parsed = calendarDate(dates[0][0]);
      if (parsed) effective.push(parsed.at);
    } else if (dates.length === 2 && /^\s*\d{1,2}[./]\d{1,2}[./]\d{4}\s*[-–—]\s*\d{1,2}[./]\d{1,2}[./]\d{4}\s*$/.test(match[1])) {
      const first = calendarDate(dates[0][0]), second = calendarDate(dates[1][0]);
      // A night between two dates starts the SECOND date, even across a month/year/DST boundary.
      if (first && second && second.calendar - first.calendar === DAY) effective.push(second.at);
    }
  }
  const distinct = [...new Set(effective)];
  if (distinct.length !== 1) return null;
  const published = text.match(/תאריך פרסום\s*:?\s*(\d{1,2}[./]\d{1,2}[./]\d{4})/);
  return { ...price, effectiveFrom: distinct[0], publishedOn: published ? calendarDate(published[1])?.day ?? null : null };
}

export function publicationLinks(text: string, now: number): string[] {
  // Consume complete foreign URLs, so their pathname cannot be mistaken for a relative gov.il link.
  const matches = text.match(/https?:\/\/[^\s"'<>()[\]]+|(?<![\w/.:])\/he\/pages\/fuel-[a-z]+(?:-\d{1,2})?-\d{4}(?![\w-])/g) ?? [];
  return [...new Set(matches.map(url => url.startsWith('/') ? `https://www.gov.il${url}` : url))]
    .filter(url => { const at = publicationDate(url); return at !== null && now - at < 100 * DAY && at - now < 45 * DAY; })
    .sort((a, b) => publicationDate(b)! - publicationDate(a)!);
}

/** Preserve dated evidence. A monthly bucket alone cannot prove when a price started. */
export function priceTimeline(previous: { timeline?: Record<string, number>; scheduledHistory?: Record<string, number>; source?: string; current?: { effectiveFrom?: number; pricePerLiter?: number } | null } | undefined, reading: { month: string; effectiveFrom: number; price: number }) {
  const timeline = { ...previous?.timeline };
  const previousAt = previous?.current?.effectiveFrom;
  if (previousAt && previousAt < reading.effectiveFrom && !timeline[previousAt] && (previous?.source === 'scheduled' || previous?.source === 'import')) {
    const oldPrice = previous.current?.pricePerLiter ?? previous.scheduledHistory?.[israelMonthKey(previousAt)];
    if (oldPrice && oldPrice > 0) timeline[previousAt] = oldPrice;
  }
  return { ...timeline, [reading.effectiveFrom]: reading.price };
}

export function isOfficialNotice(value: unknown): value is OfficialPriceNotice {
  if (!value || typeof value !== 'object') return false;
  const p = value as OfficialPriceNotice;
  return p.withdrawn !== true && Number.isFinite(p.pricePerLiter) && p.pricePerLiter >= 3 && p.pricePerLiter <= 17
    && Number.isFinite(p.effectiveFrom) && Number.isFinite(p.retrievedAt) && p.retrievedAt > 0
    && typeof p.sourceUrl === 'string' && NOTICE_URL.test(p.sourceUrl) && publicationDate(p.sourceUrl) !== null
    && (p.via === 'direct' || p.via === 'public-reader')
    && (p.publishedOn === null || typeof p.publishedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.publishedOn));
}

export function noticeFromReading(reading: PublicPriceReading, full = false): OfficialPriceNotice | null {
  const pricePerLiter = full ? reading.fullService : reading.price;
  if (reading.effectiveDateSource !== 'notice' || pricePerLiter === null || !Number.isFinite(reading.price) || reading.price < 3 || reading.price > 15
      || !Number.isFinite(reading.effectiveFrom) || reading.month !== israelMonthKey(reading.effectiveFrom)) return null;
  const notice = { pricePerLiter, effectiveFrom: reading.effectiveFrom, sourceUrl: reading.url, retrievedAt: reading.readAt, publishedOn: reading.publishedOn ?? null, via: reading.via, withdrawn: false };
  return isOfficialNotice(notice) ? notice : null;
}

export function mergePublicSnapshots(previous: PublicPriceSnapshot | null, next: PublicPriceSnapshot): PublicPriceSnapshot {
  const notices = new Map<number, PublicPriceReading>();
  for (const reading of [...previous?.notices ?? [], ...next.notices]) {
    if (!noticeFromReading(reading)) continue;
    if (reading.readAt < reading.effectiveFrom && reading.readAt <= next.readAt && next.checkedUrls?.includes(reading.url)
      && !next.notices.some(p => p.url === reading.url && p.effectiveFrom === reading.effectiveFrom)) continue;
    const existing = notices.get(reading.effectiveFrom);
    if (!existing || reading.readAt >= existing.readAt) notices.set(reading.effectiveFrom, reading);
  }
  return { notices: [...notices.values()].sort((a, b) => a.effectiveFrom - b.effectiveFrom).slice(-120), readAt: next.readAt, checkedUrls: next.checkedUrls ?? [] };
}

async function read(url: string, fetcher: typeof fetch) {
  for (const via of ['direct', 'public-reader'] as const) {
    try {
      const response = await fetcher(via === 'direct' ? url : `https://r.jina.ai/${url}`, {
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) continue;
      const body = await response.text();
      if (/Target URL returned error|Just a moment|Attention Required/i.test(body)) continue;
      return { body, via };
    } catch { /* Retry through the public reader. No personal data is sent. */ }
  }
  return null;
}

export async function readPublicPrices(now = Date.now(), fetcher: typeof fetch = fetch): Promise<PublicPriceSnapshot> {
  const index = await read(PRICE_NEWS_URL, fetcher);
  const [year, month] = israelMonthKey(now).split('-').map(Number);
  const fallback = [-1, 0, 1].map(offset => announcementTarget(Date.UTC(year, month - 1 + offset, 15)).url);
  const targets = [...new Set([...(index ? publicationLinks(index.body, now).slice(0, 5) : []), ...fallback])];
  const readings = await Promise.all(targets.map(async url => {
    const page = await read(url, fetcher), parsed = page && parsePublicNotice(page.body);
    if (!page || !parsed || now - parsed.effectiveFrom > 100 * DAY || parsed.effectiveFrom - now > 45 * DAY) return { url, checked: !!page, reading: null };
    return { url, checked: true, reading: { ...parsed, effectiveDateSource: 'notice' as const, month: israelMonthKey(parsed.effectiveFrom), url, via: page.via, readAt: now } };
  }));
  const notices = readings.map(p => p.reading).filter((p): p is NonNullable<typeof p> => p !== null);
  if (!notices.length) throw new Error('המקור אינו זמין כרגע. המחיר האחרון נשמר; אפשר לנסות שוב בהמשך.');
  return mergePublicSnapshots(null, { notices, readAt: now, checkedUrls: readings.filter(p => p.checked).map(p => p.url) });
}

/** Compatibility for callers that only need the active price, never an upcoming one. */
export async function readPublicPrice(now = Date.now(), fetcher: typeof fetch = fetch): Promise<PublicPriceReading> {
  const snapshot = await readPublicPrices(now, fetcher);
  const current = snapshot.notices.filter(p => p.effectiveFrom <= now).at(-1);
  if (!current) throw new Error('המקור אינו זמין כרגע. המחיר האחרון נשמר; אפשר לנסות שוב בהמשך.');
  return current;
}
