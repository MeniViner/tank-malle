import { parsePublicAnnouncement, readPublicPrice, type PublicPriceReading } from './publicSource';
export { announcementTarget } from './publicSource';
export type BrowserPriceReading = PublicPriceReading;
export function parseBrowserAnnouncement(raw: string): number | null { return parsePublicAnnouncement(raw)?.price ?? null; }
export const fetchBrowserPrice = readPublicPrice;
const KEY = 'tm.official-price.v2';
let inFlight: Promise<BrowserPriceReading> | null = null;
export function cachedPublicPrice(): BrowserPriceReading | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null');
    return p && p.price >= 3 && p.price <= 15 && Number.isFinite(p.effectiveFrom) && p.effectiveFrom <= Date.now() && /^https:\/\/www\.gov\.il\/he\/pages\/fuel-/.test(p.url) ? p : null;
  } catch { return null; }
}
/** A bounded background refresh on entry/resume; never blocks the app. */
export function refreshPublicPrice(): Promise<BrowserPriceReading> {
  const cached = cachedPublicPrice();
  if (cached && Date.now() - cached.readAt < 6 * 3_600_000) return Promise.resolve(cached);
  if (!inFlight) inFlight = fetchBrowserPrice().then(reading => {
    const latest = cached && cached.effectiveFrom > reading.effectiveFrom ? { ...cached, readAt: reading.readAt } : reading;
    try { localStorage.setItem(KEY, JSON.stringify(latest)); } catch { /* Storage may be unavailable. */ }
    return latest;
  }).finally(() => { inFlight = null; });
  return inFlight;
}
