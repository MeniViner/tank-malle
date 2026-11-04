import { adaptLegacyConfig, officialPriceFor, type RegulatedPriceConfig } from "../prices/regulated";
import { monthKey, type Fillup, type Segment } from "../stats";
import type { LedgerRow } from "../vehicle/derived";

/** Do not present a known subtotal as the cost of the entire measured segment. */
export function segmentContributors(segment: Segment, canonical: readonly Fillup[]) {
  const start = canonical.findIndex(fill => fill.id === segment.startId);
  const end = canonical.findIndex(fill => fill.id === segment.endId);
  if (start < 0 || end <= start) return { fills: [], costKnown: false };
  const fills = canonical.slice(start + 1, end + 1);
  return { fills, costKnown: fills.length === segment.fillupCount && fills.every(fill => !fill.totalCostUnknown && Number.isFinite(fill.totalCost)) };
}

/** Calendar months without purchases still belong to a vehicle's recorded span. */
export function averageMonthlyFuel(ledger: readonly LedgerRow[], today: string): number | null {
  const fuel = ledger.filter(row => row.kind === "fuel" && row.day <= today);
  if (!fuel.length || fuel.some(row => row.amountAgorot === null)) return null;
  const first = fuel.map(row => row.day).sort()[0];
  const [firstYear, firstMonth] = first.split("-").map(Number);
  const [year, month] = today.split("-").map(Number);
  const months = (year - firstYear) * 12 + month - firstMonth + 1;
  return months > 0 ? fuel.reduce((sum, row) => sum + row.amountAgorot!, 0) / 100 / months : null;
}

export interface OfficialPricePoint { month: string; at: number; value: number }

/** Only actual month evidence enters this history; a carried current value never does. */
export function officialPriceHistory(config: RegulatedPriceConfig | null, now: number): OfficialPricePoint[] {
  const series = adaptLegacyConfig(config).byFuelType?.["95"]?.self;
  if (!series) return [];
  const keys = new Set(Object.keys(series.history ?? {}));
  for (const at of Object.keys(series.timeline ?? {})) if (Number.isFinite(Number(at)) && Number(at) <= now) keys.add(monthKey(Number(at)));
  if (series.current?.effectiveFrom && series.current.effectiveFrom <= now) keys.add(monthKey(series.current.effectiveFrom));
  const current = monthKey(now);
  return [...keys].filter(key => /^\d{4}-(0[1-9]|1[0-2])$/.test(key) && key <= current).sort().flatMap(key => {
    const [year, month] = key.split("-").map(Number);
    const at = key === current ? now : new Date(year, month, 0, 23, 59, 59, 999).getTime();
    const lookup = officialPriceFor(config, "95", at);
    return lookup.price !== null && lookup.price > 0 && lookup.isRegulated && lookup.effectiveMonth === key
      ? [{ month: key, at: new Date(year, month - 1, 1, 12).getTime(), value: lookup.price }] : [];
  });
}
