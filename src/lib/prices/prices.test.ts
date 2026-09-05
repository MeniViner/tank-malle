import { describe, expect, it } from "vitest";
import {
  adaptLegacyConfig,
  hasRegulatedPrice,
  normalizePriceDocument,
  regulatedFreshnessText,
  regulatedMaxPrice,
  type RegulatedPriceConfig,
} from "./regulated";
import { applyPersonalRule, priceDisplay, resolveStationPrice } from "./resolver";
import { isPlausiblePrice, type StationPriceAggregate } from "./types";

const NOW = new Date(2026, 7, 20, 12, 0).getTime();
const DAY = 86_400_000;

/** The legacy document shape: one price, one history, no fuel dimension. */
const LEGACY = {
  current: { pricePerLiter: 7.31, updatedAt: NOW - 2 * DAY },
  history: { "2026-07": 7.12, "2026-08": 7.31 },
};

/* ------------------------------------------------------------------ *
 * The regulated maximum is one product, not "the price"
 * ------------------------------------------------------------------ */

describe("regulated maximum", () => {
  const config = adaptLegacyConfig(LEGACY);

  it("reads the legacy document as 95 self-service and nothing else", () => {
    expect(regulatedMaxPrice(config, "95", NOW).price).toBe(7.31);
    expect(hasRegulatedPrice(config, "95")).toBe(true);
  });

  it("returns unknown for diesel rather than the 95 figure", () => {
    // The bug this whole module exists to make impossible.
    expect(regulatedMaxPrice(config, "diesel", NOW).price).toBeNull();
    expect(hasRegulatedPrice(config, "diesel")).toBe(false);
  });

  it("returns unknown for 98 rather than the 95 figure", () => {
    expect(regulatedMaxPrice(config, "98", NOW).price).toBeNull();
  });

  it("returns unknown for full service rather than the self-service figure", () => {
    expect(regulatedMaxPrice(config, "95", NOW, "full").price).toBeNull();
  });

  it("prefers the month's own record over the carried-forward current price", () => {
    const july = new Date(2026, 6, 15).getTime();
    const lookup = regulatedMaxPrice(config, "95", july);
    expect(lookup.price).toBe(7.12);
    expect(lookup.fromHistory).toBe(true);
  });

  it("says so when it fell back to the latest known price", () => {
    const may = new Date(2026, 4, 15).getTime();
    const lookup = regulatedMaxPrice(config, "95", may);
    expect(lookup.price).toBe(7.31);
    expect(lookup.fromHistory).toBe(false);
  });

  it("keeps a fuel-type-aware entry when adapting, never overwriting it", () => {
    const mixed: RegulatedPriceConfig = {
      ...LEGACY,
      byFuelType: {
        "95": { self: { history: { "2026-08": 7.4 }, current: { pricePerLiter: 7.4 } } },
        diesel: { self: { history: { "2026-08": 6.5 }, current: { pricePerLiter: 6.5 } } },
      },
    };
    const adapted = adaptLegacyConfig(mixed);
    expect(regulatedMaxPrice(adapted, "95", NOW).price).toBe(7.4);
    // A real diesel figure IS used once one exists.
    expect(regulatedMaxPrice(adapted, "diesel", NOW).price).toBe(6.5);
  });

  it("reports freshness honestly rather than promising an update", () => {
    const stale = adaptLegacyConfig({
      current: { pricePerLiter: 7.31, updatedAt: new Date(2026, 5, 1).getTime() },
      history: {},
    });
    expect(regulatedFreshnessText(regulatedMaxPrice(stale, "95", NOW), NOW)).toBe(
      "המחיר לא עודכן החודש",
    );
    expect(regulatedFreshnessText(regulatedMaxPrice(config, "95", NOW), NOW)).toBe(
      "המחיר עודכן ידנית",
    );
    expect(regulatedFreshnessText(regulatedMaxPrice(config, "diesel", NOW), NOW)).toBe(
      "טרם הוזן מחיר מרבי מפוקח",
    );
  });
});

/* ------------------------------------------------------------------ *
 * Resolver precedence
 * ------------------------------------------------------------------ */

function aggregate(over: Partial<StationPriceAggregate> = {}): StationPriceAggregate {
  return {
    stationId: "st-1",
    fuelType: "95",
    serviceMode: "self",
    medianPrice: 7.18,
    acceptedReports: 4,
    uniqueReporters: 4,
    lastVerifiedAt: NOW - 42 * 60_000,
    spread: 0.04,
    ...over,
  };
}

describe("station price resolver", () => {
  const regulated = adaptLegacyConfig(LEGACY);

  it("prefers a fresh, corroborated aggregate", () => {
    const resolved = resolveStationPrice({
      stationId: "st-1",
      fuelType: "95",
      aggregates: [aggregate()],
      regulated,
      now: NOW,
    });
    expect(resolved.source).toBe("station-posted-aggregate");
    expect(resolved.price).toBe(7.18);
    expect(resolved.confidence).toBe("high");
    expect(resolved.isCeiling).toBe(false);
    expect(resolved.explanation).toContain("42 דקות");
    expect(resolved.explanation).toContain("4 דיווחים");
  });

  it("never shows a 95 aggregate to a diesel vehicle", () => {
    const resolved = resolveStationPrice({
      stationId: "st-1",
      fuelType: "diesel",
      aggregates: [aggregate({ fuelType: "95" })],
      regulated,
      now: NOW,
    });
    expect(resolved.price).toBeNull();
    expect(resolved.source).toBe("unknown");
    expect(resolved.explanation).toBe("מחיר סולר לא ידוע");
  });

  it("never shows a 95 aggregate to a 98 vehicle", () => {
    const resolved = resolveStationPrice({
      stationId: "st-1",
      fuelType: "98",
      aggregates: [aggregate({ fuelType: "95" })],
      regulated,
      now: NOW,
    });
    expect(resolved.price).toBeNull();
    expect(resolved.explanation).toBe("מחיר בנזין 98 לא ידוע");
  });

  it("does not use another station's aggregate", () => {
    const resolved = resolveStationPrice({
      stationId: "st-2",
      fuelType: "95",
      aggregates: [aggregate({ stationId: "st-1" })],
      now: NOW,
    });
    expect(resolved.source).toBe("unknown");
  });

  it("marks a single uncorroborated report as low confidence", () => {
    const resolved = resolveStationPrice({
      stationId: "st-1",
      fuelType: "95",
      singleReport: {
        price: 7.2,
        observedAt: NOW - 2 * 3600_000,
        stationId: "st-1",
        fuelType: "95",
      },
      now: NOW,
    });
    expect(resolved.source).toBe("station-posted-single");
    expect(resolved.confidence).toBe("low");
    expect(resolved.explanation).toContain("לא אומת");
  });

  it("lowers confidence when the reporters disagree", () => {
    const resolved = resolveStationPrice({
      stationId: "st-1",
      fuelType: "95",
      aggregates: [aggregate({ spread: 0.9 })],
      now: NOW,
    });
    expect(resolved.confidence).not.toBe("high");
  });

  it("lowers confidence when too few distinct people reported", () => {
    const resolved = resolveStationPrice({
      stationId: "st-1",
      fuelType: "95",
      aggregates: [aggregate({ uniqueReporters: 1, acceptedReports: 5 })],
      now: NOW,
    });
    expect(resolved.confidence).not.toBe("high");
  });

  it("marks an ageing aggregate as possibly changed instead of hiding it", () => {
    const resolved = resolveStationPrice({
      stationId: "st-1",
      fuelType: "95",
      aggregates: [aggregate({ lastVerifiedAt: NOW - 8 * DAY })],
      regulated,
      now: NOW,
    });
    expect(resolved.freshness).toBe("aging");
    expect(resolved.explanation).toContain("ייתכן שהמחיר השתנה");
  });

  it("ignores a suppressed aggregate entirely", () => {
    const resolved = resolveStationPrice({
      stationId: "st-1",
      fuelType: "95",
      aggregates: [aggregate({ moderation: "suppressed" })],
      now: NOW,
    });
    expect(resolved.source).toBe("unknown");
  });

  it("rejects an implausible price before it can be shown", () => {
    const resolved = resolveStationPrice({
      stationId: "st-1",
      fuelType: "95",
      aggregates: [aggregate({ medianPrice: 71.8 })],
      now: NOW,
    });
    expect(resolved.source).toBe("unknown");
    expect(isPlausiblePrice("95", 71.8)).toBe(false);
    expect(isPlausiblePrice("95", 7.18)).toBe(true);
  });

  it("falls back to the regulated ceiling and labels it as a ceiling", () => {
    const resolved = resolveStationPrice({
      stationId: "st-1",
      fuelType: "95",
      regulated,
      now: NOW,
    });
    expect(resolved.source).toBe("regulated-max");
    expect(resolved.isCeiling).toBe(true);
    expect(resolved.explanation).toContain("מחיר מרבי מפוקח");
    expect(resolved.explanation).toContain("אין דיווח עדכני");
  });

  it("does not blend sources — one wins and the result says which", () => {
    const resolved = resolveStationPrice({
      stationId: "st-1",
      fuelType: "95",
      aggregates: [aggregate()],
      externalPrice: { price: 7.05, observedAt: NOW, providerName: "ספק" },
      regulated,
      now: NOW,
    });
    expect(resolved.price).toBe(7.18);
    expect(resolved.source).toBe("station-posted-aggregate");
  });

  it("uses a configured external provider when no community data exists", () => {
    const resolved = resolveStationPrice({
      stationId: "st-1",
      fuelType: "diesel",
      externalPrice: { price: 6.4, observedAt: NOW - 3600_000, providerName: "ספק" },
      regulated,
      now: NOW,
    });
    expect(resolved.source).toBe("external-provider");
    expect(resolved.price).toBe(6.4);
  });
});

/* ------------------------------------------------------------------ *
 * Personal rules
 * ------------------------------------------------------------------ */

describe("personal price rules", () => {
  const base = resolveStationPrice({
    stationId: "st-1",
    fuelType: "95",
    aggregates: [aggregate()],
    now: NOW,
  });

  it("applies a rule scoped to the same station and fuel type", () => {
    const { price, rule } = applyPersonalRule(
      base,
      [{ id: "r1", stationId: "st-1", fuelType: "95", discountPerLiter: 0.3 }],
      NOW,
    );
    expect(price).toBeCloseTo(6.88, 3);
    expect(rule?.id).toBe("r1");
  });

  it("ignores a rule for another station", () => {
    const { price, rule } = applyPersonalRule(
      base,
      [{ id: "r1", stationId: "st-9", fuelType: "95", discountPerLiter: 0.3 }],
      NOW,
    );
    expect(price).toBe(7.18);
    expect(rule).toBeNull();
  });

  it("ignores a rule for another fuel type", () => {
    const { rule } = applyPersonalRule(
      base,
      [{ id: "r1", stationId: "st-1", fuelType: "diesel", discountPerLiter: 0.3 }],
      NOW,
    );
    expect(rule).toBeNull();
  });

  it("ignores an expired rule instead of applying it forever", () => {
    const { rule } = applyPersonalRule(
      base,
      [
        {
          id: "r1",
          stationId: "st-1",
          fuelType: "95",
          discountPerLiter: 0.3,
          expiresAt: NOW - DAY,
        },
      ],
      NOW,
    );
    expect(rule).toBeNull();
  });

  it("does not apply a migrated legacy rule until it has been reviewed", () => {
    const legacyRule = {
      id: "legacy",
      stationId: null,
      fuelType: null,
      discountPerLiter: 0.25,
      legacy: true,
    };

    // Preserved, visible, but not silently in force.
    expect(applyPersonalRule(base, [legacyRule], NOW).rule).toBeNull();
    expect(applyPersonalRule(base, [{ ...legacyRule, reviewed: true }], NOW).rule?.id).toBe(
      "legacy",
    );
  });

  it("never produces a negative price", () => {
    const { price } = applyPersonalRule(
      base,
      [{ id: "r1", stationId: "st-1", fuelType: "95", discountPerLiter: 99 }],
      NOW,
    );
    expect(price).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Presentation
 * ------------------------------------------------------------------ */

describe("price display", () => {
  it("renders a ceiling as an upper bound, not as the price", () => {
    const ceiling = resolveStationPrice({
      stationId: "st-1",
      fuelType: "95",
      regulated: adaptLegacyConfig(LEGACY),
      now: NOW,
    });
    expect(priceDisplay(ceiling).text).toBe("עד ₪7.31");
  });

  it("renders an observed price as the price", () => {
    const observed = resolveStationPrice({
      stationId: "st-1",
      fuelType: "95",
      aggregates: [aggregate()],
      now: NOW,
    });
    expect(priceDisplay(observed).text).toBe("₪7.18 לליטר");
  });

  it("renders an unknown as an unknown, with the reason", () => {
    const none = resolveStationPrice({ stationId: "st-1", fuelType: "diesel", now: NOW });
    expect(priceDisplay(none).text).toBe("—");
    expect(priceDisplay(none).detail).toBe("מחיר סולר לא ידוע");
  });
});

/**
 * Reading the stored document.
 *
 * Two bugs lived here at once: Firestore Timestamps were handed to code that
 * does date arithmetic (printing "NaN" as a date), and the app's listener
 * copied only the legacy top-level fields — so a per-fuel price an admin had
 * entered reached nobody.
 */
describe("normalizePriceDocument", () => {
  const timestamp = (millis: number) => ({
    seconds: Math.floor(millis / 1000),
    nanoseconds: 0,
    toMillis: () => millis,
  });

  it("turns every timestamp into epoch milliseconds", () => {
    const config = normalizePriceDocument({
      byFuelType: {
        "95": {
          self: {
            current: {
              pricePerLiter: 8.25,
              effectiveFrom: timestamp(NOW - 10 * 86_400_000),
              updatedAt: timestamp(NOW - 3 * 86_400_000),
            },
            history: { "2026-08": 8.25 },
            source: "scheduled",
          },
        },
      },
    });

    const lookup = regulatedMaxPrice(config, "95", NOW);
    expect(lookup.price).toBe(8.25);
    expect(lookup.updatedAt).toBe(NOW - 3 * 86_400_000);
    expect(Number.isNaN(Number(lookup.updatedAt))).toBe(false);
  });

  it("keeps the per-fuel series, not only the legacy fields", () => {
    const config = normalizePriceDocument({
      current: { pricePerLiter: 8.25, updatedAt: timestamp(NOW) },
      history: { "2026-08": 8.25 },
      byFuelType: {
        diesel: {
          self: {
            current: { pricePerLiter: 7.4, updatedAt: timestamp(NOW) },
            history: {},
            source: "manual",
          },
        },
      },
    });

    expect(regulatedMaxPrice(config, "diesel", NOW).price).toBe(7.4);
    // And still no cross-fuel fallback in either direction.
    expect(regulatedMaxPrice(config, "98", NOW).price).toBeNull();
  });

  it("survives a document that is missing, empty or malformed", () => {
    expect(normalizePriceDocument(undefined).byFuelType).toEqual({});
    expect(normalizePriceDocument({}).byFuelType).toEqual({});
    expect(
      regulatedMaxPrice(normalizePriceDocument({ byFuelType: { "95": { self: {} } } }), "95", NOW)
        .price,
    ).toBeNull();
  });
});
