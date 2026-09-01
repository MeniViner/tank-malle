import type { Stats, Vehicle } from "./stats";

/**
 * Operational summaries for the admin dashboard.
 *
 * The dashboard needs counts and averages. It does not need anyone's fill-up
 * records, and reading them to produce a count is both a privacy cost and the
 * unbounded read pattern that made /admin a quota risk.
 *
 * So each client publishes a small summary of what it has already computed —
 * no dates beyond the last fill-up, no odometer readings, no stations, no
 * notes, no prices paid per record. The dashboard reads those.
 *
 * **These are client-produced and must never back a security decision.** A
 * modified client can write whatever numbers it likes into its own summary.
 * They are operational telemetry, nothing more, and the rules keep them
 * bounded so a hostile value cannot break the dashboard either.
 */

/** Bump when the shape changes, so a stale summary can be recognised. */
export const SUMMARY_VERSION = 1;

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
    previous.fuelType !== next.fuelType
  );
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
