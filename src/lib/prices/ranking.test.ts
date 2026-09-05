import { describe, expect, it } from "vitest";
import {
  BEST_VALUE_UNAVAILABLE,
  bestValueBlocker,
  isStale,
  rankStations,
  type StationCandidate,
} from "./ranking";
import type { FuelType } from "../stats";
import type { Confidence, Freshness, ResolvedPrice } from "./types";

function price(
  over: Partial<ResolvedPrice> & { fuelType?: FuelType } = {},
): ResolvedPrice {
  return {
    stationId: "st",
    fuelType: "95",
    serviceMode: "self",
    price: 7,
    source: "station-posted-aggregate",
    observedAt: Date.now(),
    freshness: "fresh" as Freshness,
    confidence: "high" as Confidence,
    reportCount: 4,
    uniqueReporters: 4,
    isCeiling: false,
    explanation: "",
    ...over,
  };
}

function candidate(
  id: string,
  distanceMeters: number | null,
  resolved: Partial<ResolvedPrice> = {},
): StationCandidate {
  return {
    station: { i: id, n: `תחנה ${id}`, c: null, a: null, lat: 32, lng: 34 },
    distanceMeters,
    price: price({ stationId: id, ...resolved }),
  };
}

const ctx = { fuelType: "95" as FuelType, kmPerLiter: 12, litersToBuy: 40 };
const ids = (list: { station: { i?: string | null } }[]) => list.map((e) => e.station.i);

describe("nearest", () => {
  it("orders by distance", () => {
    const ranked = rankStations(
      [candidate("far", 8_000), candidate("near", 500), candidate("mid", 3_000)],
      "nearest",
      ctx,
    );
    expect(ids(ranked)).toEqual(["near", "mid", "far"]);
  });

  it("puts a station with no coordinates last", () => {
    const ranked = rankStations(
      [candidate("nowhere", null), candidate("near", 500)],
      "nearest",
      ctx,
    );
    expect(ids(ranked)).toEqual(["near", "nowhere"]);
  });
});

describe("cheapest", () => {
  it("orders by price", () => {
    const ranked = rankStations(
      [
        candidate("a", 1_000, { price: 7.3 }),
        candidate("b", 9_000, { price: 6.9 }),
        candidate("c", 500, { price: 7.1 }),
      ],
      "cheapest",
      ctx,
    );
    expect(ids(ranked)).toEqual(["b", "c", "a"]);
  });

  it("sorts unknown prices after every known one", () => {
    const ranked = rankStations(
      [
        candidate("unknown", 100, { price: null, source: "unknown" }),
        candidate("known", 9_000, { price: 7.4 }),
      ],
      "cheapest",
      ctx,
    );
    // "We do not know" is never a recommendation, however close it is.
    expect(ids(ranked)).toEqual(["known", "unknown"]);
  });

  it("prefers an observed price over a regulated ceiling at the same figure", () => {
    const ranked = rankStations(
      [
        candidate("ceiling", 500, { price: 7.1, isCeiling: true, source: "regulated-max" }),
        candidate("observed", 900, { price: 7.1 }),
      ],
      "cheapest",
      ctx,
    );
    expect(ids(ranked)).toEqual(["observed", "ceiling"]);
  });

  it("never ranks another fuel type into the list", () => {
    const ranked = rankStations(
      [
        candidate("petrol", 500, { price: 7.1, fuelType: "95" }),
        candidate("diesel", 100, { price: 6.2, fuelType: "diesel" }),
      ],
      "cheapest",
      ctx,
    );
    // The diesel figure is cheaper AND closer, and is still not a candidate.
    expect(ids(ranked)).toEqual(["petrol"]);
  });

  it("compares 98 only against 98", () => {
    const ranked = rankStations(
      [
        candidate("ninetyEight", 500, { price: 7.9, fuelType: "98" }),
        candidate("ninetyFive", 400, { price: 7.1, fuelType: "95" }),
      ],
      "cheapest",
      { ...ctx, fuelType: "98" },
    );
    expect(ids(ranked)).toEqual(["ninetyEight"]);
  });
});

describe("freshest", () => {
  it("prefers a fresher observation", () => {
    const ranked = rankStations(
      [
        candidate("stale", 100, { freshness: "stale", confidence: "low" }),
        candidate("fresh", 9_000, { freshness: "fresh", confidence: "high" }),
        candidate("aging", 500, { freshness: "aging", confidence: "medium" }),
      ],
      "freshest",
      ctx,
    );
    expect(ids(ranked)).toEqual(["fresh", "aging", "stale"]);
  });

  it("breaks a freshness tie on confidence, then on distinct reporters", () => {
    const ranked = rankStations(
      [
        candidate("low", 100, { confidence: "low", uniqueReporters: 1 }),
        candidate("many", 100, { confidence: "high", uniqueReporters: 9 }),
        candidate("few", 100, { confidence: "high", uniqueReporters: 3 }),
      ],
      "freshest",
      ctx,
    );
    expect(ids(ranked)).toEqual(["many", "few", "low"]);
  });

  it("marks the values a caller must render as stale", () => {
    expect(isStale(price({ freshness: "stale" }))).toBe(true);
    expect(isStale(price({ freshness: "unknown" }))).toBe(true);
    expect(isStale(price({ freshness: "fresh" }))).toBe(false);
    expect(isStale(price({ freshness: "aging" }))).toBe(false);
  });
});

describe("best value", () => {
  it("counts the fuel spent reaching the station, both ways", () => {
    // 40 L at ₪7.00 = ₪280 next door.
    // 40 L at ₪6.90 = ₪276 twelve km away, plus 24 km of driving at 12 km/L =
    // 2 L = ₪13.80, so ₪289.80. The nearer one wins despite being dearer.
    const ranked = rankStations(
      [
        candidate("far-cheap", 12_000, { price: 6.9 }),
        candidate("near-dear", 200, { price: 7.0 }),
      ],
      "bestValue",
      ctx,
    );
    expect(ids(ranked)).toEqual(["near-dear", "far-cheap"]);

    const far = ranked.find((entry) => entry.station.i === "far-cheap");
    expect(far?.detourCost).toBeCloseTo(13.8, 2);
    expect(far?.effectiveCost).toBeCloseTo(289.8, 2);
  });

  it("still prefers a genuinely worthwhile detour", () => {
    // ₪0.50 a litre over 40 L is ₪20 saved for a ₪4.60 round trip.
    const ranked = rankStations(
      [
        candidate("far-much-cheaper", 4_000, { price: 6.5 }),
        candidate("near-dear", 200, { price: 7.0 }),
      ],
      "bestValue",
      ctx,
    );
    expect(ids(ranked)).toEqual(["far-much-cheaper", "near-dear"]);
  });

  it("scales with how much is being bought", () => {
    const few = rankStations(
      [candidate("far", 6_000, { price: 6.8 }), candidate("near", 200, { price: 7.0 })],
      "bestValue",
      { ...ctx, litersToBuy: 10 },
    );
    const many = rankStations(
      [candidate("far", 6_000, { price: 6.8 }), candidate("near", 200, { price: 7.0 })],
      "bestValue",
      { ...ctx, litersToBuy: 50 },
    );
    // A ₪0.20 saving is not worth 12 km for 10 L, but is for 50 L.
    expect(ids(few)).toEqual(["near", "far"]);
    expect(ids(many)).toEqual(["far", "near"]);
  });

  it("puts a station it cannot cost last", () => {
    const ranked = rankStations(
      [
        candidate("nowhere", null, { price: 6.0 }),
        candidate("known", 3_000, { price: 7.0 }),
      ],
      "bestValue",
      ctx,
    );
    expect(ids(ranked)).toEqual(["known", "nowhere"]);
  });

  it("is unavailable, with a reason, when consumption is unknown", () => {
    const candidates = [candidate("a", 1_000), candidate("b", 2_000)];

    expect(bestValueBlocker(candidates, { ...ctx, kmPerLiter: null })).toBe(
      "no-consumption",
    );
    expect(BEST_VALUE_UNAVAILABLE["no-consumption"]).toContain("שני תדלוקים");

    // It degrades rather than inventing an order: with no consumption there is
    // no detour cost, so nothing claims to be better value than anything else.
    const ranked = rankStations(candidates, "bestValue", { ...ctx, kmPerLiter: null });
    expect(ranked.every((entry) => entry.effectiveCost === null)).toBe(true);
    expect(ids(ranked)).toEqual(["a", "b"]);
  });

  it("names the other reasons it can be unavailable", () => {
    expect(
      bestValueBlocker([candidate("a", null)], ctx),
    ).toBe("no-distance");
    expect(
      bestValueBlocker([candidate("a", 100, { price: null })], ctx),
    ).toBe("no-price");
    expect(bestValueBlocker([candidate("a", 100)], ctx)).toBeNull();
  });
});
