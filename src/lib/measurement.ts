import type { Stats } from "./stats";
import { closesInterval } from "./tank/observations";

export interface MeasurementCounts {
  /** Every fill-up in the stats input. */
  fills: number;
  /** Fill-ups that close a measured interval ("עד הסוף"), by the same rule the segments use. */
  full: number;
  /** Declared continuity breaks ("נקודות התחלה מחדש"). */
  restarts: number;
  /** Closed, measured segments. */
  segments: number;
}

/**
 * The counts behind the measurement sheet ("מדידת הצריכה"). Read-only and
 * derived at read time from the same `Stats` the sheet already receives —
 * nothing here is stored. `full` uses `closesInterval`, so a legacy record and
 * a v2 record with an unknown end state are counted exactly as the consumption
 * engine treats them; `restarts` is `stats.breakCount` (also shown on Insights).
 */
export function measurementCounts(stats: Pick<Stats, "fillups" | "breakCount" | "segments">): MeasurementCounts {
  return {
    fills: stats.fillups.length,
    full: stats.fillups.filter(fillup => closesInterval(fillup)).length,
    restarts: Math.max(0, stats.breakCount),
    segments: stats.segments.length,
  };
}

/** Sub-lines from DESIGN-V3 (proto `Measure`): "N מהם עד הסוף" and the restart line. */
export function measurementCopy(counts: MeasurementCounts): { fullLine: string; restartLine: string } {
  return {
    fullLine: `${counts.full} מהם עד הסוף`,
    restartLine: counts.restarts === 0 ? "רצף אחד, בלי פספוסים"
      : counts.restarts === 1 ? "נקודת התחלה מחדש אחת" : `${counts.restarts} נקודות התחלה מחדש`,
  };
}
