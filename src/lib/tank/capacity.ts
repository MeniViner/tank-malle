/**
 * Where a tank capacity comes from.
 *
 * Why one was needed: no Israeli open dataset publishes tank capacity. The
 * ministry's registers carry make, model, year, engine size and the certified
 * CO₂ figure — and nothing about the tank. So `vehicleSpecs` can only offer a
 * body-type approximation, and until now that approximation was a PLACEHOLDER
 * in the vehicle form. A placeholder is not a value: anybody who did not go and
 * find their owner's manual ended up with no capacity at all, which meant no
 * litres, no range and no tank tracking.
 *
 * The fix is a ladder with honest provenance rather than a single trusted slot:
 *
 *   user / trusted   an actual statement            → trusted, exact
 *   estimate         our body-type approximation    → usable, labelled
 *   observed         the largest fill-up on record  → usable, labelled
 *   none             say so
 *
 * `trusted` still means exactly what it meant before, so `isTankCapacityTrusted`
 * and everything gated on it — the range figure in `computeStats`, the shared
 * benchmark — are unchanged. What is new is that the lower rungs are no longer
 * discarded: they drive an APPROXIMATE reading that says it is approximate, and
 * they give the user a number to confirm in one tap instead of a blank field.
 */

import { isTankCapacityTrusted, type Fillup, type Vehicle } from "../stats";

export type CapacitySource = "user" | "trusted" | "estimate" | "observed" | "none";

export interface ResolvedCapacity {
  /** Usable capacity in litres, or null when nothing supports a figure. */
  liters: number | null;
  source: CapacitySource;
  /** True only for a value the user stated or a vehicle-specific record. */
  trusted: boolean;
  /**
   * A number worth offering for one-tap confirmation. Null when the capacity is
   * already trusted or when nothing plausible can be suggested.
   */
  suggestion: number | null;
}

/**
 * Bounds a tank capacity has to fall inside to be worth showing.
 *
 * Wide enough for a city car and a large SUV, narrow enough that a mistyped
 * litre count or a jerrycan top-up cannot become somebody's tank.
 */
export const MIN_PLAUSIBLE_CAPACITY = 20;
export const MAX_PLAUSIBLE_CAPACITY = 120;

/**
 * Headroom above the largest recorded fill.
 *
 * The largest fill-up is a hard LOWER BOUND — you cannot put 45 litres into a
 * 40 litre tank — and people rarely run to fumes, so the tank is a little
 * bigger than the biggest fill they have ever put in. This is deliberately a
 * suggestion to confirm, never a capacity to assert: the difference between
 * "your tank is 47 litres" and "about 47 litres, is that right?" is the whole
 * point of the provenance model.
 */
const OBSERVED_HEADROOM = 1.06;

/** Fill-ups needed before the observed maximum means anything. */
const MIN_FILLUPS_FOR_OBSERVED = 3;

function plausible(liters: number | null | undefined): number | null {
  if (typeof liters !== "number" || !Number.isFinite(liters)) return null;
  if (liters < MIN_PLAUSIBLE_CAPACITY || liters > MAX_PLAUSIBLE_CAPACITY) return null;
  return liters;
}

/**
 * The largest fill on record, with headroom — a capacity the data itself
 * implies. Only offered once there are enough records for the maximum to mean
 * something.
 */
export function observedCapacity(fillups: readonly Fillup[]): number | null {
  if (fillups.length < MIN_FILLUPS_FOR_OBSERVED) return null;

  let largest = 0;
  for (const fillup of fillups) {
    if (Number.isFinite(fillup.liters) && fillup.liters > largest) largest = fillup.liters;
  }
  if (largest <= 0) return null;

  return plausible(Math.round(largest * OBSERVED_HEADROOM));
}

/**
 * Resolve the capacity to use, and say where it came from.
 *
 * Every caller gets the same answer, so the tank card, the fill-up gauge and
 * the engine can never disagree about how big the tank is.
 */
export function resolveCapacity(
  vehicle: Vehicle | null | undefined,
  fillups: readonly Fillup[] = [],
): ResolvedCapacity {
  const stored = plausible(vehicle?.tankLiters);
  const observed = observedCapacity(fillups);

  // 1. A value the user stated, or one from a vehicle-specific record.
  if (isTankCapacityTrusted(vehicle) && stored !== null) {
    return {
      liters: stored,
      source: vehicle?.tankLitersSource === "trusted" ? "trusted" : "user",
      trusted: true,
      suggestion: null,
    };
  }

  // 2. Our own approximation, or a pre-provenance value. Usable, not trusted —
  //    and the number to put in front of the user for confirmation.
  if (stored !== null) {
    return {
      liters: stored,
      source: "estimate",
      trusted: false,
      suggestion: stored,
    };
  }

  // 3. What the fill-up history implies. Better than nothing, and by some
  //    distance better than a 50-litre default nobody chose.
  if (observed !== null) {
    return { liters: observed, source: "observed", trusted: false, suggestion: observed };
  }

  // 4. Nothing. Percentages still work; litres and range stay unavailable.
  return { liters: null, source: "none", trusted: false, suggestion: null };
}

/** Short Hebrew note naming the source, for a value that is not trusted. */
export function capacityNote(resolved: ResolvedCapacity): string | null {
  switch (resolved.source) {
    case "estimate":
      return "נפח המיכל הוא הערכה לפי סוג הרכב";
    case "observed":
      return "נפח המיכל מוערך לפי התדלוק הגדול ביותר שלך";
    default:
      return null;
  }
}
