/**
 * Weighted statistics and small numerical helpers.
 *
 * Deliberately plain: every function is deterministic, allocation-light and
 * total — an empty or degenerate input returns `null` rather than `NaN`, so a
 * missing estimate stays visibly missing all the way to the screen.
 */

export interface Weighted {
  value: number;
  weight: number;
}

/** Σw. */
export function totalWeight(items: readonly Weighted[]): number {
  let sum = 0;
  for (const item of items) sum += item.weight;
  return sum;
}

/**
 * Effective sample size: (Σw)² / Σw².
 *
 * Answers "how many equally-weighted observations is this worth", which is the
 * right question for a shrinkage weight and the wrong one for evidence
 * strength — many equally weak samples have a high nEffective. Pair it with an
 * unnormalised quality mass wherever that distinction matters.
 */
export function effectiveSampleSize(items: readonly Weighted[]): number {
  let sum = 0;
  let sumSquares = 0;
  for (const item of items) {
    sum += item.weight;
    sumSquares += item.weight * item.weight;
  }
  if (sumSquares <= 0) return 0;
  return (sum * sum) / sumSquares;
}

export function weightedMean(items: readonly Weighted[]): number | null {
  let sum = 0;
  let weight = 0;
  for (const item of items) {
    sum += item.value * item.weight;
    weight += item.weight;
  }
  return weight > 0 ? sum / weight : null;
}

/**
 * Weighted quantile by linear interpolation of the cumulative weight.
 *
 * `q` is clamped to [0,1]; a single observation returns itself at every
 * quantile, which is the honest answer rather than a fabricated spread.
 */
export function weightedQuantile(
  items: readonly Weighted[],
  q: number,
): number | null {
  const usable = items.filter((item) => item.weight > 0 && Number.isFinite(item.value));
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0].value;

  const sorted = [...usable].sort((a, b) => a.value - b.value);
  const total = totalWeight(sorted);
  if (total <= 0) return null;

  const target = Math.min(1, Math.max(0, q)) * total;
  let cumulative = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const next = cumulative + sorted[i].weight;
    if (next >= target) {
      // Interpolate inside the band this observation occupies.
      if (i === 0 || sorted[i].weight <= 0) return sorted[i].value;
      const previous = sorted[i - 1];
      const span = sorted[i].weight;
      const position = span > 0 ? (target - cumulative) / span : 1;
      return previous.value + (sorted[i].value - previous.value) * position;
    }
    cumulative = next;
  }
  return sorted[sorted.length - 1].value;
}

export function weightedMedian(items: readonly Weighted[]): number | null {
  return weightedQuantile(items, 0.5);
}

/** Weighted standard deviation about the weighted mean. */
export function weightedStdDev(items: readonly Weighted[]): number | null {
  const mean = weightedMean(items);
  if (mean === null) return null;

  let numerator = 0;
  let weight = 0;
  for (const item of items) {
    const delta = item.value - mean;
    numerator += item.weight * delta * delta;
    weight += item.weight;
  }
  if (weight <= 0) return null;

  // Reliability-weight correction, so a handful of samples does not report the
  // suspiciously tight spread of a population estimate.
  const nEff = effectiveSampleSize(items);
  const correction = nEff > 1 ? nEff / (nEff - 1) : 1;
  return Math.sqrt((numerator / weight) * correction);
}

/**
 * Pull an outlier back to the edge of a band instead of deleting it.
 *
 * A segment that disagrees with the model may be a mistyped odometer or it may
 * be a genuine change in how the car is being driven, and nothing available
 * here can tell those apart. Bounding the influence keeps a typo from
 * dominating without discarding a real change.
 */
export function winsorise(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** 2^(−age/halfLife). Recency weighting, documented in one place. */
export function recencyWeight(ageDays: number, halfLifeDays: number): number {
  if (!(halfLifeDays > 0)) return 1;
  return Math.pow(2, -Math.max(0, ageDays) / halfLifeDays);
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Round to a step, e.g. `roundToStep(0.2734, 0.05) === 0.25`. */
export function roundToStep(value: number, step: number): number {
  if (!(step > 0)) return value;
  return Math.round(value / step) * step;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A weighted empirical CDF, evaluated by linear interpolation.
 *
 * Used to blend a prior distribution with an observed one and then read the
 * blend's own quantiles back out — which is not the same as averaging the two
 * distributions' percentiles, and is the reason this exists rather than a pair
 * of means.
 */
export interface Distribution {
  /** Sorted ascending. */
  points: { value: number; cumulative: number }[];
}

export function distributionFromSamples(items: readonly Weighted[]): Distribution | null {
  const usable = items.filter((item) => item.weight > 0 && Number.isFinite(item.value));
  if (usable.length === 0) return null;

  const sorted = [...usable].sort((a, b) => a.value - b.value);
  const total = totalWeight(sorted);
  if (total <= 0) return null;

  // Repeated values are collapsed into one point carrying their combined
  // weight. Leaving them as separate points with the same value produces a
  // vertical run the interpolator cannot read, which is how a sample of eight
  // identical observations ends up with a median that is not that value.
  const merged: Weighted[] = [];
  for (const item of sorted) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.value - item.value) < 1e-9) last.weight += item.weight;
    else merged.push({ value: item.value, weight: item.weight });
  }

  const points: Distribution["points"] = [];
  let cumulative = 0;
  for (const item of merged) {
    // Step at the midpoint of each observation's weight band, which keeps the
    // median of a symmetric sample where it belongs.
    cumulative += item.weight;
    points.push({ value: item.value, cumulative: (cumulative - item.weight / 2) / total });
  }
  return { points };
}

/**
 * A smooth prior distribution around `centre` with half-width `spread`,
 * expressed on the same interpolated-CDF footing so the two can be mixed.
 */
export function priorDistribution(centre: number, spread: number): Distribution {
  const width = Math.max(1e-6, spread);
  return {
    points: [
      { value: centre - 2 * width, cumulative: 0.05 },
      { value: centre - width, cumulative: 0.25 },
      { value: centre, cumulative: 0.5 },
      { value: centre + width, cumulative: 0.75 },
      { value: centre + 2 * width, cumulative: 0.95 },
    ],
  };
}

/**
 * F(x) by linear interpolation.
 *
 * At a support point the point's OWN cumulative is returned, which is what
 * makes a single-observation distribution read 0.5 at its value rather than 0 —
 * the midpoint convention the sample points were built with.
 */
export function cdfAt(distribution: Distribution, x: number): number {
  const { points } = distribution;
  if (points.length === 0) return 0;

  const first = points[0];
  const last = points[points.length - 1];
  if (x < first.value) return 0;
  if (x === first.value) return first.cumulative;
  if (x > last.value) return 1;
  if (x === last.value) return last.cumulative;

  for (let i = 1; i < points.length; i += 1) {
    if (x <= points[i].value) {
      const previous = points[i - 1];
      const next = points[i];
      const span = next.value - previous.value;
      if (span <= 0) return next.cumulative;
      const t = (x - previous.value) / span;
      return previous.cumulative + t * (next.cumulative - previous.cumulative);
    }
  }
  return 1;
}

/**
 * Mix two distributions: F = (1−weight)·F_a + weight·F_b.
 *
 * The result is a distribution in its own right, so the typical value and the
 * spread are read off the MIX. Averaging `a`'s median with `b`'s median, or
 * worse averaging incompatible percentiles, is what this replaces.
 */
export function blendDistributions(
  a: Distribution,
  b: Distribution,
  weight: number,
): Distribution {
  const w = clamp(weight, 0, 1);
  const values = [...a.points.map((p) => p.value), ...b.points.map((p) => p.value)].sort(
    (x, y) => x - y,
  );
  const unique: number[] = [];
  for (const value of values) {
    if (unique.length === 0 || Math.abs(value - unique[unique.length - 1]) > 1e-9) {
      unique.push(value);
    }
  }
  return {
    points: unique.map((value) => ({
      value,
      cumulative: clamp((1 - w) * cdfAt(a, value) + w * cdfAt(b, value), 0, 1),
    })),
  };
}

/** The value x where F(x) = q. Inverse of `cdfAt`. */
export function quantileOf(distribution: Distribution, q: number): number | null {
  const { points } = distribution;
  if (points.length === 0) return null;
  if (points.length === 1) return points[0].value;

  const target = clamp(q, 0, 1);
  if (target <= points[0].cumulative) return points[0].value;
  if (target >= points[points.length - 1].cumulative) return points[points.length - 1].value;

  for (let i = 1; i < points.length; i += 1) {
    if (target <= points[i].cumulative) {
      const previous = points[i - 1];
      const next = points[i];
      const span = next.cumulative - previous.cumulative;
      if (span <= 0) return next.value;
      const t = (target - previous.cumulative) / span;
      return previous.value + t * (next.value - previous.value);
    }
  }
  return points[points.length - 1].value;
}
