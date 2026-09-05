import { describe, expect, it } from "vitest";
import { compareToPersonalAverage } from "./efficiency";
import { consumption } from "./format";

/**
 * The bug this file exists for: the Home badge read "+4% מעל הממוצע" beside a
 * latest reading of 6.8 L/100 km and an average of 7.1 L/100 km — a figure that
 * is BELOW the average and better than it. The comparison must be a statement
 * about fuel used, identical in both display units.
 */

/** The screenshot's numbers, converted to the canonical metric. */
const LATEST_6_8_L100 = 100 / 6.8;
const AVERAGE_7_1_L100 = 100 / 7.1;

describe("compareToPersonalAverage", () => {
  it("calls a 6.8 against a 7.1 L/100 km average more economical, not 'above'", () => {
    const result = compareToPersonalAverage(LATEST_6_8_L100, AVERAGE_7_1_L100);
    expect(result?.outcome).toBe("better");
    expect(result?.percent).toBe(4);
    expect(result?.label).toBe("חסכוני ב־4%");
  });

  it("never says 'above' or 'below' the average without naming what is compared", () => {
    for (const pair of [
      [LATEST_6_8_L100, AVERAGE_7_1_L100],
      [AVERAGE_7_1_L100, LATEST_6_8_L100],
      [14, 14],
    ] as const) {
      const label = compareToPersonalAverage(pair[0], pair[1])?.label ?? "";
      expect(label).not.toContain("מעל הממוצע");
      expect(label).not.toContain("מתחת לממוצע");
    }
  });

  it("reports a worse result as higher consumption, in red-badge terms", () => {
    // 13.15 km/L against a 14.085 km/L average: ~7% more fuel per km.
    const result = compareToPersonalAverage(13.15, AVERAGE_7_1_L100);
    expect(result?.outcome).toBe("worse");
    expect(result?.percent).toBe(7);
    expect(result?.label).toBe("צריכה גבוהה ב־7%");
  });

  it("gives the SAME verdict whichever unit the screen is showing", () => {
    // The engine is fed km/L in both cases — this asserts that the number the
    // user reads flips direction while the verdict does not.
    const inKmPerLiter = consumption(LATEST_6_8_L100, "kmPerLiter");
    const inLitersPer100 = consumption(LATEST_6_8_L100, "litersPer100");
    const avgKmPerLiter = consumption(AVERAGE_7_1_L100, "kmPerLiter");
    const avgLitersPer100 = consumption(AVERAGE_7_1_L100, "litersPer100");

    // km/L: the latest reads HIGHER than the average.
    expect(Number(inKmPerLiter.value)).toBeGreaterThan(Number(avgKmPerLiter.value));
    // L/100 km: the latest reads LOWER than the average.
    expect(Number(inLitersPer100.value)).toBeLessThan(Number(avgLitersPer100.value));

    // And the verdict is one and the same.
    const verdict = compareToPersonalAverage(LATEST_6_8_L100, AVERAGE_7_1_L100);
    expect(verdict?.outcome).toBe("better");
    expect(verdict?.signedPercent).toBeLessThan(0);
  });

  it("treats a difference under half a percent as noise, not an improvement", () => {
    const result = compareToPersonalAverage(14.1, 14.09);
    expect(result?.outcome).toBe("similar");
    expect(result?.label).toBe("דומה לממוצע שלך");
  });

  it("has no opinion when either figure is missing", () => {
    expect(compareToPersonalAverage(null, 14)).toBeNull();
    expect(compareToPersonalAverage(14, null)).toBeNull();
    expect(compareToPersonalAverage(0, 14)).toBeNull();
    expect(compareToPersonalAverage(14, -3)).toBeNull();
  });
});
