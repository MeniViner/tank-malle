/**
 * Comparing one measurement against a personal average.
 *
 * The canonical metric is km/L, but the user may read L/100 km, where a LOWER
 * number is the better one. Wording the comparison as "above"/"below the
 * average" therefore flips meaning with the display unit: 6.8 L/100 km against
 * a 7.1 L/100 km average is BELOW the average and BETTER, while the same pair
 * in km/L is above it.
 *
 * So the comparison is computed here, once, from km/L, and expressed as an
 * OUTCOME — more economical or less — which reads identically in both units.
 */

/** Relative change in fuel burnt per km. Negative means less fuel. */
export type EfficiencyOutcome = "better" | "worse" | "similar";

export interface EfficiencyComparison {
  outcome: EfficiencyOutcome;
  /**
   * Signed % change in fuel consumed per km against the average.
   * Negative = used less fuel. Unit-independent by construction.
   */
  signedPercent: number;
  /** Magnitude of `signedPercent`, rounded for display. */
  percent: number;
  /** Hebrew label. Says what is being compared — never a bare "above average". */
  label: string;
}

/**
 * Anything under this is noise, not a result, and is reported as "similar"
 * rather than dressed up as an improvement.
 */
const SIMILAR_THRESHOLD = 0.5;

/**
 * Compare a single measurement with the personal average.
 *
 * Both arguments are km/L — the canonical metric — and the result never
 * depends on which unit the screen happens to display.
 */
export function compareToPersonalAverage(
  latestKmPerLiter: number | null | undefined,
  averageKmPerLiter: number | null | undefined,
): EfficiencyComparison | null {
  if (!latestKmPerLiter || !averageKmPerLiter) return null;
  if (latestKmPerLiter <= 0 || averageKmPerLiter <= 0) return null;

  // Litres per km is 1/kmPerLiter, so the ratio of the averages inverts.
  // signedPercent is the change in fuel burnt: below zero means less fuel.
  const signedPercent =
    Math.round((averageKmPerLiter / latestKmPerLiter - 1) * 1000) / 10;
  const percent = Math.round(Math.abs(signedPercent));

  if (Math.abs(signedPercent) < SIMILAR_THRESHOLD || percent === 0) {
    return {
      outcome: "similar",
      signedPercent,
      percent,
      label: "דומה לממוצע שלך",
    };
  }

  return signedPercent < 0
    ? {
        outcome: "better",
        signedPercent,
        percent,
        label: `פחות ${percent}% מהממוצע`,
      }
    : {
        outcome: "worse",
        signedPercent,
        percent,
        label: `גבוה ב ${percent}% מהממוצע`,
      };
}
