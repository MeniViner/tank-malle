import { describe, expect, it } from "vitest";
import type { RegulatedPriceConfig } from "../prices/regulated";
import type { Fillup, Vehicle } from "../stats";
import { paidPriceSpotlight, type PaidPriceInsightInput } from "./paidPriceInsight";

const now = Date.parse("2026-11-05T10:00:00Z");
const nov1 = Date.parse("2026-10-31T22:00:00Z");
const nov5 = Date.parse("2026-11-04T22:00:00Z");
const vehicle: Vehicle = { id: "car-1", make: "מאזדה", model: "3", fuelType: "95", priceAdjustment: 0, archived: false };
const fillup: Fillup = { id: "receipt/1", date: now - 60_000, odometer: 1000, liters: 30,
  pricePerLiter: 7.85, totalCost: 226.5, isFullTank: true,
  station: { name: "תחנה", lat: 32.1, lng: 34.9, stationId: "123" } };
const config = (): RegulatedPriceConfig => ({ byFuelType: { "95": { self: {
  history: { "2026-11": 7.85 }, timeline: { [nov1]: 7.35, [nov5]: 7.85 }, source: "scheduled",
  current: { pricePerLiter: 7.85, effectiveFrom: nov5, updatedAt: now },
} } } });
function insight(patch: Partial<PaidPriceInsightInput> = {}) {
  return paidPriceSpotlight({ now, ownerId: "owner-1", vehicle, fillups: [fillup], prices: config(), historyComplete: true, ...patch });
}

describe("paid price insight", () => {
  it("uses actual amount / litres rather than a stale editable per-litre suggestion", () => {
    const item = insight()!;
    expect(item.title).toContain("₪9");
    expect(item.body).toContain("₪7.55");
    expect(item.body).toContain("₪7.85");
    expect(item.body).toContain("בשירות עצמי מחוץ לאילת ביום התדלוק");
    expect(item.target.kind).toBe("route");
    const query = new URL(item.target.kind === "route" ? item.target.to : "", "https://example.test").searchParams;
    expect(Object.fromEntries(query)).toEqual({ entry: "fillups/receipt/1", owner: "owner-1", vehicle: "car-1" });
  });

  it("compares a fill before an intramonth increase with the earlier effective price", () => {
    const before = { ...fillup, date: Date.parse("2026-11-04T10:00:00Z"), totalCost: 211.5 };
    expect(insight({ fillups: [before] })?.body).toContain("₪7.35");
    expect(insight({ fillups: [before] })?.title).toContain("₪9");
    expect(insight({ fillups: [{ ...before, totalCost: 226.5 }] })).toBeNull();
  });

  it("does not back-project an intramonth replacement when its predecessor is unknown", () => {
    const prices = config();
    prices.byFuelType!["95"]!.self!.timeline = { [nov5]: 7.85 };
    expect(insight({ prices, fillups: [{ ...fillup, date: Date.parse("2026-11-04T10:00:00Z") }] })).toBeNull();
  });

  it("does not revive an older saving after a later fill with no saving", () => {
    const later = { ...fillup, id: "later", date: now, totalCost: 235.5 };
    expect(insight({ fillups: [later, fillup] })).toBeNull();
    expect(insight({ fillups: [fillup, later] })).toBeNull();
  });

  it.each([
    { station: null }, { station: { name: "תחנה" } },
    { station: { name: "פז אילת", lat: 32.1, lng: 34.9 } },
    { station: { name: "תחנה", lat: 29.56, lng: 34.95 } },
    { station: { name: "תחנה", lat: 32, lng: NaN } },
    { fuelType: "diesel" as const }, { fuelType: "98" as const },
    { totalCostUnknown: true }, { totalCost: 0 }, { totalCost: -1 }, { totalCost: NaN },
    { liters: 0 }, { liters: Infinity }, { date: NaN }, { date: now + 1 },
    { date: now - 8 * 86_400_000 }, { totalCost: 235.2 },
  ])("suppresses unsupported or immaterial comparisons: %j", patch => {
    expect(insight({ fillups: [{ ...fillup, ...patch }] })).toBeNull();
  });

  it("does not label manual, stale or different-region figures as the applicable official ceiling", () => {
    const manual = config();
    manual.byFuelType!["95"]!.self!.manualOverride = { pricePerLiter: 8, month: "2026-11", setAt: now };
    expect(insight({ prices: manual })).toBeNull();
    expect(insight({ prices: { ...config(), region: "eilat" } })).toBeNull();
    expect(insight({ prices: { byFuelType: { "95": { self: { source: "scheduled", history: { "2026-10": 7.77 },
      current: { pricePerLiter: 7.77, effectiveFrom: Date.parse("2026-10-01T10:00:00Z") } } } } } })).toBeNull();
  });

  it("silently hides incomplete history and missing ownership, without requesting data", () => {
    expect(insight({ historyComplete: false })).toBeNull();
    expect(insight({ ownerId: null })).toBeNull();
    expect(insight({ vehicle: null })).toBeNull();
    expect(insight({ fillups: [] })).toBeNull();
  });

  it("uses stable dismissal identity across refreshes and changes it for a material edit", () => {
    expect(insight({ now: now + 60_000 })?.id).toBe(insight()?.id);
    expect(insight({ fillups: [{ ...fillup, totalCost: 220.5 }] })?.id).not.toBe(insight()?.id);
  });
});
