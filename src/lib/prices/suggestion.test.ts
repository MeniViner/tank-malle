import { describe, expect, it } from "vitest";
import {
  adaptLegacyConfig,
  describeOfficialPrice,
  normalizePriceDocument,
  officialPriceFor,
  priceMonthLabel,
  regulatedMaxPrice,
  suggestPricePerLiter,
  type RegulatedPriceConfig,
} from "./regulated";

/**
 * PRICE-01, inverted.
 *
 * Three screens used to read three different fields of `appConfig/fuelPrices`
 * and disagree: the fill-up form read the legacy top-level `current`, the
 * home card the per-fuel series, the settings screen the legacy field again.
 * An admin's diesel price reached nobody, and an admin's 95 price reached
 * only some screens. Everything now asks `suggestPricePerLiter` /
 * `officialPriceFor`, and these tests pin the answers they must agree on.
 */

const SEP = new Date(2026, 8, 15, 12).getTime();
const OCT = new Date(2026, 9, 10, 12).getTime();
const JUL = new Date(2026, 6, 10, 12).getTime();
const DAY = 86_400_000;

const PETROL = { fuelType: "95" as const, priceAdjustment: 0, manualPricePerLiter: null };
const DIESEL = { fuelType: "diesel" as const, priceAdjustment: 0, manualPricePerLiter: null };
const PETROL_98 = { fuelType: "98" as const, priceAdjustment: 0, manualPricePerLiter: null };

/** The job wrote 7.19 for September, then an admin typed 7.55 over it. */
const OVERRIDDEN: RegulatedPriceConfig = {
  byFuelType: {
    "95": {
      self: {
        history: { "2026-08": 7.31, "2026-09": 7.55 },
        scheduledHistory: { "2026-08": 7.31, "2026-09": 7.19 },
        current: { pricePerLiter: 7.55, effectiveFrom: new Date(2026, 8, 1).getTime(), updatedAt: SEP },
        source: "manual",
        manualOverride: { pricePerLiter: 7.55, month: "2026-09", setAt: SEP },
      },
    },
  },
  // The legacy fields still hold what the job wrote last.
  current: { pricePerLiter: 7.19, updatedAt: SEP - 5 * DAY },
  history: { "2026-08": 7.31, "2026-09": 7.19 },
};

describe("one answer for every screen (PRICE-01)", () => {
  it("an admin's 7.55 wins over the job's 7.19 for that month, everywhere", () => {
    const suggestion = suggestPricePerLiter(SEP, PETROL, OVERRIDDEN);
    const official = officialPriceFor(OVERRIDDEN, "95", SEP);

    expect(suggestion.price).toBe(7.55);
    expect(suggestion.source).toBe("manualConfig");
    expect(suggestion.isManual).toBe(true);
    expect(suggestion.isRegulated).toBe(false);
    expect(suggestion.fromHistory).toBe(true);
    expect(suggestion.effectiveMonth).toBe("2026-09");

    expect(official.price).toBe(7.55);
    expect(official.isManual).toBe(true);
    expect(official.isRegulated).toBe(false);
  });

  it("never labels the manual figure as the regulated maximum", () => {
    const suggestion = suggestPricePerLiter(SEP, PETROL, OVERRIDDEN);
    expect(suggestion.label).toContain("הוזן ידנית");
    expect(suggestion.label).not.toContain("מפוקח");
    expect(suggestion.label).toContain("ספטמבר");
    expect(describeOfficialPrice(officialPriceFor(OVERRIDDEN, "95", SEP), SEP)).toBe(
      "מחיר שהוזן ידנית · ספטמבר",
    );
  });

  it("the override is scoped to its month: August is still the job's figure", () => {
    const august = new Date(2026, 7, 20).getTime();
    const suggestion = suggestPricePerLiter(august, PETROL, OVERRIDDEN);
    expect(suggestion.price).toBe(7.31);
    expect(suggestion.source).toBe("regulatedMax");
    expect(suggestion.isRegulated).toBe(true);
    expect(suggestion.label).toBe("מחיר מרבי מפוקח לבנזין 95 · אוגוסט");
  });

  it("next month, once the job has written it, the scheduled value wins again", () => {
    const next: RegulatedPriceConfig = {
      byFuelType: {
        "95": {
          self: {
            ...OVERRIDDEN.byFuelType!["95"]!.self!,
            history: { "2026-08": 7.31, "2026-09": 7.55, "2026-10": 7.02 },
            scheduledHistory: { "2026-08": 7.31, "2026-09": 7.19, "2026-10": 7.02 },
            current: { pricePerLiter: 7.02, effectiveFrom: new Date(2026, 9, 1).getTime(), updatedAt: OCT },
            source: "scheduled",
          },
        },
      },
    };
    const suggestion = suggestPricePerLiter(OCT, PETROL, next);
    expect(suggestion.price).toBe(7.02);
    expect(suggestion.source).toBe("regulatedMax");
    expect(suggestion.isRegulated).toBe(true);
    // And September keeps the admin's figure for historical comparisons.
    expect(officialPriceFor(next, "95", SEP).price).toBe(7.55);
    expect(officialPriceFor(next, "95", SEP).isManual).toBe(true);
  });

  it("a stale override (older month, job did not run yet) no longer wins", () => {
    // October, no October record: the carried-forward current is 7.55, but it
    // is labelled as a carry-over from September — not as October's price.
    const suggestion = suggestPricePerLiter(OCT, PETROL, OVERRIDDEN);
    expect(suggestion.fromHistory).toBe(false);
    expect(suggestion.effectiveMonth).toBe("2026-09");
    expect(suggestion.label).toContain("האחרון הידוע");
    expect(suggestion.label).toContain("ספטמבר");
  });
});

describe("manual entries for fuel types Israel does not regulate", () => {
  const withDiesel: RegulatedPriceConfig = {
    byFuelType: {
      diesel: {
        self: {
          history: { "2026-09": 6.8 },
          current: { pricePerLiter: 6.8, effectiveFrom: new Date(2026, 8, 1).getTime(), updatedAt: SEP },
          source: "manual",
          manualOverride: { pricePerLiter: 6.8, month: "2026-09", setAt: SEP },
        },
      },
    },
  };

  it("a diesel figure an admin entered reaches the suggestion, as manual", () => {
    const suggestion = suggestPricePerLiter(SEP, DIESEL, withDiesel);
    expect(suggestion.price).toBe(6.8);
    expect(suggestion.source).toBe("manualConfig");
    expect(suggestion.isRegulated).toBe(false);
    expect(suggestion.isManual).toBe(true);
    expect(suggestion.fuelType).toBe("diesel");
    expect(suggestion.label).toContain("הוזן ידנית");
  });

  it("98 with nothing entered is unsupported, not the 95 or diesel figure", () => {
    const suggestion = suggestPricePerLiter(SEP, PETROL_98, { ...withDiesel, ...OVERRIDDEN });
    expect(suggestion.price).toBeNull();
    expect(suggestion.source).toBe("unsupportedFuelType");
    expect(suggestion.label).toContain("בנזין 98");
    expect(officialPriceFor(withDiesel, "98", SEP).price).toBeNull();
  });

  it("a diesel series written with a scheduled tag is still not 'מפוקח'", () => {
    const imported: RegulatedPriceConfig = {
      byFuelType: { diesel: { self: { history: { "2026-09": 6.5 }, source: "import" } } },
    };
    const official = officialPriceFor(imported, "diesel", SEP);
    expect(official.price).toBe(6.5);
    expect(official.isManual).toBe(false);
    expect(official.isRegulated).toBe(false);
  });
});

describe("legacy documents", () => {
  const LEGACY = {
    current: { pricePerLiter: 7.31, updatedAt: SEP - 2 * DAY },
    history: { "2026-07": 7.12, "2026-08": 7.31 },
  };

  it("a legacy-only document is read as 95 self-service, as a manual entry", () => {
    const suggestion = suggestPricePerLiter(JUL, PETROL, LEGACY);
    expect(suggestion.price).toBe(7.12);
    expect(suggestion.fromHistory).toBe(true);
    expect(suggestion.source).toBe("manualConfig");
    expect(suggestion.isRegulated).toBe(false);
    // Still nothing for diesel.
    expect(suggestPricePerLiter(JUL, DIESEL, LEGACY).source).toBe("unsupportedFuelType");
  });

  it("a legacy document the job tagged gov.il counts as the regulated figure", () => {
    const suggestion = suggestPricePerLiter(JUL, PETROL, { ...LEGACY, source: "gov.il" });
    expect(suggestion.source).toBe("regulatedMax");
    expect(suggestion.isRegulated).toBe(true);
  });

  it("applies a personal legacy adjustment on top and says so", () => {
    const suggestion = suggestPricePerLiter(
      JUL,
      { ...PETROL, priceAdjustment: -0.2 },
      { ...LEGACY, source: "gov.il" },
    );
    expect(suggestion.price).toBeCloseTo(6.92, 3);
    expect(suggestion.source).toBe("legacyAdjusted");
    expect(suggestion.label).toContain("התאמה קבועה");
    expect(suggestion.label).toContain("יולי");
  });

  it("a vehicle's legacy manual price replaces everything", () => {
    const suggestion = suggestPricePerLiter(JUL, { ...PETROL, manualPricePerLiter: 6.5 }, LEGACY);
    expect(suggestion.price).toBe(6.5);
    expect(suggestion.source).toBe("legacyManual");
  });

  it("falls back to the last known figure and names its month", () => {
    const suggestion = suggestPricePerLiter(SEP, PETROL, { ...LEGACY, source: "gov.il" });
    expect(suggestion.price).toBe(7.31);
    expect(suggestion.fromHistory).toBe(false);
    expect(suggestion.effectiveMonth).toBe("2026-08");
    expect(suggestion.label).toBe("לפי המחיר המרבי המפוקח האחרון הידוע · אוגוסט");
    expect(describeOfficialPrice(officialPriceFor({ ...LEGACY, source: "gov.il" }, "95", SEP), SEP)).toBe(
      "לפי המחיר האחרון הידוע · אוגוסט",
    );
  });

  it("names the year when the month is not this year's", () => {
    expect(priceMonthLabel("2025-12", SEP)).toBe("דצמבר 2025");
    expect(priceMonthLabel("2026-09", SEP)).toBe("ספטמבר");
  });
});

describe("normalizePriceDocument reads the extended shape", () => {
  const timestamp = (ms: number) => ({ seconds: Math.floor(ms / 1000), toMillis: () => ms });

  it("reads manualOverride, scheduledHistory and automation, dates as numbers", () => {
    const config = normalizePriceDocument({
      byFuelType: {
        "95": {
          self: {
            history: { "2026-09": 7.55 },
            scheduledHistory: { "2026-09": 7.19 },
            current: { pricePerLiter: 7.55, updatedAt: timestamp(SEP) },
            source: "manual",
            manualOverride: { pricePerLiter: 7.55, month: "2026-09", setAt: timestamp(SEP) },
          },
        },
      },
      automation: {
        lastAttemptAt: timestamp(SEP),
        lastSuccessAt: new Date(SEP - DAY),
        lastFailureAt: timestamp(SEP),
        lastError: "no price in page",
        lastReadMonth: "2026-09",
        lastReadPrice: 7.19,
        lastVia: "proxy",
        targetProjectId: "tank-malle",
      },
    });

    const series = config.byFuelType?.["95"]?.self;
    expect(series?.manualOverride?.setAt).toBe(SEP);
    expect(series?.scheduledHistory).toEqual({ "2026-09": 7.19 });
    expect(config.automation?.lastAttemptAt).toBe(SEP);
    expect(config.automation?.lastSuccessAt).toBe(SEP - DAY);
    expect(config.automation?.lastError).toBe("no price in page");
    expect(config.automation?.lastReadPrice).toBe(7.19);
    expect(regulatedMaxPrice(config, "95", SEP).isManual).toBe(true);
  });

  it("keeps the override and scheduled history through the legacy adapter", () => {
    const adapted = adaptLegacyConfig({
      ...normalizePriceDocument({
        byFuelType: {
          "95": {
            self: {
              history: { "2026-09": 7.55 },
              scheduledHistory: { "2026-09": 7.19 },
              manualOverride: { pricePerLiter: 7.55, month: "2026-09", setAt: SEP },
            },
          },
        },
      }),
      current: { pricePerLiter: 7.19 },
      history: { "2026-09": 7.19 },
    });
    expect(regulatedMaxPrice(adapted, "95", SEP).price).toBe(7.55);
    expect(adapted.byFuelType?.["95"]?.self?.scheduledHistory?.["2026-09"]).toBe(7.19);
  });

  it("treats an explicit null override and a missing one alike", () => {
    const config = normalizePriceDocument({
      byFuelType: {
        "95": {
          self: {
            history: { "2026-09": 7.19 },
            scheduledHistory: { "2026-09": 7.19 },
            source: "scheduled",
            manualOverride: null,
          },
        },
      },
    });
    const lookup = regulatedMaxPrice(config, "95", SEP);
    expect(lookup.price).toBe(7.19);
    expect(lookup.isRegulated).toBe(true);
    expect(lookup.isManual).toBe(false);
  });

  it("a month the job wrote stays automatic even after a manual write elsewhere", () => {
    // Series source is "manual" (the September override), but August was the
    // job's record — and the scheduled history proves it.
    const august = new Date(2026, 7, 5).getTime();
    expect(regulatedMaxPrice(OVERRIDDEN, "95", august).isRegulated).toBe(true);
  });
});
