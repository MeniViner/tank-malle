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

import { TANK_SCHEMA_VERSION } from "./tank/config";
import { closesInterval } from "./tank/observations";
import type { FillEndState, FillupTankFields, TankPreferences } from "./tank/types";

export type FuelType = "95" | "98" | "diesel" | "other";

/**
 * `FillupTankFields` carries the optional tank-state measurements. They are
 * stored ON the fill-up because a measurement taken at a fill-up belongs to it:
 * one document, one write, and no way to end up with an orphaned observation
 * pointing at a record that failed to save.
 */
export interface Fillup extends FillupTankFields {
  id: string;
  /** Epoch milliseconds. May be any past date. */
  date: number;
  /** Odometer reading in km at the moment of filling. */
  odometer: number;
  liters: number;
  pricePerLiter: number;
  totalCost: number;
  /**
   * True when the tank was FULL at the END of this fill-up — regardless of how
   * much was in it on arrival. A partial fill-up does not close a consumption
   * segment; its liters roll into the open one.
   *
   * Retained for compatibility and written as `fillEndState === "full"`. It is
   * a PROJECTION: on a new record it cannot distinguish a declared partial from
   * an unknown end state, so read it alongside `fillEndState` — `closesInterval`
   * is the function that does.
   */
  isFullTank: boolean;
  station?: StationRef | null;
  notes?: string | null;
  createdAt?: number;

  /**
   * The user declared that undocumented fill-ups happened before this record.
   * No metric may cross it. Absent on every pre-upgrade document, and absence
   * means `false`, so existing data computes exactly as it did before.
   */
  continuityBreakBefore?: boolean;
  /** Provenance of `isFullTank`, so a legacy assumption is never passed off
   *  as an explicit user statement. */
  fullTankSource?: "user" | "legacy-assumption";
  /** Pump price, when the user confirmed it matched. Never inferred. */
  postedPricePerLiter?: number | null;
  /** Snapshot; falls back to the vehicle's fuel type when absent. */
  fuelType?: FuelType | null;

  /* --- import provenance --- */
  importSource?: string | null;
  importBatchId?: string | null;
  importRowHash?: string | null;
  schemaVersion?: number;
}

/** A station reference. `stationId` is the identity; the rest are snapshots. */
export interface StationRef {
  name: string;
  lat?: number;
  lng?: number;
  /** Stable id from the government catalog. Absent on legacy records. */
  stationId?: string | null;
  brand?: string | null;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year?: number | null;
  plateNumber?: string | null;
  fuelType: FuelType;
  tankLiters?: number | null;
  /**
   * Where `tankLiters` came from. Absent means "stored before provenance
   * existed", which is NOT the same as confirmed — see `isTankCapacityTrusted`.
   * Only a trusted capacity may drive a user-facing range figure.
   */
  tankLitersSource?: "user" | "trusted" | "estimate" | "legacy" | null;
  declaredKmPerLiter?: number | null;
  /** Whether `declaredKmPerLiter` is an exact-year certified figure. */
  declaredSource?: "user" | "exact-year" | "other-year" | null;
  /** ₪/liter delta applied on top of the official price. */
  priceAdjustment: number;
  /** Overrides the official price + adjustment entirely. */
  manualPricePerLiter?: number | null;
  nickname?: string | null;
  archived: boolean;
  createdAt?: number;
  /** Registry codes, kept so the WLTP spec register can be re-queried. */
  tozeretCd?: number | null;
  degemCd?: number | null;
  /**
   * Tank-tracker preferences. Self-reported answers are PRIORS — a stated
   * habit is not a measured one — and the reserve is a comfort buffer the user
   * chose, not a manufacturer figure.
   */
  tankPrefs?: TankPreferences | null;
}

/**
 * True when a stored tank capacity may drive a user-facing range figure.
 *
 * Only a value the user entered or confirmed, or one from a vehicle-specific
 * trustworthy source, qualifies. A pre-provenance value is treated as unknown
 * rather than assumed correct: most of those were written by the body-type
 * estimator without anybody being told, and a guessed capacity produces a
 * confident-looking range that is simply made up.
 */
export function isTankCapacityTrusted(
  vehicle: Pick<Vehicle, "tankLiters" | "tankLitersSource"> | null | undefined,
): boolean {
  if (!vehicle?.tankLiters || vehicle.tankLiters <= 0) return false;
  return vehicle.tankLitersSource === "user" || vehicle.tankLitersSource === "trusted";
}

export interface FuelPrices {
  current?: { pricePerLiter: number; effectiveFrom?: number; updatedAt?: number } | null;
  /** Month-keyed history, e.g. { "2026-08": 7.31 }. */
  history?: Record<string, number>;
}

/**
 * The stretch after the most recent full tank that the next full fill-up will
 * close. Exposed explicitly so the UI can tell the user that partial fill-ups
 * are being retained rather than quietly dropped.
 */
export interface OpenSegment {
  /** False until a full fill-up has established a starting point. */
  hasBaseline: boolean;
  baselineId: string | null;
  baselineDate: number | null;
  baselineOdometer: number | null;
  /** Liters added since the baseline, across every pending partial. */
  liters: number;
  cost: number;
  /** Distance covered since the baseline. */
  km: number;
  pendingFillups: number;
  /** True when the next fill-up marked full will produce a consumption result. */
  nextFullWillClose: boolean;
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
  /** tankLiters × avgKmPerLiter — only when the capacity is trusted. */
  estimatedRangeKm: number | null;
  avgPricePaid: number | null;
  /** Signed ₪ difference between the average paid price and the official one. */
  avgPriceVsOfficial: number | null;
  /**
   * Σ over continuity islands of (last odometer − first odometer).
   * NOT max(odometer) − min(odometer): that would bridge a declared break.
   */
  totalKm: number;
  /** The live open segment — what the next full fill-up will close. */
  openSegment: OpenSegment;
  /** Continuity islands, oldest → newest. One island means no declared break. */
  islands: Fillup[][];
  /** Number of declared continuity breaks. */
  breakCount: number;
  records: Records;
  anomalies: Anomaly[];
  stationStats: StationStat[];
  /** Series ready for the charts, oldest → newest. */
  consumptionSeries: SeriesPoint<{ kmPerLiter: number }>[];
  priceSeries: SeriesPoint<{ paid: number; official: number | null }>[];
  odometerSeries: SeriesPoint<{ odometer: number }>[];
}

/**
 * A chart point. `gapBefore` marks the first point of a new continuity island:
 * the line must break there rather than interpolating across history the user
 * told us is missing.
 */
export type SeriesPoint<T> = T & { date: number; label: string; gapBefore: boolean };

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
 * Split the canonical list into continuity islands.
 *
 * A fill-up carrying `continuityBreakBefore` is the FIRST record of a new
 * island: the user told us that history is missing before it, so nothing may
 * be computed across that boundary. Records before the break stay visible —
 * they are simply in a different island.
 *
 * Elapsed time and distance alone never create a break. A month without
 * refuelling is a real thing that happens, not evidence of missing data.
 */
export function buildIslands(fillups: Fillup[]): Fillup[][] {
  // Sorted defensively: a break is positional, so an unsorted list would split
  // in the wrong place. sortFillups is idempotent, so this is free when the
  // caller already sorted.
  const islands: Fillup[][] = [];
  let current: Fillup[] = [];

  for (const fill of sortFillups(fillups)) {
    if (fill.continuityBreakBefore === true && current.length > 0) {
      islands.push(current);
      current = [];
    }
    current.push(fill);
  }
  if (current.length > 0) islands.push(current);
  return islands;
}

/**
 * Build consumption segments inside a single island.
 *
 * A segment opens at a full tank and closes at the *next* full tank. Partial
 * fill-ups in between do not close it — their liters are added to the open
 * segment, because the tank level at a partial fill is unknown. The opening
 * fill-up's own liters are NOT counted: they were burnt before it.
 *
 *   kmPerLiter = (odoEnd − odoStart) / Σ liters(fills after the start,
 *                                               through the closing full tank)
 */
function segmentsForIsland(island: Fillup[]): Segment[] {
  const segments: Segment[] = [];
  let start: Fillup | null = null;
  let liters = 0;
  let cost = 0;
  let count = 0;

  for (const fill of island) {
    if (start === null) {
      // A segment can only start from a known-full tank.
      if (closesInterval(fill)) start = fill;
      continue;
    }

    liters += fill.liters;
    cost += fill.totalCost;
    count += 1;

    // An unknown or partial endpoint cannot close an accurate interval: the
    // litres bought say nothing about what was already in the tank. They stay
    // in the open segment and are counted by the next confirmed full tank.
    if (!closesInterval(fill)) continue;

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

/**
 * Every closed segment across every island, in chronological order.
 * A segment never spans a continuity break.
 */
export function buildSegments(sorted: Fillup[]): Segment[] {
  return buildIslands(sorted).flatMap(segmentsForIsland);
}

/**
 * The live open segment: the stretch after the most recent full tank in the
 * LAST island, which the next full fill-up will close.
 *
 * Open segments in earlier islands are discarded — the break declared that
 * their history is incomplete, so they can never be closed validly.
 */
export function buildOpenSegment(sorted: Fillup[]): OpenSegment {
  const empty: OpenSegment = {
    hasBaseline: false,
    baselineId: null,
    baselineDate: null,
    baselineOdometer: null,
    liters: 0,
    cost: 0,
    km: 0,
    pendingFillups: 0,
    nextFullWillClose: false,
  };

  const islands = buildIslands(sorted);
  const island = islands[islands.length - 1];
  if (!island || island.length === 0) return empty;

  // Walk back to the last full tank; everything after it is the open segment.
  let baselineIndex = -1;
  for (let i = island.length - 1; i >= 0; i -= 1) {
    if (closesInterval(island[i])) {
      baselineIndex = i;
      break;
    }
  }
  if (baselineIndex === -1) return empty;

  const baseline = island[baselineIndex];
  const after = island.slice(baselineIndex + 1);
  const liters = after.reduce((sum, f) => sum + f.liters, 0);
  const cost = after.reduce((sum, f) => sum + f.totalCost, 0);
  const latest = after.length > 0 ? after[after.length - 1] : baseline;

  return {
    hasBaseline: true,
    baselineId: baseline.id,
    baselineDate: baseline.date,
    baselineOdometer: baseline.odometer,
    liters: round(liters, 3),
    cost: round(cost, 2),
    km: latest.odometer - baseline.odometer,
    pendingFillups: after.length,
    // A next full fill-up closes a segment as long as it adds distance, which
    // it will unless the odometer is unchanged.
    nextFullWillClose: true,
  };
}

/** Σ over islands of (last odometer − first odometer). Never bridges a break. */
export function validTrackedKm(sorted: Fillup[]): number {
  return buildIslands(sorted).reduce((sum, island) => {
    if (island.length < 2) return sum;
    return sum + (island[island.length - 1].odometer - island[0].odometer);
  }, 0);
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

  // Island-aware: distance is only "tracked" inside a continuity island.
  const totalKm = validTrackedKm(sorted);

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
  const islands = buildIslands(sorted);
  const segments = islands.flatMap(segmentsForIsland);
  const months = buildMonths(sorted, segments);
  const records = buildRecords(sorted, months);
  const openSegment = buildOpenSegment(sorted);
  // Ids that open a new island — the charts break their line at these points.
  const islandOpeners = new Set(islands.slice(1).map((island) => island[0].id));

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

  // Summed per island, so an undocumented gap does not inflate the denominator
  // with days the odometer distance never covered.
  const spanDays = islands.reduce((sum, island) => {
    if (island.length < 2) return sum;
    const dates = island.map((f) => f.date);
    return sum + (Math.max(...dates) - Math.min(...dates)) / DAY_MS;
  }, 0);
  const kmPerDay = spanDays > 0 ? round(records.totalKm / spanDays, 1) : null;
  const kmPerMonth = kmPerDay !== null ? round(kmPerDay * 30.44, 0) : null;

  // Only a capacity the user entered or confirmed may produce a range figure.
  // A class-based guess multiplied by a real average still reads as a fact on
  // screen, which is exactly the fabrication this gate exists to stop.
  const estimatedRangeKm =
    isTankCapacityTrusted(vehicle) && vehicle?.tankLiters && avgKmPerLiter
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
    openSegment,
    islands,
    breakCount: Math.max(0, islands.length - 1),
    records,
    anomalies: buildAnomalies(sorted, segments, vehicle),
    stationStats: buildStationStats(sorted),
    consumptionSeries: segments.map((s) => ({
      date: s.endDate,
      kmPerLiter: s.kmPerLiter,
      label: shortLabel(s.endDate),
      gapBefore: islandOpeners.has(s.startId),
    })),
    priceSeries: [...sorted]
      .sort((a, b) => a.date - b.date)
      .map((f) => ({
        date: f.date,
        paid: f.pricePerLiter,
        official: officialFor(f.date),
        label: shortLabel(f.date),
        gapBefore: islandOpeners.has(f.id),
      })),
    odometerSeries: [...sorted]
      .sort((a, b) => a.date - b.date)
      .map((f) => ({
        date: f.date,
        odometer: f.odometer,
        label: shortLabel(f.date),
        gapBefore: islandOpeners.has(f.id),
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
  draft: DraftFillup,
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

  }

  // Consumption is only checkable when the draft actually CLOSES a segment.
  // Dividing the distance since the previous record by only this record's
  // liters is wrong whenever a partial sits in between, whenever the previous
  // record is not the opening full tank, or across a continuity break — so
  // the check runs through the same engine everything else uses.
  const evaluation = evaluateDraft(draft, fillups, excludeId);
  if (evaluation.consumptionWarning) warnings.push(evaluation.consumptionWarning);

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
 * Suggest a price per litre for a fill-up form.
 *
 * This is a SUGGESTION for a field the user can overwrite — not a claim about
 * what any station charges. The sources, weakest first:
 *
 *   1. the regulated maximum for the vehicle's OWN fuel type
 *   2. + the vehicle's legacy fixed adjustment
 *   3. the vehicle's legacy manual override, replacing 1 and 2
 *   4. a per-fill-up edit, which always wins (handled by the caller)
 *
 * The fuel type is the change that matters. The regulated maximum in Israel
 * covers 95-octane self-service and nothing else, so a diesel or 98 vehicle now
 * gets `source: "unsupportedFuelType"` and no number, where it previously got
 * the 95 figure presented as its own.
 *
 * `priceAdjustment` and `manualPricePerLiter` are retained exactly as stored,
 * but they are reported as LEGACY sources so the UI can name them rather than
 * letting a forgotten override quietly set every future price.
 */
export function resolvePricePerLiter(
  date: number,
  vehicle:
    | Pick<Vehicle, "priceAdjustment" | "manualPricePerLiter" | "fuelType">
    | null
    | undefined,
  prices: FuelPrices | null | undefined,
): {
  price: number | null;
  source:
    | "legacyManual"
    | "regulatedMax"
    | "legacyAdjusted"
    | "unsupportedFuelType"
    | "none";
  /** True when the figure came from that month's own record rather than
   *  falling back to the latest known price. */
  fromHistory: boolean;
  /** The fuel type the figure applies to, so a caller cannot misattribute it. */
  fuelType: FuelType;
} {
  const fuelType = vehicle?.fuelType ?? "95";

  if (vehicle?.manualPricePerLiter && vehicle.manualPricePerLiter > 0) {
    return {
      price: round(vehicle.manualPricePerLiter, 3),
      source: "legacyManual",
      fromHistory: false,
      fuelType,
    };
  }

  // The regulated maximum is published for 95 self-service only. There is no
  // authoritative Israeli figure for 98 or diesel, and substituting the 95 one
  // would be a fabrication — so the honest answer is "we do not know".
  if (fuelType !== "95") {
    return { price: null, source: "unsupportedFuelType", fromHistory: false, fuelType };
  }

  const historic = prices?.history?.[monthKey(date)];
  const fromHistory = typeof historic === "number" && Number.isFinite(historic);
  const regulated = fromHistory ? historic : (prices?.current?.pricePerLiter ?? null);

  if (regulated === null || !Number.isFinite(regulated)) {
    return { price: null, source: "none", fromHistory: false, fuelType };
  }

  const adjustment = vehicle?.priceAdjustment ?? 0;
  if (adjustment !== 0) {
    return {
      price: round(Math.max(0, regulated + adjustment), 3),
      source: "legacyAdjusted",
      fromHistory,
      fuelType,
    };
  }
  return { price: round(regulated, 3), source: "regulatedMax", fromHistory, fuelType };
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


/* ------------------------------------------------------------------ *
 * Canonical draft evaluation
 * ------------------------------------------------------------------ */

/** The subset of a fill-up the engine needs to evaluate an unsaved draft. */
export interface DraftFillup {
  date: number;
  odometer: number;
  liters: number;
  pricePerLiter: number;
  totalCost?: number;
  isFullTank?: boolean;
  continuityBreakBefore?: boolean;
  /**
   * End state of the tank. When present it decides everything; `isFullTank` is
   * then only the compatibility projection of it.
   */
  fillEndState?: FillEndState;
}

/** Sentinel id for the draft while it sits in the temporary canonical list. */
export const DRAFT_ID = "__draft__";

export type DraftOutcome =
  /** The draft closed a valid segment — a real consumption figure exists. */
  | "closedSegment"
  /** The draft is a full tank that starts (or restarts) a baseline. */
  | "baseline"
  /** The draft is partial; its liters wait for the next full tank. */
  | "partialRetained"
  /** The draft is partial and no baseline exists yet, so nothing accumulates
   *  toward a result until a full tank is recorded. */
  | "partialNoBaseline"
  /**
   * The end state was never stated, so the record cannot close an interval.
   * Distinct from "partialRetained": the user did not declare a partial fill,
   * they simply did not say — and the difference is worth surfacing, because
   * one tap on "מילאתי מיכל מלא" turns it into a measurement.
   */
  | "unknownRetained";

export interface DraftEvaluation {
  outcome: DraftOutcome;
  /** The segment this draft closed, or null. Never an approximation. */
  segment: Segment | null;
  /** Open-segment state as it will be AFTER the draft is saved. */
  openSegment: OpenSegment;
  /** True when the draft declared a break in recorded history. */
  startsNewPeriod: boolean;
  /** Only ever produced from a real closed segment. */
  consumptionWarning: SoftWarning | null;
}

/**
 * Evaluate an unsaved draft against the real history.
 *
 * The draft is inserted into a temporary canonical list, continuity islands
 * and segments are rebuilt exactly as they are everywhere else, and the result
 * reports what the draft actually did. This is the single authority: no screen,
 * toast, validator or chart may derive consumption any other way.
 */
export function evaluateDraft(
  draft: DraftFillup,
  fillups: Fillup[],
  excludeId?: string,
): DraftEvaluation {
  const endState: FillEndState =
    draft.fillEndState ?? (draft.isFullTank === false ? "partial" : "full");
  const isFull = endState === "full";

  const candidate: Fillup = {
    id: DRAFT_ID,
    date: draft.date,
    odometer: draft.odometer,
    liters: draft.liters,
    pricePerLiter: draft.pricePerLiter,
    totalCost: draft.totalCost ?? draft.liters * draft.pricePerLiter,
    isFullTank: isFull,
    continuityBreakBefore: draft.continuityBreakBefore === true,
    fillEndState: endState,
    tankSchemaVersion: TANK_SCHEMA_VERSION,
  };

  const merged = sortFillups([
    ...fillups.filter((f) => f.id !== excludeId && f.id !== DRAFT_ID),
    candidate,
  ]);

  const segments = buildSegments(merged);
  const closed = segments.find((segment) => segment.endId === DRAFT_ID) ?? null;

  // The open segment as it stands once the draft is saved. When the draft is
  // not the newest record, the trailing open segment belongs to whatever comes
  // after it — which is still the correct thing to show.
  const openSegment = buildOpenSegment(merged);

  let outcome: DraftOutcome;
  if (closed) {
    outcome = "closedSegment";
  } else if (isFull) {
    outcome = "baseline";
  } else if (endState === "unknown") {
    outcome = "unknownRetained";
  } else {
    // Does a baseline exist before the draft inside its own island?
    const island =
      buildIslands(merged).find((group) => group.some((f) => f.id === DRAFT_ID)) ?? [];
    const index = island.findIndex((f) => f.id === DRAFT_ID);
    const hasBaseline = island.slice(0, index).some((f) => closesInterval(f));
    outcome = hasBaseline ? "partialRetained" : "partialNoBaseline";
  }

  let consumptionWarning: SoftWarning | null = null;
  if (closed && (closed.kmPerLiter > 40 || closed.kmPerLiter < 3)) {
    consumptionWarning = {
      field: "consumption",
      message: "הצריכה המחושבת נראית חריגה",
      detail:
        `המקטע שנסגר מייצר ${round(closed.kmPerLiter, 1)} קמ״ל ` +
        `(${int(closed.km)} ק״מ על ${round(closed.liters, 2)} ל׳). ` +
        `ודאו שהקילומטראז׳ והליטרים נכונים.`,
    };
  }

  return {
    outcome,
    segment: closed,
    openSegment,
    startsNewPeriod: candidate.continuityBreakBefore === true,
    consumptionWarning,
  };
}

function int(value: number): string {
  return Math.round(value).toLocaleString("he-IL");
}

/**
 * Restrict CLOSED SEGMENTS to a window by their closing date.
 *
 * Segments must be built on the complete history first and only then filtered,
 * otherwise a valid segment vanishes whenever its opening full tank happens to
 * sit one day outside the selected range.
 */
export function filterSegmentsByRange(
  segments: Segment[],
  from: number | null,
  to: number | null,
): Segment[] {
  return segments.filter(
    (segment) =>
      (from === null || segment.endDate >= from) && (to === null || segment.endDate <= to),
  );
}
