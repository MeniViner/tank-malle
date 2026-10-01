/** A user-triggered public-source read. No Firebase, job, credentials or writes. */
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export interface BrowserPriceReading {
  price: number;
  month: string;
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

/** Require the mainland self-service ceiling, never the Eilat or full-service price. */
export function parseBrowserAnnouncement(raw: string): number | null {
  const text = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
  const sentence = text.split(/(?<=\.)\s+/).find(s => s.includes('שירות עצמי') && s.includes('לא יעלה על') && !s.includes('אילת'));
  const match = sentence?.match(/לא יעלה על\s+(\d+[.,]\d+)\s*ש/);
  const price = match ? Number(match[1].replace(',', '.')) : NaN;
  return Number.isFinite(price) && price >= 3 && price <= 15 ? price : null;
}

export async function fetchBrowserPrice(now = Date.now(), fetcher: typeof fetch = fetch): Promise<BrowserPriceReading> {
  const target = announcementTarget(now);
  const attempts = [
    { via: 'direct' as const, url: target.url },
    { via: 'public-reader' as const, url: `https://r.jina.ai/${target.url}` },
  ];
  for (const attempt of attempts) {
    try {
      const response = await fetcher(attempt.url, {
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) continue;
      const body = await response.text();
      // Reader error/challenge pages sometimes use HTTP 200.
      if (/Target URL returned error|Just a moment|Attention Required/i.test(body)) continue;
      const price = parseBrowserAnnouncement(body);
      if (price !== null) return { ...target, price, via: attempt.via, readAt: Date.now() };
    } catch { /* CORS, timeout or connectivity: try the public reader once. */ }
  }
  throw new Error('לא הצלחנו לקרוא מחיר לחודש הנוכחי. המקור עשוי לחסום קריאה מהדפדפן או להיות לא זמין. אפשר לנסות שוב או להזין ידנית.');
}
