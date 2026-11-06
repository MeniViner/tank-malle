import { consumption, int } from "../format";
import type { Fillup, Stats } from "../stats";
import { resolveEndState } from "../tank/observations";
import type { SpotlightItem } from "./spotlight";

const DAY = 86_400_000;

function confirmedFull(fillup: Fillup): boolean {
  const end = resolveEndState(fillup);
  return end.state === "full" && end.source === "user-confirmed";
}

export interface SustainedConsumptionInput {
  now: number;
  stats: Stats;
  units: "kmPerLiter" | "litersPer100";
  historyComplete?: boolean;
}

/** Compare adjacent, disjoint measured periods, never the last fill with itself. */
export function sustainedConsumptionSpotlight(input: SustainedConsumptionInput): SpotlightItem | null {
  const { now, stats, units } = input;
  if (input.historyComplete === false || !Number.isFinite(now) || stats.segments.length < 6) return null;
  // Do not skip an unreliable recent segment to manufacture a cleaner trend.
  const segments = stats.segments.slice(-6);
  const first = segments[0], last = segments[5];
  if (last.endDate > now || now - last.endDate > 30 * DAY || now - first.startDate > 180 * DAY) return null;
  const island = stats.islands.at(-1) ?? [];
  const start = island.findIndex(fillup => fillup.id === first.startId);
  const end = island.findIndex(fillup => fillup.id === last.endId);
  if (start < 0 || end <= start) return null;
  const rows = island.slice(start, end + 1);
  const ids = new Set(rows.map(fillup => fillup.id));
  if (ids.size !== rows.length || stats.anomalies.some(anomaly => ids.has(anomaly.fillupId))) return null;
  if (rows.some((fillup, index) => !Number.isFinite(fillup.date) || fillup.date > now
      || !Number.isFinite(fillup.odometer) || fillup.odometer < 0
      || !Number.isFinite(fillup.liters) || fillup.liters <= 0
      || index > 0 && (fillup.continuityBreakBefore || fillup.date <= rows[index - 1].date
        || fillup.odometer < rows[index - 1].odometer))) return null;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (index > 0 && segment.startId !== segments[index - 1].endId) return null;
    const a = rows.findIndex(fillup => fillup.id === segment.startId);
    const b = rows.findIndex(fillup => fillup.id === segment.endId);
    if (a < 0 || b <= a || !confirmedFull(rows[a]) || !confirmedFull(rows[b])) return null;
    const liters = rows.slice(a + 1, b + 1).reduce((sum, fillup) => sum + fillup.liters, 0);
    if (!Number.isFinite(segment.km) || segment.km < 100 || !Number.isFinite(segment.liters) || segment.liters < 10
        || segment.km !== rows[b].odometer - rows[a].odometer || Math.abs(segment.liters - liters) > .00051) return null;
  }
  const weighted = (from: number, to: number) => {
    const selected = segments.slice(from, to);
    return selected.reduce((sum, segment) => sum + segment.km, 0)
      / selected.reduce((sum, segment) => sum + segment.liters, 0);
  };
  const baseline = weighted(0, 3), recent = weighted(3, 6);
  const deterioration = (baseline / recent - 1) * 100;
  // Each recent interval must also be worse: one unusual trip is not sustained.
  if (!Number.isFinite(deterioration) || deterioration < 15 - 1e-9
      || segments.slice(3).some(segment => segment.km / segment.liters >= baseline)) return null;
  const before = consumption(baseline, units), after = consumption(recent, units);
  return {
    id: `consumption-trend:${first.startId}:${last.endId}:${baseline}:${recent}`,
    tone: "warn", icon: "chart",
    title: `${int(Math.round(deterioration))}% יותר דלק לק״מ לאורך 3 מקטעים`,
    body: `${after.value} ${after.unit} בממוצע ב־3 המקטעים האחרונים, לעומת ${before.value} ${before.unit} ב־3 הקודמים. כדאי לבדוק אם תנאי הנסיעה השתנו.`,
    target: { kind: "segment", endId: last.endId },
  };
}
