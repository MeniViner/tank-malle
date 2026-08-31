/**
 * Pure derived-metrics engine.
 *
 * Nothing in Firestore is ever derived: only raw fill-up records are stored.
 * Every number the UI shows is computed here, at runtime, from the raw list.
 * That is what makes a backdated insert, an edit or a delete "recalculate
 * everything" for free.
 *
 * This module must stay free of React and Firebase imports so it can be unit
 * tested in isolation and reused anywhere (including Cloud Functions).
 */

export type FuelType = "95" | "98" | "diesel" | "other";

export interface Fillup {
  id: string;
  /** Epoch milliseconds. May be any past date. */
  date: number;
  /** Odometer reading in km at the moment of filling. */
  odometer: number;
  liters: number;
  pricePerLiter: number;
  totalCost: number;
  /** A partial fill-up does not close a consumption segment. */
  isFullTank: boolean;
  station?: { name: string; lat?: number; lng?: number } | null;
  notes?: string | null;
  createdAt?: number;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year?: number | null;
  plateNumber?: string | null;
  fuelType: FuelType;
  tankLiters?: number | null;
  declaredKmPerLiter?: number | null;
  /** ₪/liter delta applied on top of the official price. */
  priceAdjustment: number;
  /** Overrides the official price + adjustment entirely. */
  manualPricePerLiter?: number | null;
  nickname?: string | null;
  archived: boolean;
  createdAt?: number;
}

export interface FuelPrices {
  current?: { pricePerLiter: number; effectiveFrom?: number; updatedAt?: number } | null;
  /** Month-keyed history, e.g. { "2026-08": 7.31 }. */
  history?: Record<string, number>;
}

/** A stretch between two full tanks; consumption is only meaningful here. */
export interface Segment {
  /** Fill-up that established the starting odometer (a full tank). */
  startId: string;
  /** Full tank that closes the segment. */
  endId: string;
  startDate: number;
  endDate: number;
  startOdometer: number;
  endOdometer: number;
  km: number;
  /** Liters burned over the segment: the closing fill plus any partials. */
  liters: number;
  cost: number;
  kmPerLiter: number;
  litersPer100: number;
  costPerKm: number;
  /** Fill-ups counted into the segment (partials + the closing full tank). */
  fillupCount: number;
}

export interface MonthBucket {
  /** "2026-08" */
  key: string;
  year: number;
  /** 1-12 */
  month: number;
  cost: number;
  liters: number;
  count: number;
  /** Consumption of the segments that closed in this month, if any. */
  kmPerLiter: number | null;
}

export type AnomalyKind =
  | "odometerOrder"
  | "consumptionOutlier"
  | "tankOverfill"
  | "kmJump";

export interface Anomaly {
  fillupId: string;
  kind: AnomalyKind;
  message: string;
}

export interface StationStat {
  name: string;
  count: number;
  liters: number;
  cost: number;
  avgPricePerLiter: number;
}

export interface Records {
  mostExpensive: Fillup | null;
  cheapestPerLiter: Fillup | null;
  mostEconomicalMonth: MonthBucket | null;
  totalLiters: number;
  totalCost: number;
  totalKm: number;
  fillupCount: number;
}

export interface Stats {
  /** Input, sorted canonically (by odometer, then date). */
  fillups: Fillup[];
  segments: Segment[];
  /** Distance-weighted average across all closed segments. */
  avgKmPerLiter: number | null;
  avgLitersPer100: number | null;
  avgCostPerKm: number | null;
  /** The most recent closed segment. */
  lastSegment: Segment | null;
  /** Signed % difference of the last segment vs. the overall average. */
  lastVsAvgPercent: number | null;
  /** Signed % difference of the average vs. the manufacturer figure. */
  vsDeclaredPercent: number | null;
  months: MonthBucket[];
  currentMonth: MonthBucket | null;
  currentYearCost: number;
  kmPerDay: number | null;
  kmPerMonth: number | null;
  /** tankLiters × avgKmPerLiter. */
  estimatedRangeKm: number | null;
  avgPricePaid: number | null;
  /** Signed ₪ difference between the average paid price and the official one. */
  avgPriceVsOfficial: number | null;
  totalKm: number;
  records: Records;
  anomalies: Anomaly[];
  stationStats: StationStat[];
  /** Series ready for the charts, oldest → newest. */
  consumptionSeries: { date: number; kmPerLiter: number; label: string }[];
  priceSeries: { date: number; paid: number; official: number | null; label: string }[];
  odometerSeries: { date: number; odometer: number; label: string }[];
}

const DAY_MS = 86_400_000;

/** Canonical ordering: odometer ascending, date as the tie-breaker. */
export function sortFillups(fillups: Fillup[]): Fillup[] {
  return [...fillups].sort((a, b) => a.odometer - b.odometer || a.date - b.date);
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f + Number.EPSILON) / f;
}

export function monthKey(date: number): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Build consumption segments.
 *
 * A segment opens at a full tank and closes at the *next* full tank. Partial
 * fill-ups in between do not close it — their liters are added to the open
 * segment, because the tank level at a partial fill is unknown.
 *
 *   kmPerLiter = (odoEnd − odoStart) / Σ liters(fills after the start,
 *                                               through the closing full tank)
 */
export function buildSegments(sorted: Fillup[]): Segment[] {
  const segments: Segment[] = [];
  let start: Fillup | null = null;
  let liters = 0;
  let cost = 0;
  let count = 0;

  for (const fill of sorted) {
    if (start === null) {
      // A segment can only start from a known-full tank.
      if (fill.isFullTank) start = fill;
      continue;
    }

    liters += fill.liters;
    cost += fill.totalCost;
    count += 1;

    if (!fill.isFullTank) continue;

    const km = fill.odometer - start.odometer;
    if (km > 0 && liters > 0) {
      const kmPerLiter = km / liters;
      segments.push({
        startId: start.id,
        endId: fill.id,
        startDate: start.date,
        endDate: fill.date,
        startOdometer: start.odometer,
        endOdometer: fill.odometer,
        km,
        liters: round(liters, 3),
        cost: round(cost, 2),
        kmPerLiter: round(kmPerLiter, 3),
        litersPer100: round(100 / kmPerLiter, 3),
        costPerKm: round(cost / km, 4),
        fillupCount: count,
      });
    }

    start = fill;
    liters = 0;
    cost = 0;
    count = 0;
  }

  return segments;
}

function buildMonths(sorted: Fillup[], segments: Segment[]): MonthBucket[] {
  const map = new Map<string, MonthBucket>();

  for (const fill of sorted) {
    const key = monthKey(fill.date);
    let bucket = map.get(key);
    if (!bucket) {
      const d = new Date(fill.date);
      bucket = {
        key,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        cost: 0,
        liters: 0,
        count: 0,
        kmPerLiter: null,
      };
      map.set(key, bucket);
    }
    bucket.cost += fill.totalCost;
    bucket.liters += fill.liters;
    bucket.count += 1;
  }

  // Attribute each segment's consumption to the month it closed in, then
  // distance-weight the segments that share a month.
  const perMonth = new Map<string, { km: number; liters: number }>();
  for (const segment of segments) {
    const key = monthKey(segment.endDate);
    const entry = perMonth.get(key) ?? { km: 0, liters: 0 };
    entry.km += segment.km;
    entry.liters += segment.liters;
    perMonth.set(key, entry);
  }
  for (const [key, entry] of perMonth) {
    const bucket = map.get(key);
    if (bucket && entry.liters > 0) bucket.kmPerLiter = round(entry.km / entry.liters, 3);
  }

  for (const bucket of map.values()) {
    bucket.cost = round(bucket.cost, 2);
    bucket.liters = round(bucket.liters, 3);
  }

  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function buildStationStats(sorted: Fillup[]): StationStat[] {
  const map = new Map<string, StationStat>();
  for (const fill of sorted) {
    const name = fill.station?.name?.trim();
    if (!name) continue;
    let entry = map.get(name);
    if (!entry) {
      entry = { name, count: 0, liters: 0, cost: 0, avgPricePerLiter: 0 };
      map.set(name, entry);
    }
    entry.count += 1;
    entry.liters += fill.liters;
    entry.cost += fill.totalCost;
  }
  const list = [...map.values()];
  for (const entry of list) {
    entry.liters = round(entry.liters, 2);
    entry.cost = round(entry.cost, 2);
    entry.avgPricePerLiter = entry.liters > 0 ? round(entry.cost / entry.liters, 3) : 0;
  }
  return list.sort((a, b) => a.avgPricePerLiter - b.avgPricePerLiter);
}

function buildAnomalies(
  sorted: Fillup[],
  segments: Segment[],
  vehicle?: Vehicle | null,
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // Canonical order is by odometer; a date that disagrees means the two
  // readings contradict each other and the record needs a human look.
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].date < sorted[i - 1].date) {
      anomalies.push({
        fillupId: sorted[i].id,
        kind: "odometerOrder",
        message: "התאריך והקילומטראז׳ אינם תואמים לרשומות הסמוכות",
      });
    }
  }

  if (vehicle?.tankLiters) {
    for (const fill of sorted) {
      if (fill.liters > vehicle.tankLiters * 1.05) {
        anomalies.push({
          fillupId: fill.id,
          kind: "tankOverfill",
          message: `כמות הליטרים גדולה מנפח המיכל (${vehicle.tankLiters} ל׳)`,
        });
      }
    }
  }

  if (segments.length >= 3) {
    const meanKmPerLiter =
      segments.reduce((sum, s) => sum + s.kmPerLiter, 0) / segments.length;
    const meanKm = segments.reduce((sum, s) => sum + s.km, 0) / segments.length;

    for (const segment of segments) {
      if (Math.abs(segment.kmPerLiter - meanKmPerLiter) / meanKmPerLiter > 0.4) {
        anomalies.push({
          fillupId: segment.endId,
          kind: "consumptionOutlier",
          message: `צריכה חריגה: ${round(segment.kmPerLiter, 1)} קמ״ל מול ממוצע ${round(meanKmPerLiter, 1)}`,
        });
      }
      if (segment.km > meanKm * 3) {
        anomalies.push({
          fillupId: segment.endId,
          kind: "kmJump",
          message: `קפיצת קילומטראז׳ חריגה: ${Math.round(segment.km)} ק״מ`,
        });
      }
    }
  }

  return anomalies;
}

function buildRecords(sorted: Fillup[], months: MonthBucket[]): Records {
  let mostExpensive: Fillup | null = null;
  let cheapestPerLiter: Fillup | null = null;
  let totalLiters = 0;
  let totalCost = 0;

  for (const fill of sorted) {
    totalLiters += fill.liters;
    totalCost += fill.totalCost;
    if (!mostExpensive || fill.totalCost > mostExpensive.totalCost) mostExpensive = fill;
    if (!cheapestPerLiter || fill.pricePerLiter < cheapestPerLiter.pricePerLiter) {
      cheapestPerLiter = fill;
    }
  }

  let mostEconomicalMonth: MonthBucket | null = null;
  for (const bucket of months) {
    if (bucket.kmPerLiter === null) continue;
    if (!mostEconomicalMonth || bucket.kmPerLiter > (mostEconomicalMonth.kmPerLiter ?? 0)) {
      mostEconomicalMonth = bucket;
    }
  }

  const totalKm =
    sorted.length >= 2 ? sorted[sorted.length - 1].odometer - sorted[0].odometer : 0;

  return {
    mostExpensive,
    cheapestPerLiter,
    mostEconomicalMonth,
    totalLiters: round(totalLiters, 2),
    totalCost: round(totalCost, 2),
    totalKm,
    fillupCount: sorted.length,
  };
}

const HE_MONTHS_SHORT = [
  "ינו׳",
  "פבר׳",
  "מרץ",
  "אפר׳",
  "מאי",
  "יונ׳",
  "יול׳",
  "אוג׳",
  "ספט׳",
  "אוק׳",
  "נוב׳",
  "דצמ׳",
];

function shortLabel(date: number): string {
  const d = new Date(date);
  return `${d.getDate()} ${HE_MONTHS_SHORT[d.getMonth()]}`;
}

/**
 * Compute every derived metric for one vehicle's raw fill-up list.
 * Safe on empty and single-record inputs.
 */
export function computeStats(
  fillups: Fillup[],
  vehicle?: Vehicle | null,
  prices?: FuelPrices | null,
  now: number = Date.now(),
): Stats {
  const sorted = sortFillups(fillups);
  const segments = buildSegments(sorted);
  const months = buildMonths(sorted, segments);
  const records = buildRecords(sorted, months);

  // Distance-weighted: a 900 km segment should count for more than a 200 km
  // one, which a plain mean of per-segment kmPerLiter would get wrong.
  const totalSegmentKm = segments.reduce((sum, s) => sum + s.km, 0);
  const totalSegmentLiters = segments.reduce((sum, s) => sum + s.liters, 0);
  const totalSegmentCost = segments.reduce((sum, s) => sum + s.cost, 0);

  const avgKmPerLiter =
    totalSegmentLiters > 0 ? round(totalSegmentKm / totalSegmentLiters, 3) : null;
  const avgLitersPer100 = avgKmPerLiter ? round(100 / avgKmPerLiter, 3) : null;
  const avgCostPerKm =
    totalSegmentKm > 0 ? round(totalSegmentCost / totalSegmentKm, 4) : null;

  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : null;
  const lastVsAvgPercent =
    lastSegment && avgKmPerLiter
      ? round(((lastSegment.kmPerLiter - avgKmPerLiter) / avgKmPerLiter) * 100, 1)
      : null;

  const declared = vehicle?.declaredKmPerLiter ?? null;
  const vsDeclaredPercent =
    declared && avgKmPerLiter
      ? round(((avgKmPerLiter - declared) / declared) * 100, 1)
      : null;

  const nowKey = monthKey(now);
  const currentMonth = months.find((m) => m.key === nowKey) ?? null;
  const currentYear = new Date(now).getFullYear();
  const currentYearCost = round(
    months.filter((m) => m.year === currentYear).reduce((sum, m) => sum + m.cost, 0),
    2,
  );

  const spanDays =
    sorted.length >= 2 ? (sorted[sorted.length - 1].date - sorted[0].date) / DAY_MS : 0;
  const kmPerDay = spanDays > 0 ? round(records.totalKm / spanDays, 1) : null;
  const kmPerMonth = kmPerDay !== null ? round(kmPerDay * 30.44, 0) : null;

  const estimatedRangeKm =
    vehicle?.tankLiters && avgKmPerLiter
      ? Math.round(vehicle.tankLiters * avgKmPerLiter)
      : null;

  const avgPricePaid =
    records.totalLiters > 0 ? round(records.totalCost / records.totalLiters, 3) : null;

  const officialFor = (date: number): number | null =>
    prices?.history?.[monthKey(date)] ?? prices?.current?.pricePerLiter ?? null;

  const currentOfficial = prices?.current?.pricePerLiter ?? null;
  const avgPriceVsOfficial =
    avgPricePaid !== null && currentOfficial !== null
      ? round(avgPricePaid - currentOfficial, 3)
      : null;

  return {
    fillups: sorted,
    segments,
    avgKmPerLiter,
    avgLitersPer100,
    avgCostPerKm,
    lastSegment,
    lastVsAvgPercent,
    vsDeclaredPercent,
    months,
    currentMonth,
    currentYearCost,
    kmPerDay,
    kmPerMonth,
    estimatedRangeKm,
    avgPricePaid,
    avgPriceVsOfficial,
    totalKm: records.totalKm,
    records,
    anomalies: buildAnomalies(sorted, segments, vehicle),
    stationStats: buildStationStats(sorted),
    consumptionSeries: segments.map((s) => ({
      date: s.endDate,
      kmPerLiter: s.kmPerLiter,
      label: shortLabel(s.endDate),
    })),
    priceSeries: [...sorted]
      .sort((a, b) => a.date - b.date)
      .map((f) => ({
        date: f.date,
        paid: f.pricePerLiter,
        official: officialFor(f.date),
        label: shortLabel(f.date),
      })),
    odometerSeries: [...sorted]
      .sort((a, b) => a.date - b.date)
      .map((f) => ({
        date: f.date,
        odometer: f.odometer,
        label: shortLabel(f.date),
      })),
  };
}

/**
 * Odometer bounds implied by the chronological neighbours of `date`.
 * A reading outside this range is a logical contradiction, so it is the one
 * case the form hard-blocks on.
 */
export function odometerBounds(
  fillups: Fillup[],
  date: number,
  excludeId?: string,
): { min: number | null; max: number | null; prev: Fillup | null; next: Fillup | null } {
  const byDate = fillups
    .filter((f) => f.id !== excludeId)
    .sort((a, b) => a.date - b.date);

  let prev: Fillup | null = null;
  let next: Fillup | null = null;
  for (const fill of byDate) {
    if (fill.date <= date) prev = fill;
    else {
      next = fill;
      break;
    }
  }

  return { min: prev ? prev.odometer : null, max: next ? next.odometer : null, prev, next };
}

export interface SoftWarning {
  field: "liters" | "odometer" | "consumption" | "price";
  message: string;
  detail?: string;
}

/**
 * Non-blocking sanity checks. These never prevent a save — they only surface
 * an amber note, because the user is always the authority on their own data.
 */
export function softWarnings(
  draft: { date: number; odometer: number; liters: number; pricePerLiter: number },
  fillups: Fillup[],
  vehicle?: Vehicle | null,
  excludeId?: string,
): SoftWarning[] {
  const warnings: SoftWarning[] = [];
  const others = fillups.filter((f) => f.id !== excludeId);
  const { prev } = odometerBounds(others, draft.date);

  if (vehicle?.tankLiters && draft.liters > vehicle.tankLiters) {
    warnings.push({
      field: "liters",
      message: "כמות גדולה מנפח המיכל — בדקו את הערך",
      detail: `נפח המיכל שהוגדר הוא ${vehicle.tankLiters} ליטר. אפשר לשמור בכל זאת.`,
    });
  }

  if (prev) {
    const deltaKm = draft.odometer - prev.odometer;
    const history = buildSegments(sortFillups(others));
    const typicalKm =
      history.length > 0
        ? history.reduce((sum, s) => sum + s.km, 0) / history.length
        : null;

    if (typicalKm && deltaKm > typicalKm * 2.5) {
      warnings.push({
        field: "odometer",
        message: "קפיצת קילומטראז׳ חריגה — בדקו את הערך",
        detail: `מאז התדלוק האחרון נוספו ${Math.round(deltaKm).toLocaleString("he-IL")} ק״מ, הרבה מעל הרגיל. אפשר לשמור בכל זאת.`,
      });
    }

    if (deltaKm > 0 && draft.liters > 0) {
      const implied = deltaKm / draft.liters;
      if (implied > 40 || implied < 3) {
        warnings.push({
          field: "consumption",
          message: "הצריכה המחושבת נראית חריגה",
          detail: `הערכים שהוזנו מייצרים ${round(implied, 1)} קמ״ל. ודאו שהקילומטראז׳ והליטרים נכונים.`,
        });
      }
    }
  }

  if (draft.pricePerLiter <= 0 || draft.pricePerLiter > 20) {
    warnings.push({
      field: "price",
      message: "מחיר לליטר חריג",
      detail: "המחיר שהוזן רחוק מהטווח המקובל בישראל.",
    });
  }

  return warnings;
}

/** Hard block: the only truly impossible state is a contradictory odometer. */
export function hardBlock(
  draft: { date: number; odometer: number },
  fillups: Fillup[],
  excludeId?: string,
): string | null {
  const { min, max } = odometerBounds(fillups, draft.date, excludeId);
  const fmt = (n: number) => n.toLocaleString("he-IL");

  if (!Number.isFinite(draft.odometer) || draft.odometer <= 0) {
    return "יש להזין קילומטראז׳ תקין";
  }
  if (min !== null && max !== null && (draft.odometer < min || draft.odometer > max)) {
    return `הזן בין ${fmt(min)} ל־${fmt(max)} — לפי הרשומות הסמוכות`;
  }
  if (min !== null && max === null && draft.odometer < min) {
    return `הקילומטראז׳ חייב להיות ${fmt(min)} ומעלה`;
  }
  if (min === null && max !== null && draft.odometer > max) {
    return `הקילומטראז׳ חייב להיות עד ${fmt(max)}`;
  }
  return null;
}

/**
 * Resolve the price per liter for a fill-up, weakest source first:
 *   1. official monthly price for the fill-up's month
 *   2. + the vehicle's fixed adjustment (station discount)
 *   3. the vehicle's manual override replaces 1+2 entirely
 *   4. a per-fill-up manual edit always wins (handled by the caller)
 */
export function resolvePricePerLiter(
  date: number,
  vehicle: Pick<Vehicle, "priceAdjustment" | "manualPricePerLiter"> | null | undefined,
  prices: FuelPrices | null | undefined,
): {
  price: number | null;
  source: "manual" | "official" | "adjusted" | "none";
  /** True when the official figure came from that month's own record rather
   *  than falling back to the latest known price. */
  fromHistory: boolean;
} {
  if (vehicle?.manualPricePerLiter && vehicle.manualPricePerLiter > 0) {
    return {
      price: round(vehicle.manualPricePerLiter, 3),
      source: "manual",
      fromHistory: false,
    };
  }

  const historic = prices?.history?.[monthKey(date)];
  const fromHistory = typeof historic === "number" && Number.isFinite(historic);
  const official = fromHistory ? historic : (prices?.current?.pricePerLiter ?? null);

  if (official === null || !Number.isFinite(official)) {
    return { price: null, source: "none", fromHistory: false };
  }

  const adjustment = vehicle?.priceAdjustment ?? 0;
  if (adjustment !== 0) {
    return {
      price: round(Math.max(0, official + adjustment), 3),
      source: "adjusted",
      fromHistory,
    };
  }
  return { price: round(official, 3), source: "official", fromHistory };
}

/** Restrict a fill-up list to a trailing window, for the stats range control. */
export function filterByRange(
  fillups: Fillup[],
  range: "3m" | "6m" | "1y" | "all",
  now = Date.now(),
): Fillup[] {
  if (range === "all") return fillups;
  const months = range === "3m" ? 3 : range === "6m" ? 6 : 12;
  const from = new Date(now);
  from.setMonth(from.getMonth() - months);
  return fillups.filter((f) => f.date >= from.getTime());
}
