/**
 * Consumption learning.
 *
 * Fitted in LITRES PER KILOMETRE. km/L and L/100 km are presentation units and
 * appear nowhere in this file — averaging km/L and averaging L/100 km are two
 * different operations with two different answers, and mixing them is the class
 * of bug this convention removes.
 *
 * The measured segments come from the existing continuity-safe engine, so this
 * module never invents a competing definition of "a segment".
 */

import { buildSegments, sortFillups, type Fillup, type Segment, type Vehicle } from "../stats";
import {
  BASELINE_HALF_LIFE_DAYS,
  DECLARED_PRIOR_RELATIVE_SD,
  ENDPOINT_QUALITY,
  MIN_CONSUMPTION_QUALITY_MASS,
  MIN_CONSUMPTION_RELATIVE_SD,
  RECENT_HALF_LIFE_DAYS,
  RECENT_WINDOW_DAYS,
  ROBUST_SPAN,
  SHRINKAGE_STRENGTH,
  TANK_SCHEMA_VERSION,
} from "./config";
import { elapsedDays } from "./calendar";
import { recencyWeight, weightedMedian, weightedStdDev, winsorise } from "./numeric";
import type { FillEndStateSource } from "./types";

export interface ConsumptionSample {
  segment: Segment;
  /** Litres per kilometre for this segment. */
  litersPerKm: number;
  km: number;
  liters: number;
  /** Evidence quality from PROVENANCE — never from agreement with the model. */
  quality: number;
  ageDays: number;
}

export interface ConsumptionEstimate {
  /** Litres per kilometre. Null when nothing supports a figure. */
  litersPerKm: number | null;
  /** Standard deviation of `litersPerKm`. */
  sd: number | null;
  source: "history" | "declared-prior" | "none";
  /** Σ(quality × recency) over the segments used. Not a count. */
  qualityMass: number;
  segmentCount: number;
  /** Long-history figure, before shrinkage. */
  baselineLitersPerKm: number | null;
  /** Trailing-window figure, before shrinkage. */
  recentLitersPerKm: number | null;
  /** Convenience for presentation only. */
  kmPerLiter: number | null;
}

const NONE: ConsumptionEstimate = {
  litersPerKm: null,
  sd: null,
  source: "none",
  qualityMass: 0,
  segmentCount: 0,
  baselineLitersPerKm: null,
  recentLitersPerKm: null,
  kmPerLiter: null,
};

/**
 * How much a segment endpoint proves.
 *
 * A pre-upgrade record scores as a legacy assumption whatever `fullTankSource`
 * says, because the old form wrote `"user"` on its own. Only the schema version
 * can tell a statement from an assumption.
 */
export function endpointQuality(fillup: Fillup): number {
  if (fillup.tankSchemaVersion === TANK_SCHEMA_VERSION && fillup.fillEndState) {
    const source: FillEndStateSource = fillup.fillEndStateSource ?? "unknown";
    return ENDPOINT_QUALITY[source] ?? ENDPOINT_QUALITY.unknown;
  }
  return ENDPOINT_QUALITY["legacy-assumption"];
}

/** Segments paired with the evidence quality of the pair that bounds them. */
export function buildConsumptionSamples(
  fillups: readonly Fillup[],
  now: number,
): ConsumptionSample[] {
  const sorted = sortFillups([...fillups]);
  const byId = new Map(sorted.map((fillup) => [fillup.id, fillup]));

  return buildSegments(sorted)
    .filter((segment) => segment.km > 0 && segment.liters > 0)
    .map((segment) => {
      const start = byId.get(segment.startId);
      const end = byId.get(segment.endId);
      const quality = Math.min(
        start ? endpointQuality(start) : ENDPOINT_QUALITY.unknown,
        end ? endpointQuality(end) : ENDPOINT_QUALITY.unknown,
      );
      return {
        segment,
        litersPerKm: segment.liters / segment.km,
        km: segment.km,
        liters: segment.liters,
        quality,
        ageDays: Math.max(0, elapsedDays(segment.endDate, now)),
      };
    });
}

/**
 * The ratio estimator, on winsorised litres.
 *
 *   c = Σ(wᵢ · litresᵢ) / Σ(wᵢ · kmᵢ)
 *
 * Distance-weighted by construction, which is what makes a 900 km segment count
 * for more than a 200 km one. An unusual segment is pulled back to the edge of
 * a band around the weighted median rather than dropped: nothing here can tell
 * a mistyped odometer from a genuinely different month of driving, so a real
 * change survives while a typo cannot dominate.
 */
function ratioEstimate(
  samples: readonly ConsumptionSample[],
  weights: readonly number[],
): { litersPerKm: number | null; sd: number | null; mass: number } {
  let mass = 0;
  for (const weight of weights) mass += weight;
  if (mass <= 0 || samples.length === 0) {
    return { litersPerKm: null, sd: null, mass: 0 };
  }

  const median = weightedMedian(
    samples.map((sample, index) => ({ value: sample.litersPerKm, weight: weights[index] })),
  );
  const low = median !== null ? median / ROBUST_SPAN : 0;
  const high = median !== null ? median * ROBUST_SPAN : Number.POSITIVE_INFINITY;

  let numerator = 0;
  let denominator = 0;
  const clipped: { value: number; weight: number }[] = [];

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const weight = weights[i];
    if (weight <= 0) continue;
    const rate = median !== null ? winsorise(sample.litersPerKm, low, high) : sample.litersPerKm;
    numerator += weight * rate * sample.km;
    denominator += weight * sample.km;
    clipped.push({ value: rate, weight });
  }

  if (denominator <= 0) return { litersPerKm: null, sd: null, mass };
  return {
    litersPerKm: numerator / denominator,
    sd: weightedStdDev(clipped),
    mass,
  };
}

/**
 * Consumption for one vehicle.
 *
 * Three figures are produced — a stable long-history baseline, a
 * recency-weighted estimate and their shrinkage blend — so a sustained change
 * is adopted gradually while a single odd tank does not move the headline.
 */
export function estimateConsumption(
  fillups: readonly Fillup[],
  vehicle: Pick<Vehicle, "declaredKmPerLiter" | "declaredSource"> | null | undefined,
  now: number,
): ConsumptionEstimate {
  const samples = buildConsumptionSamples(fillups, now);

  if (samples.length === 0) return declaredPrior(vehicle) ?? NONE;

  const baselineWeights = samples.map(
    (sample) => sample.quality * recencyWeight(sample.ageDays, BASELINE_HALF_LIFE_DAYS),
  );
  const recentWeights = samples.map((sample) =>
    sample.ageDays <= RECENT_WINDOW_DAYS
      ? sample.quality * recencyWeight(sample.ageDays, RECENT_HALF_LIFE_DAYS)
      : 0,
  );

  const baseline = ratioEstimate(samples, baselineWeights);
  const recent = ratioEstimate(samples, recentWeights);

  if (baseline.litersPerKm === null) return declaredPrior(vehicle) ?? NONE;

  // Shrink the recent figure toward the baseline in proportion to how much
  // recent evidence there actually is. Sparse recent evidence therefore barely
  // moves the answer, which is the correct behaviour and not a lack of nerve.
  const litersPerKm =
    recent.litersPerKm !== null
      ? (recent.mass * recent.litersPerKm + SHRINKAGE_STRENGTH * baseline.litersPerKm) /
        (recent.mass + SHRINKAGE_STRENGTH)
      : baseline.litersPerKm;

  const qualityMass = baseline.mass;
  const spread = Math.max(
    baseline.sd ?? 0,
    litersPerKm * MIN_CONSUMPTION_RELATIVE_SD,
  );

  // Thin evidence widens the interval. It never narrows it.
  const inflation =
    qualityMass >= MIN_CONSUMPTION_QUALITY_MASS
      ? 1
      : Math.min(3, MIN_CONSUMPTION_QUALITY_MASS / Math.max(0.2, qualityMass));

  return {
    litersPerKm,
    sd: spread * inflation,
    source: "history",
    qualityMass,
    segmentCount: samples.length,
    baselineLitersPerKm: baseline.litersPerKm,
    recentLitersPerKm: recent.litersPerKm,
    kmPerLiter: litersPerKm > 0 ? 1 / litersPerKm : null,
  };
}

/**
 * Cold start from the manufacturer's certified figure.
 *
 * Only the exact-year figure qualifies, it is labelled as a prior, and it is
 * given a deliberately broad spread. A declared consumption is a laboratory
 * result for a model, not a measurement of this car being driven by this
 * person — and it never enters the measured statistics or the shared benchmark.
 */
function declaredPrior(
  vehicle: Pick<Vehicle, "declaredKmPerLiter" | "declaredSource"> | null | undefined,
): ConsumptionEstimate | null {
  const declared = vehicle?.declaredKmPerLiter;
  if (!declared || declared <= 0) return null;
  if (vehicle?.declaredSource !== "exact-year") return null;

  const litersPerKm = 1 / declared;
  return {
    litersPerKm,
    sd: litersPerKm * DECLARED_PRIOR_RELATIVE_SD,
    source: "declared-prior",
    qualityMass: 0,
    segmentCount: 0,
    baselineLitersPerKm: null,
    recentLitersPerKm: null,
    kmPerLiter: declared,
  };
}
