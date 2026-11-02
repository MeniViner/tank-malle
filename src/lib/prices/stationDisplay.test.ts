import { describe, expect, it } from "vitest";
import { resolveStationPrice, stationPriceView } from "./resolver";
import { adaptLegacyConfig } from "./regulated";
import type { StationPriceAggregate } from "./types";

/**
 * What a station ROW is allowed to say.
 *
 * Two failure modes, both real. Printing "עד ₪8.25 · מחיר מרבי מפוקח · אין
 * דיווח עדכני מהתחנה" on every station buried the rows that did have real
 * information; printing "מחיר לא זמין" instead gave the driver nothing at all.
 * So a row always carries a figure, and the label — three words at most — says
 * which kind it is: a station report, the driver's own receipt, or the
 * nationwide ceiling.
 */

const NOW = Date.UTC(2026, 8, 2, 12, 0);
const HOUR = 3_600_000;

/** A regulated 95 self-service figure, which is all this deployment has. */
const regulated = adaptLegacyConfig({
  current: { pricePerLiter: 8.25, updatedAt: NOW - 5 * 24 * HOUR },
  history: {},
});

function view(
  fuelType: "95" | "98" | "diesel",
  options: {
    aggregates?: StationPriceAggregate[];
    personal?: { price: number; observedAt: number } | null;
  } = {},
) {
  const resolved = resolveStationPrice({
    stationId: "1234",
    fuelType,
    aggregates: options.aggregates ?? [],
    regulated,
    now: NOW,
  });
  return stationPriceView(resolved, options.personal ?? null, NOW);
}

describe("station row price", () => {
  it("shows the national ceiling as a labelled reference, never as this station's price", () => {
    const result = view("95");
    expect(result.kind).toBe("reference");
    // "עד" is doing the work: this is a ceiling, not what the pump charges.
    expect(result.text).toBe("עד ₪8.25");
    expect(result.detail).toBe("מחיר ארצי");
    expect(result.detail).not.toContain("מחיר מרבי מפוקח");
  });

  it("shows a real station-specific price with its freshness", () => {
    const result = view("95", {
      aggregates: [
        {
          stationId: "1234",
          fuelType: "95",
          serviceMode: "self",
          medianPrice: 8.09,
          acceptedReports: 6,
          uniqueReporters: 4,
          lastVerifiedAt: NOW - 2 * HOUR,
          spread: 0.03,
        },
      ],
    });
    expect(result.kind).toBe("station");
    expect(result.text).toBe("₪8.09");
    expect(result.detail).toContain("לפני שעתיים");
    expect(result.stale).toBe(false);
  });

  it("labels the user's own last pump price as exactly that", () => {
    const result = view("95", { personal: { price: 8.02, observedAt: NOW - 3 * 24 * HOUR } });
    expect(result.kind).toBe("personal");
    // The label says whose number it is; it is a receipt, not a claim about
    // what the pump charges right now.
    expect(result.detail).toContain("שילמת כאן");
    expect(result.detail).toContain("לפני 3 ימים");
    expect(result.text).toBe("₪8.02");
  });

  it("prefers a real station price over the user's own history", () => {
    const result = view("95", {
      aggregates: [
        {
          stationId: "1234",
          fuelType: "95",
          serviceMode: "self",
          medianPrice: 8.09,
          acceptedReports: 6,
          uniqueReporters: 4,
          lastVerifiedAt: NOW - 2 * HOUR,
          spread: 0.03,
        },
      ],
      personal: { price: 8.02, observedAt: NOW - 3 * 24 * HOUR },
    });
    expect(result.kind).toBe("station");
    expect(result.text).toBe("₪8.09");
  });

  it("never falls back to the 95 figure for diesel or 98", () => {
    for (const fuelType of ["diesel", "98"] as const) {
      const result = view(fuelType);
      expect(result.text).toBe("");
      expect(result.detail).toBe("אין מחיר לסוג הדלק");
      expect(result.detail).not.toContain("8.25");
    }
  });

  it("respects the fuel type when an aggregate exists for a different one", () => {
    const petrolAggregate: StationPriceAggregate = {
      stationId: "1234",
      fuelType: "95",
      serviceMode: "self",
      medianPrice: 8.09,
      acceptedReports: 6,
      uniqueReporters: 4,
      lastVerifiedAt: NOW - 2 * HOUR,
      spread: 0.03,
    };
    const result = view("diesel", { aggregates: [petrolAggregate] });
    expect(result.kind).toBe("none");
    expect(result.text).toBe("");
  });

  it("marks an old station price rather than hiding it", () => {
    const result = view("95", {
      aggregates: [
        {
          stationId: "1234",
          fuelType: "95",
          serviceMode: "self",
          medianPrice: 8.09,
          acceptedReports: 6,
          uniqueReporters: 4,
          lastVerifiedAt: NOW - 40 * 24 * HOUR,
          spread: 0.03,
        },
      ],
    });
    expect(result.kind).toBe("station");
    expect(result.stale).toBe(true);
  });
});
