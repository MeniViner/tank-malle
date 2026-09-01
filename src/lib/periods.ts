/**
 * Date ranges and aggregation buckets for the Statistics screen.
 *
 * The old control conflated two different ideas behind one row of chips:
 * WHICH RECORDS are in scope (the range) and HOW THEY ARE GROUPED (the
 * granularity). "3 months" answered both questions at once, and no label said
 * which numbers it had changed.
 *
 * They are separated here, and each metric gets the range treatment it needs:
 * raw spend can be filtered by fill-up date, while consumption must be built
 * from segments on the COMPLETE history and only then filtered by the
 * segment's closing date — otherwise a segment vanishes whenever its opening
 * full tank happens to fall outside the window.
 */

import type { Fillup } from "./stats";
import { heMonthName, heMonthShort } from "./format";

export type RangeKey =
  | "thisMonth"
  | "3m"
  | "6m"
  | "ytd"
  | "1y"
  | "all"
  | "custom";

export type Grouping = "day" | "week" | "month" | "year" | "auto";

export interface DateRange {
  key: RangeKey;
  /** Inclusive lower bound, or null for "from the beginning". */
  from: number | null;
  /** Inclusive upper bound, or null for "up to now". */
  to: number | null;
  /** Shown in section subtitles and chart titles, e.g. "6 החודשים האחרונים". */
  label: string;
}

export const RANGE_LABELS: Record<Exclude<RangeKey, "custom">, string> = {
  thisMonth: "החודש",
  "3m": "3 חודשים",
  "6m": "6 חודשים",
  ytd: "מתחילת השנה",
  "1y": "שנה",
  all: "הכול",
};

/** Longer wording, for a subtitle that has to stand on its own. */
const RANGE_SUBTITLES: Record<Exclude<RangeKey, "custom">, string> = {
  thisMonth: "החודש הנוכחי",
  "3m": "3 החודשים האחרונים",
  "6m": "6 החודשים האחרונים",
  ytd: "מתחילת השנה",
  "1y": "12 החודשים האחרונים",
  all: "כל התקופה",
};

export const GROUPING_LABELS: Record<Grouping, string> = {
  day: "יומי",
  week: "שבועי",
  month: "חודשי",
  year: "שנתי",
  auto: "אוטומטי",
};

export function buildRange(
  key: RangeKey,
  now: number = Date.now(),
  custom?: { from: number; to: number },
): DateRange {
  if (key === "custom" && custom) {
    return {
      key,
      from: startOfDay(custom.from),
      to: endOfDay(custom.to),
      label: `${shortDate(custom.from)} – ${shortDate(custom.to)}`,
    };
  }

  const to = now;
  const current = new Date(now);
  let from: number | null = null;

  switch (key) {
    case "thisMonth":
      from = new Date(current.getFullYear(), current.getMonth(), 1).getTime();
      break;
    case "3m":
      from = monthsBack(current, 3);
      break;
    case "6m":
      from = monthsBack(current, 6);
      break;
    case "ytd":
      from = new Date(current.getFullYear(), 0, 1).getTime();
      break;
    case "1y":
      from = monthsBack(current, 12);
      break;
    case "all":
    default:
      from = null;
  }

  const resolved = key === "custom" ? "all" : key;
  return { key, from, to, label: RANGE_SUBTITLES[resolved] };
}

function monthsBack(from: Date, months: number): number {
  const date = new Date(from);
  date.setMonth(date.getMonth() - months);
  return date.getTime();
}

function startOfDay(value: number): number {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function endOfDay(value: number): number {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

function shortDate(value: number): string {
  const d = new Date(value);
  return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`;
}

/** True when a timestamp falls inside the range. */
export function inRange(date: number, range: DateRange): boolean {
  if (range.from !== null && date < range.from) return false;
  if (range.to !== null && date > range.to) return false;
  return true;
}

/**
 * Choose a granularity that produces a readable number of bars.
 *
 * A month of data grouped by year is one bar; five years grouped by day is
 * eighteen hundred. "auto" lands between roughly 4 and 30 buckets.
 */
export function resolveGrouping(
  grouping: Grouping,
  range: DateRange,
  fillups: Fillup[],
): Exclude<Grouping, "auto"> {
  if (grouping !== "auto") return grouping;

  const from =
    range.from ?? (fillups.length > 0 ? Math.min(...fillups.map((f) => f.date)) : Date.now());
  const to = range.to ?? Date.now();
  const days = Math.max(1, (to - from) / 86_400_000);

  if (days <= 45) return "week";
  if (days <= 400) return "month";
  return "year";
}

export interface Bucket {
  /** Sortable key, e.g. "2026-08" or "2026-W32". */
  key: string;
  /** Hebrew label for the axis. */
  label: string;
  /** Start of the bucket, for ordering and tooltips. */
  start: number;
  cost: number;
  liters: number;
  count: number;
}

function isoWeek(date: Date): { year: number; week: number; start: Date } {
  // Sunday-first, matching the Israeli week — not the ISO Monday week.
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - start.getDay());
  const firstOfYear = new Date(start.getFullYear(), 0, 1);
  const week =
    Math.floor((start.getTime() - firstOfYear.getTime()) / (7 * 86_400_000)) + 1;
  return { year: start.getFullYear(), week, start };
}

function bucketFor(
  date: number,
  grouping: Exclude<Grouping, "auto">,
): { key: string; label: string; start: number } {
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");

  switch (grouping) {
    case "day":
      return {
        key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        label: `${d.getDate()} ${heMonthShort(d.getMonth() + 1)}`,
        start: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
      };
    case "week": {
      const { year, week, start } = isoWeek(d);
      return {
        key: `${year}-W${pad(week)}`,
        label: `${start.getDate()} ${heMonthShort(start.getMonth() + 1)}`,
        start: start.getTime(),
      };
    }
    case "year":
      return {
        key: String(d.getFullYear()),
        label: String(d.getFullYear()),
        start: new Date(d.getFullYear(), 0, 1).getTime(),
      };
    case "month":
    default:
      return {
        key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
        label: heMonthShort(d.getMonth() + 1),
        start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
      };
  }
}

/**
 * Bucket raw spend and litres.
 *
 * Raw figures may safely be filtered by the fill-up's own date, including
 * partial fill-ups and records that carry a continuity break — nothing here is
 * a rate, so nothing crosses a boundary it should not.
 */
export function bucketSpend(
  fillups: Fillup[],
  range: DateRange,
  grouping: Exclude<Grouping, "auto">,
): Bucket[] {
  const map = new Map<string, Bucket>();

  for (const fillup of fillups) {
    if (!inRange(fillup.date, range)) continue;
    const { key, label, start } = bucketFor(fillup.date, grouping);

    let bucket = map.get(key);
    if (!bucket) {
      bucket = { key, label, start, cost: 0, liters: 0, count: 0 };
      map.set(key, bucket);
    }
    bucket.cost += fillup.totalCost;
    bucket.liters += fillup.liters;
    bucket.count += 1;
  }

  return [...map.values()]
    .sort((a, b) => a.start - b.start)
    .map((bucket) => ({
      ...bucket,
      cost: Math.round(bucket.cost * 100) / 100,
      liters: Math.round(bucket.liters * 1000) / 1000,
    }));
}

export interface SpendSummary {
  total: number;
  liters: number;
  fillups: number;
  /** Averages over the range's actual elapsed span, not over bucket count. */
  perWeek: number | null;
  perMonth: number | null;
  /** Spending since 1 January, regardless of the selected range. */
  yearToDate: number;
}

/**
 * Totals and averages for the selected range.
 *
 * The averages divide by the elapsed span, not by the number of buckets: three
 * fill-ups in one week is not "three weeks of spending", and a range that ends
 * mid-month must not be reported as a whole month.
 */
export function summariseSpend(
  fillups: Fillup[],
  range: DateRange,
  now: number = Date.now(),
): SpendSummary {
  const scoped = fillups.filter((fillup) => inRange(fillup.date, range));

  const total = scoped.reduce((sum, f) => sum + f.totalCost, 0);
  const liters = scoped.reduce((sum, f) => sum + f.liters, 0);

  const from =
    range.from ?? (scoped.length > 0 ? Math.min(...scoped.map((f) => f.date)) : now);
  const to = Math.min(range.to ?? now, now);
  const days = Math.max(1, (to - from) / 86_400_000);

  const yearStart = new Date(new Date(now).getFullYear(), 0, 1).getTime();
  const yearToDate = fillups
    .filter((f) => f.date >= yearStart && f.date <= now)
    .reduce((sum, f) => sum + f.totalCost, 0);

  const round2 = (value: number) => Math.round(value * 100) / 100;

  return {
    total: round2(total),
    liters: Math.round(liters * 1000) / 1000,
    fillups: scoped.length,
    perWeek: scoped.length > 0 ? round2(total / (days / 7)) : null,
    perMonth: scoped.length > 0 ? round2(total / (days / 30.44)) : null,
    yearToDate: round2(yearToDate),
  };
}

/** The equivalent range immediately before this one, for a comparison. */
export function previousRange(range: DateRange, now: number = Date.now()): DateRange | null {
  if (range.from === null) return null;
  const to = range.to ?? now;
  const span = to - range.from;
  return {
    key: range.key,
    from: range.from - span,
    to: range.from - 1,
    label: "התקופה הקודמת",
  };
}

/** "סה״כ הוצאה · 6 החודשים האחרונים" — the range is never left implicit. */
export function withRange(title: string, range: DateRange): string {
  return `${title} · ${range.label}`;
}

/** Full month name for a bucket key like "2026-08". */
export function bucketMonthName(key: string): string {
  const [, month] = key.split("-");
  return heMonthName(Number(month));
}
