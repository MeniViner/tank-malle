/**
 * Driving-pattern learning from irregular observations.
 *
 * What is actually observed is a distance between two odometer readings taken
 * at two arbitrary moments. The days inside that stretch are NOT separate
 * samples, and the weekday a fill-up happens to fall on is not evidence that
 * the driving happened that day. Everything here is built around those two
 * facts.
 *
 * A capability ladder, simplest rung first, and a more detailed rung is only
 * taken when the observations can actually identify it and it demonstrably
 * predicts better out of time.
 */

import { buildIslands, sortFillups, type Fillup } from "../stats";
import { dayExposures, elapsedDays } from "./calendar";
import {
  DOW_CONVERGENCE,
  DOW_HOLDOUT_FRACTION,
  DOW_LAMBDA,
  DOW_MAX_ITERATIONS,
  DOW_MIN_IMPROVEMENT,
  DOW_MIN_INTERVALS,
  DOW_MIN_SHARE_SPREAD,
  DOW_MIN_VARIED_DAYS,
  MIN_TRAVEL_RELATIVE_SD,
  TRAVEL_BASELINE_HALF_LIFE_DAYS,
  TRAVEL_HALF_LIFE_DAYS,
  TRAVEL_MIN_INTERVALS,
  TRAVEL_SHRINKAGE_STRENGTH,
} from "./config";
import { recencyWeight, weightedMean, weightedStdDev } from "./numeric";
import type { TankObservation } from "./types";

export interface TravelInterval {
  from: number;
  to: number;
  km: number;
  /** Elapsed days — physical duration, not a calendar count. */
  days: number;
  ageDays: number;
  /** Local calendar-day exposure per weekday, 0 = Sunday. */
  exposures: number[];
}

export type MobilityRung = "none" | "robustAverage" | "recencyAdaptive" | "dayOfWeek";

export interface MobilityEstimate {
  /** Expected kilometres per day. Null when nothing supports a rate. */
  kmPerDay: number | null;
  sd: number | null;
  rung: MobilityRung;
  /** Seven rates, Sunday first. Only present on the `dayOfWeek` rung. */
  kmPerWeekday: number[] | null;
  intervalCount: number;
  /** Whether per-day rates were separable from the observation windows. */
  identifiable: boolean;
  /** Out-of-time weighted-MAE improvement of C over B, when it was measured. */
  improvement: number | null;
}

const NONE: MobilityEstimate = {
  kmPerDay: null,
  sd: null,
  rung: "none",
  kmPerWeekday: null,
  intervalCount: 0,
  identifiable: false,
  improvement: null,
};

/**
 * Non-overlapping intervals from every odometer reading available.
 *
 * Fill-up odometers and standalone odometer observations are combined and each
 * reading is used exactly once, so a stretch of driving cannot be counted
 * twice. No interval crosses a declared continuity break.
 */
export function buildTravelIntervals(
  fillups: readonly Fillup[],
  observations: readonly TankObservation[],
  now: number,
  timeZone: string,
): TravelInterval[] {
  const sorted = sortFillups([...fillups]);

  // A break is positional in the canonical order; its date is the boundary
  // no interval may span.
  const breakTimes = buildIslands(sorted)
    .slice(1)
    .map((island) => island[0].date);

  const points: { at: number; odometer: number }[] = [];
  for (const fillup of sorted) {
    if (Number.isFinite(fillup.date) && Number.isFinite(fillup.odometer)) {
      points.push({ at: fillup.date, odometer: fillup.odometer });
    }
  }
  for (const observation of observations) {
    if (
      typeof observation.odometer === "number" &&
      Number.isFinite(observation.odometer) &&
      Number.isFinite(observation.observedAt)
    ) {
      points.push({ at: observation.observedAt, odometer: observation.odometer });
    }
  }

  points.sort((a, b) => a.at - b.at || a.odometer - b.odometer);

  const intervals: TravelInterval[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const km = to.odometer - from.odometer;
    const days = elapsedDays(from.at, to.at);

    if (!(days > 0) || km < 0) continue;
    if (breakTimes.some((time) => time > from.at && time <= to.at)) continue;

    intervals.push({
      from: from.at,
      to: to.at,
      km,
      days,
      ageDays: Math.max(0, elapsedDays(to.at, now)),
      exposures: dayExposures(from.at, to.at, timeZone),
    });
  }

  return intervals;
}

/** Rung A/B: a scalar rate, recency-weighted and shrunk to the lifetime one. */
function scalarRate(intervals: readonly TravelInterval[]): {
  kmPerDay: number | null;
  sd: number | null;
  recentMass: number;
} {
  if (intervals.length === 0) return { kmPerDay: null, sd: null, recentMass: 0 };

  // Longer intervals carry more information about a daily rate, so duration is
  // part of the weight alongside recency.
  const recent = intervals.map((interval) => ({
    value: interval.km / interval.days,
    weight: interval.days * recencyWeight(interval.ageDays, TRAVEL_HALF_LIFE_DAYS),
  }));
  const lifetime = intervals.map((interval) => ({
    value: interval.km / interval.days,
    weight:
      interval.days * recencyWeight(interval.ageDays, TRAVEL_BASELINE_HALF_LIFE_DAYS),
  }));

  const recentRate = weightedMean(recent);
  const baselineRate = weightedMean(lifetime);
  if (recentRate === null || baselineRate === null) {
    return { kmPerDay: null, sd: null, recentMass: 0 };
  }

  const recentMass = recent.reduce((sum, item) => sum + item.weight, 0) / 30;
  const kmPerDay =
    (recentMass * recentRate + TRAVEL_SHRINKAGE_STRENGTH * baselineRate) /
    (recentMass + TRAVEL_SHRINKAGE_STRENGTH);

  const spread = weightedStdDev(lifetime) ?? 0;
  return {
    kmPerDay,
    sd: Math.max(spread, kmPerDay * MIN_TRAVEL_RELATIVE_SD),
    recentMass,
  };
}

/**
 * Whether per-weekday rates are separable from these observation windows.
 *
 * If every interval spans the same slice of the week — a person who always
 * refuels on Sunday morning, say — then the seven daily rates are not
 * identifiable from the data, no matter how many intervals there are. Fitting
 * anyway would produce a confident weekly schedule invented by the regulariser.
 */
export function isDayOfWeekIdentifiable(intervals: readonly TravelInterval[]): boolean {
  if (intervals.length < DOW_MIN_INTERVALS) return false;

  const shares = intervals.map((interval) => {
    const total = interval.exposures.reduce((sum, value) => sum + value, 0);
    return total > 0 ? interval.exposures.map((value) => value / total) : interval.exposures;
  });

  let variedDays = 0;
  for (let day = 0; day < 7; day += 1) {
    const column = shares.map((share) => share[day]);
    const mean = column.reduce((sum, value) => sum + value, 0) / column.length;
    const variance =
      column.reduce((sum, value) => sum + (value - mean) ** 2, 0) / column.length;
    if (Math.sqrt(variance) >= DOW_MIN_SHARE_SPREAD) variedDays += 1;
  }
  return variedDays >= DOW_MIN_VARIED_DAYS;
}

/**
 * Fit seven non-negative daily rates.
 *
 *   minimise  Σⱼ wⱼ (kmⱼ − Σ_d Eⱼ_d r_d)²  +  λ Σ_d (r_d − base)²
 *   subject to  r_d ≥ 0
 *
 * Projected coordinate descent with a bounded iteration budget — deterministic,
 * allocation-light, and no dependency. The ridge term pulls every day toward the
 * overall rate, so a weekday the data barely constrains stays at the average
 * rather than drifting to whatever fits the noise.
 */
export function fitDayOfWeek(
  intervals: readonly TravelInterval[],
  baseRate: number,
): number[] {
  const rates = new Array(7).fill(Math.max(0, baseRate));
  if (intervals.length === 0) return rates;

  const weights = intervals.map((interval) =>
    recencyWeight(interval.ageDays, TRAVEL_HALF_LIFE_DAYS),
  );
  const residuals = intervals.map((interval, j) => {
    let predicted = 0;
    for (let d = 0; d < 7; d += 1) predicted += interval.exposures[d] * rates[d];
    return intervals[j].km - predicted;
  });

  for (let iteration = 0; iteration < DOW_MAX_ITERATIONS; iteration += 1) {
    let maxChange = 0;

    for (let d = 0; d < 7; d += 1) {
      let numerator = DOW_LAMBDA * baseRate;
      let denominator = DOW_LAMBDA;

      for (let j = 0; j < intervals.length; j += 1) {
        const exposure = intervals[j].exposures[d];
        if (exposure <= 0) continue;
        // Residual with this day's own contribution added back in.
        numerator += weights[j] * exposure * (residuals[j] + exposure * rates[d]);
        denominator += weights[j] * exposure * exposure;
      }

      const next = denominator > 0 ? Math.max(0, numerator / denominator) : rates[d];
      const delta = next - rates[d];
      if (delta !== 0) {
        for (let j = 0; j < intervals.length; j += 1) {
          const exposure = intervals[j].exposures[d];
          if (exposure > 0) residuals[j] -= exposure * delta;
        }
        rates[d] = next;
        maxChange = Math.max(maxChange, Math.abs(delta));
      }
    }

    if (maxChange < DOW_CONVERGENCE) break;
  }

  return rates;
}

/** Weighted mean absolute error of a prediction over held-out intervals. */
function weightedMae(
  intervals: readonly TravelInterval[],
  predict: (interval: TravelInterval) => number,
): number | null {
  let error = 0;
  let weight = 0;
  for (const interval of intervals) {
    const w = interval.days;
    error += w * Math.abs(interval.km - predict(interval));
    weight += w;
  }
  return weight > 0 ? error / weight : null;
}

/**
 * The travel estimate for one vehicle.
 *
 * Rung C is reached only when three independent gates pass: enough intervals,
 * an identifiable design, and a genuine out-of-time improvement over rung B.
 * With little history the simpler model wins, and that is a correct result.
 */
export function estimateMobility(
  fillups: readonly Fillup[],
  observations: readonly TankObservation[],
  now: number,
  timeZone: string,
): MobilityEstimate {
  const intervals = buildTravelIntervals(fillups, observations, now, timeZone);
  if (intervals.length < TRAVEL_MIN_INTERVALS) {
    return { ...NONE, intervalCount: intervals.length };
  }

  const scalar = scalarRate(intervals);
  if (scalar.kmPerDay === null || !(scalar.kmPerDay > 0)) {
    return { ...NONE, intervalCount: intervals.length };
  }

  const base: MobilityEstimate = {
    kmPerDay: scalar.kmPerDay,
    sd: scalar.sd,
    rung: scalar.recentMass > 0 ? "recencyAdaptive" : "robustAverage",
    kmPerWeekday: null,
    intervalCount: intervals.length,
    identifiable: false,
    improvement: null,
  };

  const identifiable = isDayOfWeekIdentifiable(intervals);
  if (!identifiable) return base;

  // Chronological hold-out. A random split would let a later interval inform a
  // prediction about an earlier one, which is not a situation that ever occurs.
  const ordered = [...intervals].sort((a, b) => a.to - b.to);
  const cut = Math.floor(ordered.length * (1 - DOW_HOLDOUT_FRACTION));
  const train = ordered.slice(0, cut);
  const holdout = ordered.slice(cut);
  if (train.length < TRAVEL_MIN_INTERVALS || holdout.length === 0) {
    return { ...base, identifiable };
  }

  const trainScalar = scalarRate(train);
  if (trainScalar.kmPerDay === null) return { ...base, identifiable };

  const trainRates = fitDayOfWeek(train, trainScalar.kmPerDay);
  const maeB = weightedMae(holdout, (interval) => trainScalar.kmPerDay! * interval.days);
  const maeC = weightedMae(holdout, (interval) => {
    let predicted = 0;
    for (let d = 0; d < 7; d += 1) predicted += interval.exposures[d] * trainRates[d];
    return predicted;
  });

  if (maeB === null || maeC === null || maeB <= 0) return { ...base, identifiable };
  const improvement = (maeB - maeC) / maeB;
  if (improvement < DOW_MIN_IMPROVEMENT) {
    return { ...base, identifiable, improvement };
  }

  // Refit on everything now that the shape has earned its place.
  const rates = fitDayOfWeek(intervals, scalar.kmPerDay);
  const weeklyMean = rates.reduce((sum, rate) => sum + rate, 0) / 7;

  return {
    kmPerDay: weeklyMean,
    sd: scalar.sd,
    rung: "dayOfWeek",
    kmPerWeekday: rates,
    intervalCount: intervals.length,
    identifiable: true,
    improvement,
  };
}

/** Expected distance on one local calendar day, given the fitted model. */
export function expectedKmOnWeekday(
  estimate: MobilityEstimate,
  weekday: number,
): number | null {
  if (estimate.kmPerWeekday) return estimate.kmPerWeekday[weekday] ?? estimate.kmPerDay;
  return estimate.kmPerDay;
}
