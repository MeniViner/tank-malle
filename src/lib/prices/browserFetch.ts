import { mergePublicSnapshots, noticeFromReading, parsePublicAnnouncement, readPublicPrice, readPublicPrices, type PublicPriceReading, type PublicPriceSnapshot } from './publicSource';
export { announcementTarget } from './publicSource';
export type BrowserPriceReading = PublicPriceReading;
export function parseBrowserAnnouncement(raw: string): number | null { return parsePublicAnnouncement(raw)?.price ?? null; }
export const fetchBrowserPrice = readPublicPrice;
export const fetchBrowserPrices = readPublicPrices;
const KEY = 'tm.official-price.v3';
let inFlight: Promise<PublicPriceSnapshot> | null = null;

export function cachedPublicPrices(): PublicPriceSnapshot | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!value || !Number.isFinite(value.readAt) || value.readAt > Date.now() || !Array.isArray(value.notices)) return null;
    const notices = value.notices.filter((p: PublicPriceReading) => p && noticeFromReading(p) && p.readAt <= Date.now());
    return { readAt: value.readAt, notices, checkedUrls: Array.isArray(value.checkedUrls) ? value.checkedUrls.filter((url: unknown) => typeof url === 'string') : [] };
  } catch { return null; }
}

/** A bounded background refresh on entry/resume; it also checks for newly published future prices. */
export function refreshPublicPrices(): Promise<PublicPriceSnapshot> {
  const cached = cachedPublicPrices();
  if (cached && Date.now() - cached.readAt < 2 * 3_600_000) return Promise.resolve(cached);
  if (!inFlight) inFlight = fetchBrowserPrices().then(snapshot => {
    const latest = mergePublicSnapshots(cached, snapshot);
    try { localStorage.setItem(KEY, JSON.stringify(latest)); } catch { /* Storage may be unavailable. */ }
    return latest;
  }).finally(() => { inFlight = null; });
  return inFlight;
}
