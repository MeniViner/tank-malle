import { describe, expect, it } from "vitest";
import {
  buildSegments,
  computeStats,
  filterByRange,
  hardBlock,
  monthKey,
  odometerBounds,
  resolvePricePerLiter,
  softWarnings,
  sortFillups,
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
    station: opts.station ?? null,
    notes: opts.notes ?? null,
  };
}

const vehicle: Vehicle = {
  id: "v1",
  make: "מאזדה",
  model: "3",
  year: 2018,
  fuelType: "95",
  tankLiters: 51,
  declaredKmPerLiter: 16.2,
  priceAdjustment: 0,
  manualPricePerLiter: null,
  archived: false,
};

describe("sortFillups", () => {
  it("orders canonically by odometer, then date", () => {
    const list = [fill("c", 20, 3000, 40), fill("a", 0, 1000, 40), fill("b", 10, 2000, 40)];
    expect(sortFillups(list).map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate its input", () => {
    const list = [fill("b", 10, 2000, 40), fill("a", 0, 1000, 40)];
    sortFillups(list);
    expect(list.map((f) => f.id)).toEqual(["b", "a"]);
  });

  it("falls back to date when odometers tie", () => {
    const list = [fill("late", 5, 1000, 10), fill("early", 1, 1000, 10)];
    expect(sortFillups(list).map((f) => f.id)).toEqual(["early", "late"]);
  });
});

describe("buildSegments", () => {
  it("returns no segments for empty or single-fillup input", () => {
    expect(buildSegments([])).toEqual([]);
    expect(buildSegments(sortFillups([fill("a", 0, 1000, 40)]))).toEqual([]);
  });

  it("computes km/l between two consecutive full tanks", () => {
    const list = sortFillups([fill("a", 0, 1000, 40), fill("b", 10, 1500, 40)]);
    const [segment] = buildSegments(list);

    // 500 km on the 40 L that refilled them.
    expect(segment.km).toBe(500);
    expect(segment.liters).toBe(40);
    expect(segment.kmPerLiter).toBe(12.5);
    expect(segment.litersPer100).toBe(8);
    expect(segment.costPerKm).toBeCloseTo(280 / 500, 4);
    expect(segment.fillupCount).toBe(1);
  });

  it("uses the liters that refilled the distance, not the opening fill", () => {
    // Opening fill is deliberately huge; it must not affect the segment.
    const list = sortFillups([fill("a", 0, 1000, 60), fill("b", 10, 1500, 40)]);
    expect(buildSegments(list)[0].kmPerLiter).toBe(12.5);
  });

  it("rolls partial fill-ups into the open segment without closing it", () => {
    const list = sortFillups([
      fill("full1", 0, 1000, 40),
      fill("partial", 5, 1200, 15, { isFullTank: false }),
      fill("full2", 10, 1600, 35),
    ]);
    const segments = buildSegments(list);

    expect(segments).toHaveLength(1);
    expect(segments[0].startId).toBe("full1");
    expect(segments[0].endId).toBe("full2");
    expect(segments[0].km).toBe(600);
    expect(segments[0].liters).toBe(50); // 15 partial + 35 closing
    expect(segments[0].kmPerLiter).toBe(12);
    expect(segments[0].fillupCount).toBe(2);
  });

  it("handles several partials in a row", () => {
    const list = sortFillups([
      fill("full1", 0, 1000, 40),
      fill("p1", 2, 1100, 10, { isFullTank: false }),
      fill("p2", 4, 1200, 10, { isFullTank: false }),
      fill("p3", 6, 1300, 10, { isFullTank: false }),
      fill("full2", 8, 1500, 20),
    ]);
    const segments = buildSegments(list);

    expect(segments).toHaveLength(1);
    expect(segments[0].liters).toBe(50);
    expect(segments[0].kmPerLiter).toBe(10);
  });

  it("ignores leading partials until the first full tank establishes a baseline", () => {
    const list = sortFillups([
      fill("p", 0, 900, 20, { isFullTank: false }),
      fill("full1", 3, 1000, 30),
      fill("full2", 10, 1500, 40),
    ]);
    const segments = buildSegments(list);

    expect(segments).toHaveLength(1);
    expect(segments[0].startId).toBe("full1");
    expect(segments[0].liters).toBe(40);
  });

  it("skips zero-distance segments instead of dividing by zero", () => {
    const list = sortFillups([fill("a", 0, 1000, 40), fill("b", 1, 1000, 5)]);
    expect(buildSegments(list)).toEqual([]);
  });
});

describe("computeStats — averages", () => {
  const list = [
    fill("a", 0, 1000, 40),
    fill("b", 10, 1500, 40), // 500 km / 40 L = 12.5
    fill("c", 20, 2000, 50), // 500 km / 50 L = 10.0
  ];

  it("weights the average by distance rather than averaging ratios", () => {
    const stats = computeStats(list, vehicle);
    // 1000 km over 90 L, not (12.5 + 10) / 2.
    expect(stats.avgKmPerLiter).toBeCloseTo(1000 / 90, 3);
    expect(stats.avgLitersPer100).toBeCloseTo(100 / (1000 / 90), 3);
  });

  it("reports the last segment and its delta against the average", () => {
    const stats = computeStats(list, vehicle);
    expect(stats.lastSegment?.endId).toBe("c");
    expect(stats.lastSegment?.kmPerLiter).toBe(10);
    expect(stats.lastVsAvgPercent).toBeLessThan(0); // 10 is worse than 11.1
  });

  it("compares the average against the manufacturer figure", () => {
    const stats = computeStats(list, vehicle);
    expect(stats.vsDeclaredPercent).toBeCloseTo(((1000 / 90 - 16.2) / 16.2) * 100, 1);
  });

  it("computes estimated range from tank size", () => {
    const stats = computeStats(list, vehicle);
    expect(stats.estimatedRangeKm).toBe(Math.round(51 * (1000 / 90)));
  });

  it("returns nulls, not NaN, when there is nothing to derive", () => {
    const stats = computeStats([], vehicle);
    expect(stats.avgKmPerLiter).toBeNull();
    expect(stats.avgLitersPer100).toBeNull();
    expect(stats.avgCostPerKm).toBeNull();
    expect(stats.lastSegment).toBeNull();
    expect(stats.lastVsAvgPercent).toBeNull();
    expect(stats.estimatedRangeKm).toBeNull();
    expect(stats.totalKm).toBe(0);
    expect(stats.records.fillupCount).toBe(0);
    expect(stats.segments).toEqual([]);
  });

  it("handles a single fill-up without inventing a segment", () => {
    const stats = computeStats([fill("only", 0, 1000, 40)], vehicle);
    expect(stats.segments).toEqual([]);
    expect(stats.avgKmPerLiter).toBeNull();
    expect(stats.records.totalLiters).toBe(40);
    expect(stats.records.totalCost).toBe(280);
    expect(stats.totalKm).toBe(0);
  });

  it("works with no vehicle at all", () => {
    const stats = computeStats(list);
    expect(stats.avgKmPerLiter).toBeCloseTo(1000 / 90, 3);
    expect(stats.estimatedRangeKm).toBeNull();
    expect(stats.vsDeclaredPercent).toBeNull();
  });
});

describe("computeStats — backdated insert, edit and delete", () => {
  const original = [
    fill("a", 0, 1000, 40),
    fill("b", 20, 1600, 50), // 600 km / 50 L = 12
  ];

  it("a backdated insert splits the segment and changes every result", () => {
    const before = computeStats(original, vehicle);
    expect(before.segments).toHaveLength(1);
    expect(before.avgKmPerLiter).toBe(12);

    // Inserted afterwards, but dated in the middle of the existing segment.
    const after = computeStats([...original, fill("mid", 10, 1300, 25)], vehicle);

    expect(after.segments).toHaveLength(2);
    expect(after.segments[0].kmPerLiter).toBe(300 / 25);
    expect(after.segments[1].kmPerLiter).toBe(300 / 50);
    // Same distance, more liters => the average drops. Nothing was recomputed
    // and stored: the whole picture changed purely from the raw list.
    expect(after.avgKmPerLiter).toBeCloseTo(600 / 75, 3);
    expect(after.avgKmPerLiter).not.toBe(before.avgKmPerLiter);
    expect(after.records.totalLiters).toBe(115);
  });

  it("an edit to a historical odometer flows through to the average", () => {
    const edited = original.map((f) => (f.id === "b" ? { ...f, odometer: 1800 } : f));
    const stats = computeStats(edited, vehicle);
    expect(stats.segments[0].km).toBe(800);
    expect(stats.avgKmPerLiter).toBe(16);
  });

  it("an edit that flips a full tank to partial merges the two segments", () => {
    const list = [
      fill("a", 0, 1000, 40),
      fill("b", 10, 1300, 25),
      fill("c", 20, 1600, 25),
    ];
    expect(computeStats(list, vehicle).segments).toHaveLength(2);

    const merged = list.map((f) => (f.id === "b" ? { ...f, isFullTank: false } : f));
    const stats = computeStats(merged, vehicle);
    expect(stats.segments).toHaveLength(1);
    expect(stats.segments[0].km).toBe(600);
    expect(stats.segments[0].liters).toBe(50);
    expect(stats.segments[0].kmPerLiter).toBe(12);
  });

  it("a delete merges the neighbouring segments naturally", () => {
    const list = [
      fill("a", 0, 1000, 40),
      fill("b", 10, 1300, 25),
      fill("c", 20, 1600, 25),
    ];
    const withMiddle = computeStats(list, vehicle);
    expect(withMiddle.segments).toHaveLength(2);

    const afterDelete = computeStats(
      list.filter((f) => f.id !== "b"),
      vehicle,
    );
    expect(afterDelete.segments).toHaveLength(1);
    expect(afterDelete.segments[0].km).toBe(600);
    expect(afterDelete.segments[0].liters).toBe(25);
    expect(afterDelete.records.totalLiters).toBe(65);
  });

  it("deleting the only two records leaves an empty but valid result", () => {
    const stats = computeStats([], vehicle);
    expect(stats.months).toEqual([]);
    expect(stats.records.mostExpensive).toBeNull();
    expect(stats.records.mostEconomicalMonth).toBeNull();
  });
});

describe("computeStats — out-of-order timestamps", () => {
  it("orders by odometer even when the input array is shuffled", () => {
    const shuffled = [
      fill("c", 20, 2000, 50),
      fill("a", 0, 1000, 40),
      fill("b", 10, 1500, 40),
    ];
    const stats = computeStats(shuffled, vehicle);
    expect(stats.fillups.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(stats.segments.map((s) => s.endId)).toEqual(["b", "c"]);
  });

  it("flags a record whose date contradicts its odometer position", () => {
    // "b" has a higher odometer than "c" but an earlier date.
    const list = [
      fill("a", 0, 1000, 40),
      fill("b", 30, 1500, 40),
      fill("c", 20, 1900, 40),
    ];
    const stats = computeStats(list, vehicle);
    const anomaly = stats.anomalies.find((x) => x.kind === "odometerOrder");
    expect(anomaly).toBeDefined();
    expect(anomaly?.fillupId).toBe("c");
  });

  it("still produces segments despite the date/odometer mismatch", () => {
    const list = [
      fill("a", 0, 1000, 40),
      fill("b", 30, 1500, 40),
      fill("c", 20, 1900, 40),
    ];
    expect(computeStats(list, vehicle).segments).toHaveLength(2);
  });
});

describe("computeStats — money, months and records", () => {
  const list = [
    fill("jan1", 0, 1000, 40, { pricePerLiter: 7, totalCost: 280 }),
    fill("jan2", 12, 1500, 40, { pricePerLiter: 7.1, totalCost: 284 }),
    fill("feb1", 40, 2100, 50, { pricePerLiter: 7.31, totalCost: 365.5 }),
  ];

  it("buckets spend and liters by calendar month", () => {
    const stats = computeStats(list, vehicle, null, base);
    const jan = stats.months.find((m) => m.key === monthKey(base));
    expect(jan?.count).toBe(2);
    expect(jan?.cost).toBe(564);
    expect(jan?.liters).toBe(80);
  });

  it("exposes the current month and year totals", () => {
    const stats = computeStats(list, vehicle, null, base);
    expect(stats.currentMonth?.count).toBe(2);
    expect(stats.currentYearCost).toBeCloseTo(929.5, 2);
  });

  it("finds the most expensive fill-up and the most economical month", () => {
    const stats = computeStats(list, vehicle, null, base);
    expect(stats.records.mostExpensive?.id).toBe("feb1");
    expect(stats.records.cheapestPerLiter?.id).toBe("jan1");
    expect(stats.records.mostEconomicalMonth?.kmPerLiter).toBe(12.5);
  });

  it("totals all-time liters, cost and distance", () => {
    const stats = computeStats(list, vehicle, null, base);
    expect(stats.records.totalLiters).toBe(130);
    expect(stats.records.totalCost).toBeCloseTo(929.5, 2);
    expect(stats.records.totalKm).toBe(1100);
  });

  it("computes the average price paid and its gap from the official price", () => {
    const stats = computeStats(list, vehicle, { current: { pricePerLiter: 7.31 } }, base);
    expect(stats.avgPricePaid).toBeCloseTo(929.5 / 130, 3);
    expect(stats.avgPriceVsOfficial).toBeLessThan(0);
  });

  it("derives km/day and km/month from the elapsed span", () => {
    const stats = computeStats(list, vehicle, null, base);
    expect(stats.kmPerDay).toBeCloseTo(1100 / 40, 1);
    expect(stats.kmPerMonth).toBeGreaterThan(0);
  });
});

describe("computeStats — stations", () => {
  it("compares cost per liter across stations, cheapest first", () => {
    const list = [
      fill("a", 0, 1000, 40, { pricePerLiter: 7.4, station: { name: "פז" } }),
      fill("b", 10, 1500, 40, { pricePerLiter: 7.0, station: { name: "סונול" } }),
      fill("c", 20, 2000, 40, { pricePerLiter: 7.6, station: { name: "פז" } }),
      fill("d", 30, 2500, 40, { pricePerLiter: 7.2 }),
    ];
    const stats = computeStats(list, vehicle);
    expect(stats.stationStats.map((s) => s.name)).toEqual(["סונול", "פז"]);
    expect(stats.stationStats[0].count).toBe(1);
    expect(stats.stationStats[1].count).toBe(2);
    expect(stats.stationStats[1].avgPricePerLiter).toBeCloseTo(7.5, 2);
  });
});

describe("odometerBounds", () => {
  const list = [fill("a", 0, 41200, 40), fill("b", 30, 42850, 40)];

  it("brackets a date that falls between two records", () => {
    const bounds = odometerBounds(list, base + 15 * day);
    expect(bounds.min).toBe(41200);
    expect(bounds.max).toBe(42850);
  });

  it("leaves the upper bound open for the newest date", () => {
    const bounds = odometerBounds(list, base + 60 * day);
    expect(bounds.min).toBe(42850);
    expect(bounds.max).toBeNull();
  });

  it("leaves the lower bound open for a date before all records", () => {
    const bounds = odometerBounds(list, base - 10 * day);
    expect(bounds.min).toBeNull();
    expect(bounds.max).toBe(41200);
  });

  it("excludes the record being edited from its own bounds", () => {
    const bounds = odometerBounds(list, base + 30 * day, "b");
    expect(bounds.min).toBe(41200);
    expect(bounds.max).toBeNull();
  });
});

describe("hardBlock", () => {
  const list = [fill("a", 0, 41200, 40), fill("b", 30, 42850, 40)];

  it("blocks a backdated reading outside the neighbours' range", () => {
    const message = hardBlock({ date: base + 15 * day, odometer: 40000 }, list);
    expect(message).toContain("41,200");
    expect(message).toContain("42,850");
  });

  it("allows a reading inside the range", () => {
    expect(hardBlock({ date: base + 15 * day, odometer: 42110 }, list)).toBeNull();
  });

  it("blocks a new reading below the latest one", () => {
    expect(hardBlock({ date: base + 60 * day, odometer: 41000 }, list)).not.toBeNull();
  });

  it("allows any positive reading when there is no history", () => {
    expect(hardBlock({ date: base, odometer: 100 }, [])).toBeNull();
  });

  it("rejects a non-positive odometer", () => {
    expect(hardBlock({ date: base, odometer: 0 }, [])).not.toBeNull();
  });

  it("does not block an edit against the record's own value", () => {
    expect(hardBlock({ date: base + 30 * day, odometer: 42850 }, list, "b")).toBeNull();
  });
});

describe("softWarnings", () => {
  const history = [
    fill("a", 0, 1000, 40),
    fill("b", 10, 1400, 40),
    fill("c", 20, 1800, 40),
  ];

  it("warns, without blocking, when liters exceed the tank size", () => {
    const warnings = softWarnings(
      { date: base + 30 * day, odometer: 2200, liters: 60, pricePerLiter: 7 },
      history,
      vehicle,
    );
    expect(warnings.some((w) => w.field === "liters")).toBe(true);
    expect(hardBlock({ date: base + 30 * day, odometer: 2200 }, history)).toBeNull();
  });

  it("warns about an abnormal distance jump", () => {
    const warnings = softWarnings(
      { date: base + 30 * day, odometer: 4550, liters: 40, pricePerLiter: 7 },
      history,
      vehicle,
    );
    expect(warnings.some((w) => w.field === "odometer")).toBe(true);
  });

  it("warns about an implausible computed consumption", () => {
    const warnings = softWarnings(
      { date: base + 30 * day, odometer: 1830, liters: 40, pricePerLiter: 7 },
      history,
      vehicle,
    );
    expect(warnings.some((w) => w.field === "consumption")).toBe(true);
  });

  it("warns about an out-of-range price", () => {
    const warnings = softWarnings(
      { date: base + 30 * day, odometer: 2200, liters: 40, pricePerLiter: 71 },
      history,
      vehicle,
    );
    expect(warnings.some((w) => w.field === "price")).toBe(true);
  });

  it("stays silent on an ordinary fill-up", () => {
    const warnings = softWarnings(
      { date: base + 30 * day, odometer: 2200, liters: 33, pricePerLiter: 7.31 },
      history,
      vehicle,
    );
    expect(warnings).toEqual([]);
  });

  it("stays silent when there is no history to compare against", () => {
    const warnings = softWarnings(
      { date: base, odometer: 1000, liters: 40, pricePerLiter: 7.31 },
      [],
      vehicle,
    );
    expect(warnings).toEqual([]);
  });
});

describe("resolvePricePerLiter", () => {
  const prices = {
    current: { pricePerLiter: 7.31 },
    history: { "2026-01": 7.12, "2026-08": 7.31 },
  };

  it("uses the official price of the fill-up's own month", () => {
    const result = resolvePricePerLiter(new Date("2026-01-15").getTime(), null, prices);
    expect(result).toEqual({ price: 7.12, source: "official", fromHistory: true });
  });

  it("falls back to the current price for a month with no history", () => {
    const result = resolvePricePerLiter(new Date("2026-05-15").getTime(), null, prices);
    expect(result.price).toBe(7.31);
    // The caller uses this to avoid claiming a month it has no record for.
    expect(result.fromHistory).toBe(false);
  });

  it("applies the vehicle's fixed station discount", () => {
    const result = resolvePricePerLiter(new Date("2026-01-15").getTime(), {
      priceAdjustment: -0.05,
      manualPricePerLiter: null,
    }, prices);
    expect(result).toEqual({ price: 7.07, source: "adjusted", fromHistory: true });
  });

  it("lets a vehicle-level manual price override the official chain", () => {
    const result = resolvePricePerLiter(new Date("2026-01-15").getTime(), {
      priceAdjustment: -0.05,
      manualPricePerLiter: 6.8,
    }, prices);
    expect(result).toEqual({ price: 6.8, source: "manual", fromHistory: false });
  });

  it("never returns a negative price from a large discount", () => {
    const result = resolvePricePerLiter(new Date("2026-01-15").getTime(), {
      priceAdjustment: -99,
      manualPricePerLiter: null,
    }, prices);
    expect(result.price).toBe(0);
  });

  it("reports 'none' when no price is known at all", () => {
    expect(resolvePricePerLiter(base, null, null)).toEqual({
      price: null,
      source: "none",
      fromHistory: false,
    });
  });
});

describe("filterByRange", () => {
  const now = new Date("2026-08-31T12:00:00Z").getTime();
  const list = [
    { ...fill("old", 0, 1000, 40), date: new Date("2025-01-01").getTime() },
    { ...fill("mid", 0, 2000, 40), date: new Date("2026-04-01").getTime() },
    { ...fill("new", 0, 3000, 40), date: new Date("2026-08-01").getTime() },
  ];

  it("keeps everything for the 'all' range", () => {
    expect(filterByRange(list, "all", now)).toHaveLength(3);
  });

  it("keeps only the trailing 3 months", () => {
    expect(filterByRange(list, "3m", now).map((f) => f.id)).toEqual(["new"]);
  });

  it("keeps the trailing 6 months", () => {
    expect(filterByRange(list, "6m", now).map((f) => f.id)).toEqual(["mid", "new"]);
  });

  it("keeps the trailing year", () => {
    expect(filterByRange(list, "1y", now).map((f) => f.id)).toEqual(["mid", "new"]);
  });
});

describe("anomaly detection", () => {
  it("flags a fill-up larger than the tank", () => {
    const list = [fill("a", 0, 1000, 40), fill("b", 10, 1500, 70)];
    const stats = computeStats(list, vehicle);
    expect(stats.anomalies.some((a) => a.kind === "tankOverfill" && a.fillupId === "b")).toBe(
      true,
    );
  });

  it("flags a consumption outlier once there is enough history", () => {
    const list = [
      fill("a", 0, 1000, 40),
      fill("b", 10, 1480, 40),
      fill("c", 20, 1960, 40),
      fill("d", 30, 2440, 40),
      fill("e", 40, 2600, 40), // sharply worse than the rest
    ];
    const stats = computeStats(list, vehicle);
    expect(stats.anomalies.some((a) => a.kind === "consumptionOutlier")).toBe(true);
  });

  it("reports no anomalies for a clean history", () => {
    const list = [
      fill("a", 0, 1000, 40),
      fill("b", 10, 1480, 40),
      fill("c", 20, 1960, 40),
      fill("d", 30, 2440, 40),
    ];
    expect(computeStats(list, vehicle).anomalies).toEqual([]);
  });
});

describe("chart series", () => {
  const list = [
    fill("a", 0, 1000, 40),
    fill("b", 10, 1500, 40),
    fill("c", 20, 2000, 50),
  ];

  it("emits one consumption point per closed segment", () => {
    const stats = computeStats(list, vehicle);
    expect(stats.consumptionSeries).toHaveLength(2);
    expect(stats.consumptionSeries[0].kmPerLiter).toBe(12.5);
  });

  it("emits paid and official price points in chronological order", () => {
    const stats = computeStats(list, vehicle, { current: { pricePerLiter: 7.31 } });
    expect(stats.priceSeries).toHaveLength(3);
    expect(stats.priceSeries[0].date).toBeLessThan(stats.priceSeries[2].date);
    expect(stats.priceSeries[0].official).toBe(7.31);
  });

  it("emits a cumulative odometer series", () => {
    const stats = computeStats(list, vehicle);
    expect(stats.odometerSeries.map((p) => p.odometer)).toEqual([1000, 1500, 2000]);
  });
});
