import { describe, expect, it } from "vitest";
import { declaredFromCo2 } from "./vehicleSpecs";
import { computeStats, isTankCapacityTrusted, type Vehicle } from "./stats";

/**
 * Spec enrichment is only allowed to state what it actually knows.
 *
 * Two things were being passed off as retrieved vehicle data: a tank capacity
 * guessed from body type and engine size, which then fed a confident "633 ק״מ"
 * range on Home; and a CO₂-derived consumption computed with the petrol
 * constant regardless of what the car burns.
 */

const base: Vehicle = {
  id: "v1",
  make: "מאזדה",
  model: "3",
  year: 2019,
  fuelType: "95",
  priceAdjustment: 0,
  archived: false,
};

describe("declaredFromCo2", () => {
  it("recovers the certified figure for a petrol model", () => {
    // 140 g/km ÷ 2392 g/L = 5.85 L/100 km ≈ 17.1 km/L.
    expect(declaredFromCo2(140, "95")).toBeCloseTo(17.1, 1);
    expect(declaredFromCo2(140, "98")).toBeCloseTo(17.1, 1);
  });

  it("uses the diesel constant for a diesel model, not the petrol one", () => {
    const diesel = declaredFromCo2(140, "diesel");
    const petrol = declaredFromCo2(140, "95");
    expect(diesel).not.toBeNull();
    expect(diesel).not.toBeCloseTo(petrol as number, 2);
    // 140 ÷ 2640 = 5.30 L/100 km ≈ 18.9 km/L.
    expect(diesel).toBeCloseTo(18.9, 1);
  });

  it("refuses to invent a figure for a fuel type it has no constant for", () => {
    // "other" covers electric, plug-in hybrid and LPG. Quietly applying the
    // petrol constant to any of them fabricates a consumption.
    expect(declaredFromCo2(140, "other")).toBeNull();
    expect(declaredFromCo2(140, undefined as unknown as "95")).toBeNull();
  });

  it("rejects an implausible result rather than displaying it", () => {
    expect(declaredFromCo2(0, "95")).toBeNull(); // an electric model's 0 g/km
    expect(declaredFromCo2(null, "95")).toBeNull();
    expect(declaredFromCo2(5, "95")).toBeNull(); // absurdly economical
    expect(declaredFromCo2(900, "95")).toBeNull(); // absurdly thirsty
  });
});

describe("isTankCapacityTrusted", () => {
  it("accepts a capacity the user entered or a trustworthy source supplied", () => {
    expect(isTankCapacityTrusted({ tankLiters: 51, tankLitersSource: "user" })).toBe(true);
    expect(isTankCapacityTrusted({ tankLiters: 51, tankLitersSource: "trusted" })).toBe(
      true,
    );
  });

  it("rejects our own estimate and anything stored before provenance existed", () => {
    expect(isTankCapacityTrusted({ tankLiters: 50, tankLitersSource: "estimate" })).toBe(
      false,
    );
    expect(isTankCapacityTrusted({ tankLiters: 50, tankLitersSource: "legacy" })).toBe(
      false,
    );
    expect(isTankCapacityTrusted({ tankLiters: 50 })).toBe(false);
  });

  it("rejects a missing or nonsensical capacity", () => {
    expect(isTankCapacityTrusted({ tankLitersSource: "user" })).toBe(false);
    expect(isTankCapacityTrusted({ tankLiters: 0, tankLitersSource: "user" })).toBe(false);
    expect(isTankCapacityTrusted(null)).toBe(false);
  });
});

describe("estimated range", () => {
  const fillups = [
    { id: "a", date: 1, odometer: 1000, liters: 40, pricePerLiter: 7, totalCost: 280, isFullTank: true },
    { id: "b", date: 2, odometer: 1600, liters: 40, pricePerLiter: 7, totalCost: 280, isFullTank: true },
  ];

  it("is withheld while the tank capacity is a guess", () => {
    const guessed = { ...base, tankLiters: 50, tankLitersSource: "estimate" as const };
    expect(computeStats(fillups, guessed).estimatedRangeKm).toBeNull();
  });

  it("appears once the user has confirmed the capacity", () => {
    const confirmed = { ...base, tankLiters: 50, tankLitersSource: "user" as const };
    // 600 km on 40 L = 15 km/L × 50 L.
    expect(computeStats(fillups, confirmed).estimatedRangeKm).toBe(750);
  });
});
