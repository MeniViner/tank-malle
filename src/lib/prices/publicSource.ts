/** Public Ministry publications only. Shared by the browser and the Node job. */
export const PRICE_NEWS_URL = "https://www.gov.il/he/collectors/news?officeId=0caee7eb-1ebb-4c12-9ed8-7dce94badcb2&limit=50";
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export interface PublicPriceReading {
  price: number;
  fullService: number | null;
  month: string;
  effectiveFrom: number;
  url: string;
  via: 'direct' | 'public-reader';
  readAt: number;
}
export function announcementTarget(now: number) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  return { month: `${year}-${month}`, url: `https://www.gov.il/he/pages/fuel-${MONTHS[Number(month) - 1]}-${year}` };
}
export function parsePublicAnnouncement(raw: string) {
  const text = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
  const sentence = text.split(/(?<=\.)\s+/).find(s => s.includes('שירות עצמי') && s.includes('לא יעלה על') && !s.includes('אילת'));
  const match = sentence?.match(/לא יעלה על\s+(\d+[.,]\d+)\s*ש/);
  const price = match ? Number(match[1].replace(',', '.')) : NaN;
  if (!Number.isFinite(price) || price < 3 || price > 15) return null;
  const surcharge = text.match(/תוספת בעד שירות מלא תעמוד על\s+(\d+)\s*אגורות/);
  return { price, fullService: surcharge ? Math.round((price + Number(surcharge[1]) / 100) * 100) / 100 : null };
}
/** Dates are Israel midnight, including the daylight-saving offset. */
export function publicationDate(url: string): number | null {
  const m = url.match(/^https:\/\/www\.gov\.il\/he\/pages\/fuel-([a-z]+)(?:-(\d{1,2}))?-(\d{4})$/);
  if (!m || !MONTHS.includes(m[1])) return null;
  const month = MONTHS.indexOf(m[1]);
  const day = Number(m[2] || 1);
  const utc = Date.UTC(Number(m[3]), month, day);
  if (day < 1 || new Date(utc).getUTCMonth() !== month) return null;
  const zone = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' }).formatToParts(utc).find(p => p.type === 'timeZoneName')!.value;
  return utc - Number(zone.replace('GMT', '')) * 3_600_000;
}
export function publicationLinks(text: string, now: number): string[] {
  return [...new Set(text.match(/https:\/\/www\.gov\.il\/he\/pages\/fuel-[a-z]+(?:-\d{1,2})?-\d{4}/g) ?? [])]
    .filter(url => { const at = publicationDate(url); return at !== null && at <= now && now - at < 100 * 86_400_000; })
    .sort((a, b) => publicationDate(b)! - publicationDate(a)!);
}
/** Preserve the previous monthly value when introducing the first dated update. */
export function priceTimeline(previous: { timeline?: Record<string, number>; scheduledHistory?: Record<string, number>; current?: { effectiveFrom?: number } | null } | undefined, reading: { month: string; effectiveFrom: number; price: number }) {
  const timeline = { ...previous?.timeline };
  const start = publicationDate(announcementTarget(reading.effectiveFrom).url)!;
  const previousAt = previous?.current?.effectiveFrom;
  const at = previousAt && previousAt >= start && previousAt < reading.effectiveFrom ? previousAt : start;
  const oldPrice = previous?.scheduledHistory?.[reading.month];
  if (at < reading.effectiveFrom && !timeline[at] && oldPrice && oldPrice > 0) timeline[at] = oldPrice;
  return { ...timeline, [reading.effectiveFrom]: reading.price };
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
export async function readPublicPrice(now = Date.now(), fetcher: typeof fetch = fetch): Promise<PublicPriceReading> {
  const index = await read(PRICE_NEWS_URL, fetcher);
  const targets = [...new Set([...(index ? publicationLinks(index.body, now) : []), announcementTarget(now).url])]
    .filter(url => publicationDate(url)! <= now)
    .sort((a, b) => publicationDate(b)! - publicationDate(a)!);
  for (const url of targets.slice(0, 5)) {
    const page = await read(url, fetcher);
    const parsed = page && parsePublicAnnouncement(page.body);
    if (parsed && page) {
      const effectiveFrom = publicationDate(url)!;
      return { ...parsed, effectiveFrom, month: announcementTarget(effectiveFrom).month, url, via: page.via, readAt: now };
    }
  }
  throw new Error('המקור אינו זמין כרגע. המחיר האחרון נשמר; אפשר לנסות שוב בהמשך.');
}
