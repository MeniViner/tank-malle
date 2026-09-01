import { describe, expect, it } from "vitest";
import {
  buildIslands,
  buildOpenSegment,
  buildSegments,
  computeStats,
  evaluateDraft,
  filterSegmentsByRange,
  softWarnings,
  validTrackedKm,
  type Fillup,
  type Vehicle,
} from "./stats";

const day = 86_400_000;
const base = new Date("2026-01-05T08:00:00Z").getTime();

function fill(
  id: string,
  dayOffset: number,
  odometer: number,
  liters: number,
  opts: Partial<Fillup> = {},
): Fillup {
  const pricePerLiter = opts.pricePerLiter ?? 7;
  return {
    id,
    date: base + dayOffset * day,
    odometer,
    liters,
    pricePerLiter,
    totalCost: opts.totalCost ?? Math.round(liters * pricePerLiter * 100) / 100,
    isFullTank: opts.isFullTank ?? true,
    station: null,
    notes: null,
    ...opts,
  };
}

const vehicle: Vehicle = {
  id: "v1",
  make: "מאזדה",
  model: "3",
  year: 2018,
  fuelType: "95",
  tankLiters: 51,
  declaredKmPerLiter: 15,
  priceAdjustment: 0,
  archived: false,
};

/* ------------------------------------------------------------------ *
 * The canonical formula
 * ------------------------------------------------------------------ */

describe("canonical segment formula", () => {
  it("excludes the opening full tank's liters and includes every partial", () => {
    // The worked example from the brief:
    //   100,000 full · 100,300 +20 partial · 100,600 +25 full
    //   → 600 / (20 + 25) = 13.33 km/L
    const list = [
      fill("a", 0, 100_000, 40),
      fill("b", 3, 100_300, 20, { isFullTank: false }),
      fill("c", 6, 100_600, 25),
    ];
    const segments = buildSegments(list);
    expect(segments).toHaveLength(1);
    expect(segments[0].liters).toBe(45);
    expect(segments[0].km).toBe(600);
    expect(segments[0].kmPerLiter).toBeCloseTo(13.333, 2);
  });

  it("gives no segment from a single full fill-up (baseline only)", () => {
    expect(buildSegments([fill("a", 0, 100_000, 40)])).toHaveLength(0);
  });

  it("accumulates several partials into one segment", () => {
    const segments = buildSegments([
      fill("a", 0, 1_000, 40),
      fill("b", 1, 1_100, 10, { isFullTank: false }),
      fill("c", 2, 1_200, 10, { isFullTank: false }),
      fill("d", 3, 1_300, 10, { isFullTank: false }),
      fill("e", 4, 1_400, 10),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].liters).toBe(40);
    expect(segments[0].kmPerLiter).toBeCloseTo(10, 5);
  });

  it("ignores leading partials — a segment can only open at a full tank", () => {
    const segments = buildSegments([
      fill("a", 0, 1_000, 15, { isFullTank: false }),
      fill("b", 1, 1_100, 15, { isFullTank: false }),
      fill("c", 2, 1_200, 40),
      fill("d", 3, 1_600, 40),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].startOdometer).toBe(1_200);
    expect(segments[0].km).toBe(400);
  });
});

/* ------------------------------------------------------------------ *
 * Continuity breaks
 * ------------------------------------------------------------------ */

describe("continuity breaks", () => {
  const withBreak = [
    fill("a", 0, 1_000, 40),
    fill("b", 5, 1_400, 40),
    fill("c", 40, 3_000, 40, { continuityBreakBefore: true }),
    fill("d", 45, 3_400, 40),
  ];

  it("splits the list into islands at the break", () => {
    const islands = buildIslands(withBreak);
    expect(islands).toHaveLength(2);
    expect(islands[0].map((f) => f.id)).toEqual(["a", "b"]);
    expect(islands[1].map((f) => f.id)).toEqual(["c", "d"]);
  });

  it("never produces a segment that crosses the break", () => {
    const segments = buildSegments(withBreak);
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => [s.startId, s.endId])).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    // The 1,400 → 3,000 stretch is never attributed to anyone.
    expect(segments.some((s) => s.km === 1_600)).toBe(false);
  });

  it("a break record that ended full becomes the new baseline", () => {
    const segments = buildSegments(withBreak);
    expect(segments[1].startId).toBe("c");
    expect(segments[1].km).toBe(400);
  });

  it("a break record that was partial leaves no valid baseline until a full one", () => {
    const list = [
      fill("a", 0, 1_000, 40),
      fill("b", 40, 3_000, 20, { continuityBreakBefore: true, isFullTank: false }),
      fill("c", 45, 3_400, 30, { isFullTank: false }),
      fill("d", 50, 3_800, 40),
      fill("e", 55, 4_200, 40),
    ];
    const segments = buildSegments(list);
    // Nothing closes until d establishes a baseline and e closes it.
    expect(segments).toHaveLength(1);
    expect(segments[0].startId).toBe("d");
    expect(segments[0].endId).toBe("e");
    expect(segments[0].km).toBe(400);
  });

  it("keeps historical records before the break visible", () => {
    const stats = computeStats(withBreak, vehicle);
    expect(stats.fillups).toHaveLength(4);
    expect(stats.records.fillupCount).toBe(4);
  });

  it("raw spend and raw liters still span every period", () => {
    const stats = computeStats(withBreak, vehicle);
    expect(stats.records.totalLiters).toBeCloseTo(160, 5);
    expect(stats.records.totalCost).toBeCloseTo(1_120, 5);
  });

  it("valid tracked distance is the sum of island spans, not last minus first", () => {
    // Islands span 400 and 400. The naive figure would be 3,400 − 1,000 = 2,400.
    expect(validTrackedKm(withBreak)).toBe(800);
    expect(computeStats(withBreak, vehicle).totalKm).toBe(800);
  });

  it("cost per valid km uses segment cost over segment distance only", () => {
    const stats = computeStats(withBreak, vehicle);
    const segCost = stats.segments.reduce((sum, s) => sum + s.cost, 0);
    const segKm = stats.segments.reduce((sum, s) => sum + s.km, 0);
    expect(stats.avgCostPerKm).toBeCloseTo(segCost / segKm, 4);
  });

  it("counts declared breaks", () => {
    expect(computeStats(withBreak, vehicle).breakCount).toBe(1);
    expect(computeStats(withBreak.map((f) => ({ ...f, continuityBreakBefore: false })), vehicle)
      .breakCount).toBe(0);
  });

  it("a backdated break re-splits the islands correctly", () => {
    const backdated = [
      fill("a", 0, 1_000, 40),
      fill("b", 5, 1_400, 40),
      fill("mid", 3, 1_200, 40, { continuityBreakBefore: true }),
    ];
    const islands = buildIslands(backdated);
    expect(islands.map((i) => i.map((f) => f.id))).toEqual([["a"], ["mid", "b"]]);
    expect(buildSegments(backdated).map((s) => [s.startId, s.endId])).toEqual([
      ["mid", "b"],
    ]);
  });

  it("removing the break flag merges the islands back into one", () => {
    const merged = withBreak.map((f) =>
      f.id === "c" ? { ...f, continuityBreakBefore: false } : f,
    );
    expect(buildIslands(merged)).toHaveLength(1);
    expect(buildSegments(merged)).toHaveLength(3);
    expect(validTrackedKm(merged)).toBe(2_400);
  });

  it("leaves a gap in the odometer series rather than drawing across the break", () => {
    const stats = computeStats(withBreak, vehicle);
    const breakPoint = stats.odometerSeries.find((p) => p.odometer === 3_000);
    // The record that opens a new island is flagged so the chart can break
    // the line instead of interpolating 1,400 → 3,000.
    expect(breakPoint?.gapBefore).toBe(true);
    expect(stats.odometerSeries.filter((p) => p.gapBefore).length).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * Open segment
 * ------------------------------------------------------------------ */

describe("open segment", () => {
  it("is empty with no records", () => {
    const open = buildOpenSegment([]);
    expect(open.hasBaseline).toBe(false);
    expect(open.nextFullWillClose).toBe(false);
  });

  it("reports a baseline with nothing pending after one full fill-up", () => {
    const open = buildOpenSegment([fill("a", 0, 1_000, 40)]);
    expect(open.hasBaseline).toBe(true);
    expect(open.baselineId).toBe("a");
    expect(open.liters).toBe(0);
    expect(open.pendingFillups).toBe(0);
    expect(open.nextFullWillClose).toBe(true);
  });

  it("accumulates pending partial liters, cost and distance", () => {
    const open = buildOpenSegment([
      fill("a", 0, 1_000, 40),
      fill("b", 1, 1_150, 12, { isFullTank: false }),
      fill("c", 2, 1_300, 14.8, { isFullTank: false }),
    ]);
    expect(open.baselineId).toBe("a");
    expect(open.liters).toBeCloseTo(26.8, 5);
    expect(open.pendingFillups).toBe(2);
    expect(open.km).toBe(300);
    expect(open.cost).toBeCloseTo(187.6, 2);
  });

  it("has no baseline while only partials exist", () => {
    const open = buildOpenSegment([fill("a", 0, 1_000, 20, { isFullTank: false })]);
    expect(open.hasBaseline).toBe(false);
  });

  it("discards an open segment stranded before a break", () => {
    const open = buildOpenSegment([
      fill("a", 0, 1_000, 40),
      fill("b", 1, 1_200, 20, { isFullTank: false }),
      fill("c", 40, 3_000, 40, { continuityBreakBefore: true }),
    ]);
    // The 20 L pending before the break can never be closed validly.
    expect(open.baselineId).toBe("c");
    expect(open.liters).toBe(0);
    expect(open.pendingFillups).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Draft evaluation — what the post-save message is allowed to say
 * ------------------------------------------------------------------ */

describe("evaluateDraft", () => {
  it("reports a baseline for the first full fill-up, with no consumption", () => {
    const result = evaluateDraft(
      { date: base, odometer: 1_000, liters: 40, pricePerLiter: 7, isFullTank: true },
      [],
    );
    expect(result.outcome).toBe("baseline");
    expect(result.segment).toBeNull();
  });

  it("reports a partial as retained, with the open-segment liters", () => {
    const result = evaluateDraft(
      {
        date: base + 2 * day,
        odometer: 1_150,
        liters: 12,
        pricePerLiter: 7,
        isFullTank: false,
      },
      [fill("a", 0, 1_000, 40)],
    );
    expect(result.outcome).toBe("partialRetained");
    expect(result.segment).toBeNull();
    expect(result.openSegment.liters).toBeCloseTo(12, 5);
  });

  it("reports a partial with no baseline distinctly", () => {
    const result = evaluateDraft(
      { date: base, odometer: 1_000, liters: 12, pricePerLiter: 7, isFullTank: false },
      [],
    );
    expect(result.outcome).toBe("partialNoBaseline");
  });

  it("reports the real segment when a full fill-up closes one", () => {
    const result = evaluateDraft(
      { date: base + 6 * day, odometer: 100_600, liters: 25, pricePerLiter: 7, isFullTank: true },
      [
        fill("a", 0, 100_000, 40),
        fill("b", 3, 100_300, 20, { isFullTank: false }),
      ],
    );
    expect(result.outcome).toBe("closedSegment");
    // 600 km over 20 + 25 L — NOT 300 / 25, which the old post-save toast showed.
    expect(result.segment?.km).toBe(600);
    expect(result.segment?.liters).toBe(45);
    expect(result.segment?.kmPerLiter).toBeCloseTo(13.333, 2);
  });

  it("does not report a segment across a continuity break", () => {
    const result = evaluateDraft(
      {
        date: base + 40 * day,
        odometer: 3_000,
        liters: 40,
        pricePerLiter: 7,
        isFullTank: true,
        continuityBreakBefore: true,
      },
      [fill("a", 0, 1_000, 40)],
    );
    expect(result.outcome).toBe("baseline");
    expect(result.segment).toBeNull();
    expect(result.startsNewPeriod).toBe(true);
  });

  it("excludes the record being edited from its own evaluation", () => {
    const existing = [
      fill("a", 0, 1_000, 40),
      fill("b", 4, 1_400, 40),
    ];
    const result = evaluateDraft(
      { date: base + 4 * day, odometer: 1_500, liters: 40, pricePerLiter: 7, isFullTank: true },
      existing,
      "b",
    );
    expect(result.segment?.km).toBe(500);
  });
});

/* ------------------------------------------------------------------ *
 * Soft warnings run through the same engine
 * ------------------------------------------------------------------ */

describe("consumption soft warning", () => {
  it("stays silent for a partial fill-up — no segment closes, so nothing to judge", () => {
    // The old formula would have computed 150 km / 2 L = 75 km/L and shouted.
    const warnings = softWarnings(
      { date: base + day, odometer: 1_150, liters: 2, pricePerLiter: 7, isFullTank: false },
      [fill("a", 0, 1_000, 40)],
      vehicle,
    );
    expect(warnings.some((w) => w.field === "consumption")).toBe(false);
  });

  it("stays silent when an intervening partial makes the naive figure wrong", () => {
    // Naive: (1,600 − 1,300) / 8 = 37.5 km/L → borderline nonsense.
    // Canonical: 600 km / (20 + 8) = 21.4 km/L → high but not absurd.
    const warnings = softWarnings(
      { date: base + 6 * day, odometer: 1_600, liters: 8, pricePerLiter: 7, isFullTank: true },
      [
        fill("a", 0, 1_000, 40),
        fill("b", 3, 1_300, 20, { isFullTank: false }),
      ],
      vehicle,
    );
    expect(warnings.some((w) => w.field === "consumption")).toBe(false);
  });

  it("warns on a genuinely impossible closed segment", () => {
    const warnings = softWarnings(
      { date: base + 6 * day, odometer: 5_000, liters: 5, pricePerLiter: 7, isFullTank: true },
      [fill("a", 0, 1_000, 40)],
      vehicle,
    );
    const warning = warnings.find((w) => w.field === "consumption");
    expect(warning).toBeDefined();
    expect(warning?.detail).toContain("800");
  });

  it("does not warn from a formula that crosses a continuity break", () => {
    const warnings = softWarnings(
      {
        date: base + 40 * day,
        odometer: 9_000,
        liters: 40,
        pricePerLiter: 7,
        isFullTank: true,
        continuityBreakBefore: true,
      },
      [fill("a", 0, 1_000, 40)],
      vehicle,
    );
    expect(warnings.some((w) => w.field === "consumption")).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Range semantics
 * ------------------------------------------------------------------ */

describe("segment range filtering", () => {
  const list = [
    fill("a", 0, 1_000, 40),
    fill("b", 30, 1_400, 40),
    fill("c", 60, 1_800, 40),
  ];

  it("keeps a segment whose opening fill-up is outside the range", () => {
    const segments = buildSegments(list);
    // Range starts after 'b' — the a→b segment is out, but b→c survives even
    // though 'b' itself opened before the window.
    const from = base + 45 * day;
    const filtered = filterSegmentsByRange(segments, from, null);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].startId).toBe("b");
    expect(filtered[0].km).toBe(400);
  });

  it("filters by closing date, not opening date", () => {
    const segments = buildSegments(list);
    const filtered = filterSegmentsByRange(segments, null, base + 35 * day);
    expect(filtered.map((s) => s.endId)).toEqual(["b"]);
  });
});
