import type { Stats, Vehicle } from "./stats";
import type { LedgerRow } from './vehicle/derived';
import { financialTotals } from './vehicle/financial';
import { localDay } from './maintenance/model';

/**
 * Operational summaries for the admin dashboard.
 *
 * The dashboard needs counts and averages. It does not need anyone's fill-up
 * records, and reading them to produce a count is both a privacy cost and the
 * unbounded read pattern that made /admin a quota risk.
 *
 * So each client publishes a small summary of what it has already computed —
 * only the last fill-up time and six coarse month buckets, no odometer
 * readings, stations, notes or per-record prices. The dashboard reads those.
 *
 * **These are client-produced and must never back a security decision.** A
 * modified client can write whatever numbers it likes into its own summary.
 * They are operational telemetry, nothing more, and the rules keep them
 * bounded so a hostile value cannot break the dashboard either.
 */

/** Bump when the shape changes, so a stale summary can be recognised. */
export const SUMMARY_VERSION = 2;

export interface LedgerSummary {
  counts: Record<LedgerRow['kind'], number>;
  totalAgorot: number;
  unknownCosts: number;
  months: { month: string; totalAgorot: number; unknownCosts: number }[];
}

export interface VehicleSummary {
  fuelType: string;
  fillups: number;
  /** Σ over continuity islands. Never max(odometer) − min(odometer). */
  trackedKm: number;
  liters: number;
  cost: number;
  /** Distance-weighted across closed segments, or null if none have closed. */
  kmPerLiter: number | null;
  segments: number;
  lastFillupAt: number | null;
  updatedAt: number;
  /** Optional for clients that have not yet published the unified ledger. */
  ledger?: LedgerSummary;
}

export interface UserSummary {
  version: number;
  vehicleCount: number;
  /** Keyed by vehicle id. Only vehicles this client has actually opened. */
  vehicles: Record<string, VehicleSummary>;
  updatedAt: number;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f + Number.EPSILON) / f;
}

/** Build the summary for one vehicle from statistics already computed. */
export function summariseVehicle(
  vehicle: Pick<Vehicle, "fuelType">,
  stats: Stats,
  now: number = Date.now(),
): VehicleSummary {
  const dates = stats.fillups.map((fillup) => fillup.date);
  return {
    fuelType: vehicle.fuelType,
    fillups: stats.records.fillupCount,
    trackedKm: Math.round(stats.totalKm),
    liters: round(stats.records.totalLiters, 1),
    cost: round(stats.records.totalCost, 2),
    kmPerLiter: stats.avgKmPerLiter === null ? null : round(stats.avgKmPerLiter, 2),
    segments: stats.segments.length,
    lastFillupAt: dates.length > 0 ? Math.max(...dates) : null,
    updatedAt: now,
  };
}

/**
 * Has anything worth writing changed?
 *
 * The dashboard is not a live feed, and this runs on a screen people revisit
 * constantly. Rewriting an identical summary would burn write quota for
 * nothing.
 */
export function summaryChanged(
  previous: VehicleSummary | undefined,
  next: VehicleSummary,
): boolean {
  if (!previous) return true;
  return (
    previous.fillups !== next.fillups ||
    previous.trackedKm !== next.trackedKm ||
    previous.segments !== next.segments ||
    previous.kmPerLiter !== next.kmPerLiter ||
    previous.cost !== next.cost ||
    previous.liters !== next.liters ||
    previous.lastFillupAt !== next.lastFillupAt ||
    previous.fuelType !== next.fuelType ||
    JSON.stringify(previous.ledger) !== JSON.stringify(next.ledger)
  );
}

/** Coarse, bounded totals only; never publish notes, mileage or record identities. */
export function summariseLedger(rows: LedgerRow[], now = Date.now()): LedgerSummary {
  const counts: LedgerSummary['counts'] = { fuel: 0, service: 0, expense: 0, odometer: 0, tank: 0, issue: 0 };
  for (const row of rows) counts[row.kind]++;
  const totals = financialTotals(rows);
  const today = localDay(new Date(now));
  const current = new Date(`${today.slice(0, 7)}-01T12:00:00`);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(current.getFullYear(), current.getMonth() - 5 + index, 1, 12);
    const month = localDay(date).slice(0, 7);
    const total = financialTotals(rows.filter(row => row.day.startsWith(month) && row.day <= today));
    return { month, totalAgorot: total.total, unknownCosts: total.unknown };
  });
  return { counts, totalAgorot: totals.total, unknownCosts: totals.unknown, months };
}

/** Summaries are owner-written telemetry, not trusted application records. */
export function readUserSummary(value: unknown): UserSummary | null {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const number = (v: unknown, low = 0, high = 1e12): v is number => typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high;
  const count = (v: unknown): v is number => number(v, 0, 1e8) && Number.isInteger(v);
  if (!object(value) || typeof value.version !== 'number' || ![1, 2].includes(value.version) || !count(value.vehicleCount) || value.vehicleCount > 100 || !object(value.vehicles) || Object.keys(value.vehicles).length > 100) return null;
  const vehicles: Record<string, VehicleSummary> = Object.create(null);
  for (const [id, v] of Object.entries(value.vehicles)) {
    if (!object(v) || typeof v.fuelType !== 'string' || !['95', '98', 'diesel', 'other'].includes(v.fuelType) ||
        !count(v.fillups) || !number(v.trackedKm) || !number(v.liters) || !number(v.cost) || !count(v.segments) ||
        !(v.kmPerLiter === null || number(v.kmPerLiter, 0.01, 1000)) || !(v.lastFillupAt === null || number(v.lastFillupAt, 0, 8.64e15)) || !number(v.updatedAt, 0, 8.64e15)) return null;
    let ledger: LedgerSummary | undefined;
    if (object(v.ledger)) {
      const l = v.ledger, kinds = ['fuel', 'service', 'expense', 'odometer', 'tank', 'issue'] as const;
      if (object(l.counts) && kinds.every(kind => count((l.counts as Record<string, unknown>)[kind])) && number(l.totalAgorot, -1e13, 1e13) && count(l.unknownCosts) && Array.isArray(l.months) && l.months.length <= 6 &&
          l.months.every(m => object(m) && typeof m.month === 'string' && /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(m.month) && number(m.totalAgorot, -1e13, 1e13) && count(m.unknownCosts)) && new Set(l.months.map(m => m.month)).size === l.months.length) {
        ledger = { counts: Object.fromEntries(kinds.map(k => [k, (l.counts as Record<string, number>)[k]])) as LedgerSummary['counts'], totalAgorot: l.totalAgorot, unknownCosts: l.unknownCosts, months: l.months as LedgerSummary['months'] };
      }
    }
    vehicles[id] = { fuelType: v.fuelType, fillups: v.fillups, trackedKm: v.trackedKm, liters: v.liters, cost: v.cost, kmPerLiter: v.kmPerLiter, segments: v.segments, lastFillupAt: v.lastFillupAt, updatedAt: v.updatedAt, ...(ledger ? { ledger } : {}) };
  }
  return { version: Number(value.version), vehicleCount: value.vehicleCount, vehicles, updatedAt: number(value.updatedAt, 0, 8.64e15) ? value.updatedAt : 0 };
}

export function aggregateLedgerSummaries(summaries: (UserSummary | null)[], now = Date.now()) {
  const vehicles = summaries.flatMap(s => Object.values(s?.vehicles ?? {}));
  const ledgers = vehicles.flatMap(v => v.ledger ? [v.ledger] : []);
  const counts = { fuel: 0, service: 0, expense: 0, odometer: 0, tank: 0, issue: 0 };
  for (const v of vehicles) {
    if (!v.ledger) counts.fuel += v.fillups;
    else for (const kind of Object.keys(counts) as (keyof typeof counts)[]) counts[kind] += v.ledger.counts[kind];
  }
  const months = summariseLedger([], now).months.map(({ month }) => {
    const available = ledgers.flatMap(l => l.months.filter(m => m.month === month));
    return { month, totalAgorot: available.reduce((s, m) => s + m.totalAgorot, 0), unknownCosts: available.reduce((s, m) => s + m.unknownCosts, 0), published: available.length };
  });
  return { counts, records: Object.values(counts).reduce((s, n) => s + n, 0), ledgerVehicles: ledgers.length,
    missingLedgers: vehicles.length - ledgers.length, missingVehicles: summaries.reduce((s, u) => s + Math.max(0, (u?.vehicleCount ?? 0) - Object.keys(u?.vehicles ?? {}).length), 0),
    unknownCosts: ledgers.reduce((s, l) => s + l.unknownCosts, 0), months };
}

/** Aggregate across users, for the dashboard's overview strip. */
export interface SummaryTotals {
  users: number;
  /** Users with a fill-up in the last 30 days. */
  active: number;
  vehicles: number;
  fillups: number;
  liters: number;
  cost: number;
  trackedKm: number;
  /** Distance-weighted, not a mean of means. */
  kmPerLiter: number | null;
  /** Users whose summary has never been written. */
  withoutSummary: number;
}

export function aggregateSummaries(
  summaries: { uid: string; summary: UserSummary | null }[],
  now: number = Date.now(),
): SummaryTotals {
  const totals: SummaryTotals = {
    users: summaries.length,
    active: 0,
    vehicles: 0,
    fillups: 0,
    liters: 0,
    cost: 0,
    trackedKm: 0,
    kmPerLiter: null,
    withoutSummary: 0,
  };

  let segmentKm = 0;
  let segmentLiters = 0;

  for (const { summary } of summaries) {
    if (!summary) {
      totals.withoutSummary += 1;
      continue;
    }

    totals.vehicles += summary.vehicleCount;

    let mostRecent: number | null = null;
    for (const vehicle of Object.values(summary.vehicles ?? {})) {
      totals.fillups += vehicle.fillups;
      totals.liters += vehicle.liters;
      totals.cost += vehicle.cost;
      totals.trackedKm += vehicle.trackedKm;

      // Distance-weighted: a car driven 40,000 km should count for more than
      // one driven 2,000, which a mean of per-user averages gets wrong.
      if (vehicle.kmPerLiter && vehicle.kmPerLiter > 0 && vehicle.trackedKm > 0) {
        segmentKm += vehicle.trackedKm;
        segmentLiters += vehicle.trackedKm / vehicle.kmPerLiter;
      }

      if (vehicle.lastFillupAt !== null) {
        mostRecent = Math.max(mostRecent ?? 0, vehicle.lastFillupAt);
      }
    }

    if (mostRecent !== null && now - mostRecent < 30 * 86_400_000) totals.active += 1;
  }

  return {
    ...totals,
    liters: round(totals.liters, 1),
    cost: round(totals.cost, 2),
    kmPerLiter: segmentLiters > 0 ? round(segmentKm / segmentLiters, 2) : null,
  };
}
