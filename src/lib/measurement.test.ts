import { describe, expect, it } from "vitest";
import { computeStats, type Fillup } from "./stats";
import { measurementCopy, measurementCounts } from "./measurement";
import { TANK_SCHEMA_VERSION } from "./tank/config";

const day = 86_400_000;
const base = new Date("2026-01-05T08:00:00Z").getTime();
function fill(id: string, offset: number, odometer: number, liters: number, opts: Partial<Fillup> = {}): Fillup {
  return { id, date: base + offset * day, odometer, liters, pricePerLiter: 7, totalCost: liters * 7,
    isFullTank: true, station: null, notes: null, ...opts };
}

describe("measurement sheet counts", () => {
  it("counts fills, full fills, segments and no restarts on one continuous run", () => {
    const stats = computeStats([fill("a", 0, 1000, 40), fill("b", 10, 1500, 20, { isFullTank: false }), fill("c", 20, 2000, 30)]);
    const counts = measurementCounts(stats);
    expect(counts).toEqual({ fills: 3, full: 2, restarts: 0, segments: stats.segments.length });
    expect(measurementCopy(counts)).toEqual({ fullLine: "2 מהם עד הסוף", restartLine: "רצף אחד, בלי פספוסים" });
  });

  it("uses the engine's closing rule: a v2 unknown end state is not a full fill", () => {
    const stats = computeStats([
      fill("a", 0, 1000, 40),
      fill("b", 10, 1500, 20, { isFullTank: false, fillEndState: "unknown", tankSchemaVersion: TANK_SCHEMA_VERSION }),
      fill("c", 20, 2000, 30, { fillEndState: "full", tankSchemaVersion: TANK_SCHEMA_VERSION }),
    ]);
    expect(measurementCounts(stats).full).toBe(2);
  });

  it("reports declared continuity breaks as restarts, matching stats.breakCount", () => {
    const stats = computeStats([
      fill("a", 0, 1000, 40), fill("b", 10, 1500, 30),
      fill("c", 30, 3000, 40, { continuityBreakBefore: true }), fill("d", 40, 3500, 30),
      fill("e", 60, 5000, 40, { continuityBreakBefore: true }),
    ]);
    const counts = measurementCounts(stats);
    expect(counts.restarts).toBe(stats.breakCount);
    expect(counts.restarts).toBe(2);
    expect(measurementCopy(counts).restartLine).toBe("2 נקודות התחלה מחדש");
    expect(measurementCopy({ ...counts, restarts: 1 }).restartLine).toBe("נקודת התחלה מחדש אחת");
  });

  it("handles an empty history", () => {
    expect(measurementCounts(computeStats([]))).toEqual({ fills: 0, full: 0, restarts: 0, segments: 0 });
  });
});
