import { describe, expect, it } from "vitest";
import {
  bucketSpend,
  buildRange,
  inRange,
  previousRange,
  resolveGrouping,
  summariseSpend,
  withRange,
} from "./periods";
import { buildSegments, filterSegmentsByRange, type Fillup } from "./stats";

const DAY = 86_400_000;
const NOW = new Date(2026, 7, 20, 12, 0).getTime(); // 20 Aug 2026

function fill(id: string, date: number, odometer: number, cost: number): Fillup {
  return {
    id,
    date,
    odometer,
    liters: cost / 7,
    pricePerLiter: 7,
    totalCost: cost,
    isFullTank: true,
  };
}

describe("ranges", () => {
  it("names the range so a metric is never silently filtered", () => {
    expect(buildRange("6m", NOW).label).toBe("6 החודשים האחרונים");
    expect(withRange("סה״כ הוצאה", buildRange("6m", NOW))).toBe(
      "סה״כ הוצאה · 6 החודשים האחרונים",
    );
  });

  it("starts 'this month' at the first of the month", () => {
    const range = buildRange("thisMonth", NOW);
    expect(new Date(range.from as number).getDate()).toBe(1);
    expect(new Date(range.from as number).getMonth()).toBe(7);
  });

  it("starts 'year to date' on 1 January", () => {
    const range = buildRange("ytd", NOW);
    expect(new Date(range.from as number).getMonth()).toBe(0);
    expect(new Date(range.from as number).getDate()).toBe(1);
  });

  it("leaves 'all' unbounded", () => {
    expect(buildRange("all", NOW).from).toBeNull();
  });

  it("accepts a custom range", () => {
    const range = buildRange("custom", NOW, {
      from: new Date(2026, 2, 1).getTime(),
      to: new Date(2026, 3, 30).getTime(),
    });
    expect(inRange(new Date(2026, 2, 15).getTime(), range)).toBe(true);
    expect(inRange(new Date(2026, 4, 1).getTime(), range)).toBe(false);
    // The upper bound includes the whole final day.
    expect(inRange(new Date(2026, 3, 30, 23, 30).getTime(), range)).toBe(true);
  });

  it("offers the equivalent preceding window for a comparison", () => {
    const range = buildRange("3m", NOW);
    const previous = previousRange(range, NOW) as NonNullable<
      ReturnType<typeof previousRange>
    >;
    expect(previous.to).toBeLessThan(range.from as number);
    expect((range.to as number) - (range.from as number)).toBeCloseTo(
      (previous.to as number) - (previous.from as number),
      -2,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Grouping is a SEPARATE control from the range
 * ------------------------------------------------------------------ */

describe("grouping", () => {
  const list = [
    fill("a", NOW - 20 * DAY, 1000, 200),
    fill("b", NOW - 13 * DAY, 1300, 250),
    fill("c", NOW - 6 * DAY, 1600, 300),
    fill("d", NOW - 1 * DAY, 1900, 150),
  ];

  it("groups the same range by week, month or year on demand", () => {
    // The list spans 31 Jul - 19 Aug 2026: four weeks, two months, one year.
    const range = buildRange("1y", NOW);
    const weeks = bucketSpend(list, range, "week").length;
    const months = bucketSpend(list, range, "month").length;
    const years = bucketSpend(list, range, "year").length;

    expect(weeks).toBeGreaterThan(months);
    expect(months).toBe(2);
    expect(years).toBe(1);
  });

  it("totals each bucket independently of how the range is sliced", () => {
    const range = buildRange("1y", NOW);
    const byYear = bucketSpend(list, range, "year");
    const byWeek = bucketSpend(list, range, "week");
    const sum = (buckets: { cost: number }[]) =>
      Math.round(buckets.reduce((total, b) => total + b.cost, 0) * 100) / 100;
    expect(sum(byYear)).toBe(900);
    expect(sum(byWeek)).toBe(900);
  });

  it("returns buckets in chronological order", () => {
    const buckets = bucketSpend(list, buildRange("1y", NOW), "week");
    const starts = buckets.map((b) => b.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("excludes records outside the range", () => {
    const withOld = [...list, fill("old", new Date(2024, 0, 1).getTime(), 100, 999)];
    const buckets = bucketSpend(withOld, buildRange("3m", NOW), "month");
    expect(buckets.some((b) => b.cost === 999)).toBe(false);
  });

  it("auto picks a granularity that yields a readable number of bars", () => {
    expect(resolveGrouping("auto", buildRange("thisMonth", NOW), list)).toBe("week");
    expect(resolveGrouping("auto", buildRange("6m", NOW), list)).toBe("month");
    expect(resolveGrouping("auto", buildRange("all", NOW), [
      fill("x", new Date(2019, 0, 1).getTime(), 10, 10),
      ...list,
    ])).toBe("year");
  });

  it("does not override an explicit grouping", () => {
    expect(resolveGrouping("day", buildRange("all", NOW), list)).toBe("day");
  });
});

/* ------------------------------------------------------------------ *
 * The spending views the user asked for
 * ------------------------------------------------------------------ */

describe("spend summary", () => {
  const list = [
    fill("a", NOW - 20 * DAY, 1000, 200),
    fill("b", NOW - 13 * DAY, 1300, 250),
    fill("c", NOW - 6 * DAY, 1600, 300),
  ];

  it("totals the selected period", () => {
    expect(summariseSpend(list, buildRange("3m", NOW), NOW).total).toBe(750);
  });

  it("averages over elapsed time, not over the number of buckets", () => {
    const summary = summariseSpend(list, buildRange("3m", NOW), NOW);
    // Roughly three months of elapsed time, so the weekly figure is far below
    // the per-fill-up average — which is the honest reading.
    expect(summary.perWeek).not.toBeNull();
    expect(summary.perWeek as number).toBeLessThan(250);
    expect(summary.perMonth as number).toBeGreaterThan(summary.perWeek as number);
  });

  it("reports year-to-date regardless of the selected range", () => {
    const summary = summariseSpend(list, buildRange("thisMonth", NOW), NOW);
    // The range is one month; YTD still counts everything since 1 January.
    expect(summary.yearToDate).toBe(750);
    expect(summary.total).toBeLessThan(summary.yearToDate);
  });

  it("reports nulls rather than zero when the period is empty", () => {
    const summary = summariseSpend([], buildRange("3m", NOW), NOW);
    expect(summary.total).toBe(0);
    expect(summary.perWeek).toBeNull();
    expect(summary.perMonth).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Consumption gets different range treatment from raw spend
 * ------------------------------------------------------------------ */

describe("range semantics per metric", () => {
  const list = [
    fill("a", NOW - 100 * DAY, 1000, 200),
    fill("b", NOW - 50 * DAY, 1400, 250),
    fill("c", NOW - 10 * DAY, 1800, 300),
  ];

  it("keeps a segment whose opening full tank is outside the window", () => {
    const range = buildRange("thisMonth", NOW);
    const segments = filterSegmentsByRange(buildSegments(list), range.from, range.to);

    // 'b' opened before the window; the segment it opens closes inside it and
    // must survive. Filtering the FILL-UPS first would have destroyed it.
    expect(segments).toHaveLength(1);
    expect(segments[0].startId).toBe("b");
    expect(segments[0].km).toBe(400);
  });

  it("does not report a segment whose raw fill-ups are in range but which closed outside", () => {
    const range = {
      key: "custom" as const,
      from: NOW - 120 * DAY,
      to: NOW - 60 * DAY,
      label: "",
    };
    const segments = filterSegmentsByRange(buildSegments(list), range.from, range.to);
    expect(segments).toHaveLength(0);
  });
});
