import type { Fillup } from '../stats';
const DAY = 86_400_000;
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const i = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2; };
/** Purchase cadence is observable even when an imported record's tank level is unknown. */
export function usageInsights(fillups: readonly Fillup[], now: number) {
  const recent = fillups.filter(f => f.date <= now && now - f.date <= 180 * DAY && f.liters > 0).sort((a, b) => a.date - b.date);
  const gaps = recent.slice(1).flatMap((f, i) => {
    const days = (f.date - recent[i].date) / DAY;
    return !f.continuityBreakBefore && days >= 1 && days <= 60 && f.odometer >= recent[i].odometer ? [days] : [];
  });
  return {
    count: recent.length,
    typicalLiters: recent.length >= 3 ? median(recent.map(f => f.liters)) : null,
    cadenceDays: gaps.length >= 3 ? median(gaps) : null,
  };
}
