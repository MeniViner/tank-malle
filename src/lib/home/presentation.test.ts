import { describe, expect, it } from "vitest";
import { consumptionComparison } from "../consumptionPresentation";
import { EMPTY_CARE, type MaintenancePlan } from "../maintenance/model";
import type { RegulatedPriceConfig } from "../prices/regulated";
import { computeStats, type Fillup, type Vehicle } from "../stats";
import { TANK_SCHEMA_VERSION } from "../tank/config";
import { buildLedger } from "../vehicle/derived";
import { EMPTY_EXTRA } from "../vehicle/model";
import { vehicleDocumentOccurrences, vehicleDocumentSpotlights } from "../vehicle/documentNotifications";
import { averageMonthlyFuel, officialPriceHistory, segmentContributors } from "./presentation";
import { deriveSpotlight, readSpotlightDismissals, visibleSpotlight, type SpotlightInput } from "./spotlight";

const vehicle: Vehicle = { id: "car", make: "מאזדה", model: "3", fuelType: "95", tankLiters: 50, tankLitersSource: "user", priceAdjustment: 0, archived: false };
const now = +new Date("2026-11-03T12:00:00");
const fill = (id: string, day: number, odometer: number, liters = 40, full = true): Fillup => ({
  id, date: +new Date(2026, 9, day, 12), odometer, liters, totalCost: liters * 7, pricePerLiter: 7,
  isFullTank: full, fillEndState: full ? "full" : "partial", fillEndStateSource: "user-confirmed", tankSchemaVersion: TANK_SCHEMA_VERSION,
});
const fills = [fill("a", 1, 100000), fill("b", 8, 100400), fill("c", 15, 100900), fill("d", 22, 101500)];
const prices: RegulatedPriceConfig = { byFuelType: { "95": { self: {
  source: "scheduled", history: { "2026-10": 7, "2026-11": 8 },
  current: { pricePerLiter: 8, effectiveFrom: +new Date("2026-11-01T00:00:00") },
} } } };
const plan: MaintenancePlan = { id: "oil", schemaVersion: 1, version: 1, title: "שמן ומסננים", job: "oil", dueDay: null, dueOdometer: 101800,
  intervalKm: 10000, intervalMonths: null, basis: "completion", source: "owner", notes: "", active: true };
const ledger = (source = fills) => buildLedger(source, [], EMPTY_CARE, EMPTY_EXTRA);
const input = (patch: Partial<SpotlightInput> = {}): SpotlightInput => ({
  now, today: "2026-11-03", vehicle, units: "kmPerLiter", stats: computeStats(fills, vehicle), ledger: ledger(),
  outbox: [], storageUnknown: false, reminders: [], mileage: null, prices, ...patch,
});

describe("Home presentation preserves source meaning", () => {
  it("finds missing segment costs by canonical contributors, excluding the opening tank", () => {
    const source = [{ ...fill("base", 10, 100000), totalCostUnknown: true }, fill("partial", 9, 100100, 20, false), fill("end", 11, 100600)];
    const stats = computeStats(source, vehicle);
    expect(stats.lastSegment).not.toBeNull();
    const result = segmentContributors(stats.lastSegment!, stats.fillups);
    expect(result.fills.map(row => row.id)).toEqual(["partial", "end"]);
    expect(result.costKnown).toBe(true);
    expect(segmentContributors(stats.lastSegment!, stats.fillups.map(row => row.id === "partial" ? { ...row, totalCostUnknown: true } : row)).costKnown).toBe(false);
    expect(segmentContributors(stats.lastSegment!, stats.fillups.filter(row => row.id !== "end")).costKnown).toBe(false);
  });

  it("uses fuel-only recorded calendar months and retains the distinction between zero and missing", () => {
    const service = { id: "service", schemaVersion: 1 as const, version: 1, day: "2026-11-01", title: "טיפול", jobs: ["oil" as const], odometer: null, costAgorot: 50000, garage: "", notes: "", completedPlanIds: [] };
    const rows = buildLedger(fills, [], { ...EMPTY_CARE, serviceEvents: [service] }, EMPTY_EXTRA);
    expect(averageMonthlyFuel(rows, "2026-11-03")).toBe(560);
    expect(averageMonthlyFuel(rows.map(row => row.id === "b" ? { ...row, amountAgorot: null } : row), "2026-11-03")).toBeNull();
    expect(averageMonthlyFuel([], "2026-11-03")).toBeNull();
    expect(averageMonthlyFuel(ledger([fill("zero", 3, 100000, 0)]), "2026-11-03")).toBe(0);
    expect(averageMonthlyFuel(ledger(), "2026-09-30")).toBeNull();
  });

  it("draws only genuine regulated month evidence, not a current carry-forward or manual override", () => {
    const source: RegulatedPriceConfig = { byFuelType: { "95": { self: { ...prices.byFuelType!["95"]!.self!,
      history: { "2026-09": 6, "2026-10": 7, "2026-11": 8 }, manualOverride: { month: "2026-09", pricePerLiter: 6.5, setAt: now },
    } } } };
    expect(officialPriceHistory(source, now).map(point => [point.month, point.value])).toEqual([["2026-10", 7], ["2026-11", 8]]);
    expect(officialPriceHistory({ byFuelType: { "95": { self: { history: {}, source: "scheduled", current: { pricePerLiter: 8 } } } } }, now)).toEqual([]);
    expect(officialPriceHistory(null, now)).toEqual([]);
  });

  it.each([
    { boundary: "summer", previousMonth: "2026-07", month: "2026-08",
      previousStart: "2026-06-30T21:00:00Z", monthStart: "2026-07-31T21:00:00Z",
      previousPoint: "2026-07-01T09:00:00Z", point: "2026-08-01T09:00:00Z" },
    { boundary: "winter after DST ends", previousMonth: "2026-10", month: "2026-11",
      previousStart: "2026-09-30T21:00:00Z", monthStart: "2026-10-31T22:00:00Z",
      previousPoint: "2026-10-01T09:00:00Z", point: "2026-11-01T10:00:00Z" },
    { boundary: "year", previousMonth: "2026-12", month: "2027-01",
      previousStart: "2026-11-30T22:00:00Z", monthStart: "2026-12-31T22:00:00Z",
      previousPoint: "2026-12-01T10:00:00Z", point: "2027-01-01T10:00:00Z" },
  ])("keeps dated price history on both sides of the Israel $boundary boundary, independently of host time zone", ({ previousMonth, month, previousStart, monthStart, previousPoint, point }) => {
    // Fixed UTC instants make the expected Israel month independent of the runner's TZ.
    const effectiveFrom = Date.parse(monthStart);
    const source: RegulatedPriceConfig = { byFuelType: { "95": { self: {
      source: "scheduled", history: {}, timeline: { [Date.parse(previousStart)]: 7 },
      current: { pricePerLiter: 8, effectiveFrom },
    } } } };
    const previous = { month: previousMonth, at: Date.parse(previousPoint), value: 7 };
    expect(officialPriceHistory(source, effectiveFrom - 1)).toEqual([previous]);
    expect(officialPriceHistory(source, effectiveFrom)).toEqual([previous, { month, at: Date.parse(point), value: 8 }]);
  });

  it("uses one fuel/km outcome without changing the canonical measurement", () => {
    expect(consumptionComparison(10, 12)).toEqual({ tone: "worse", percent: 20 });
    expect(consumptionComparison(15, 12)).toEqual({ tone: "better", percent: 20 });
    expect(consumptionComparison(12.1, 12)?.tone).toBe("neutral");
    expect(consumptionComparison(null, 12)).toBeNull();
    expect(consumptionComparison(12, Infinity)).toBeNull();
  });
});

describe("Home spotlight priorities and private dismissals", () => {
  it("keeps document expiry after rejected writes and before mileage reminders even with incomplete history", () => {
    const withDocs = { ...vehicle, docs: { mandatory: { due: "2026-11-08", insurer: "A", cost: 0 } } };
    const candidates = deriveSpotlight(input({ vehicle: withDocs, historyComplete: false, outbox: [{ status: "failed" }],
      documents: vehicleDocumentSpotlights(vehicleDocumentOccurrences(withDocs, "2026-11-03")),
      reminders: [{ plan, due: { odometer: 101800, completed: false }, occurrence: "reminder:oil:101800:initial" }],
      mileage: { id: "d", source: "fillups", at: now, day: "2026-11-03", odometer: 101500, ambiguous: false },
    }));
    expect(candidates.map(item => item.id.split(":")[0])).toEqual(["writes-attention", "doc", "reminder", "price"]);
    expect(candidates[1]).toMatchObject({ sticky: true, target: { kind: "route", to: "/vehicle?doc=mandatory&vehicle=car" } });
  });

  it("orders real attention, reminder, best, price and month items and caps after dismissals", () => {
    const candidates = deriveSpotlight(input({ outbox: [{ status: "failed" }],
      reminders: [{ plan, due: { odometer: 101800, completed: false }, occurrence: "reminder:oil:101800:initial" }],
      mileage: { id: "d", source: "fillups", at: now, day: "2026-11-03", odometer: 101500, ambiguous: false },
    }));
    expect(candidates.map(item => item.id.split(":")[0])).toEqual(["writes-attention", "reminder", "best", "price", "month"]);
    expect(visibleSpotlight(candidates, new Set())).toHaveLength(4);
    const dismissed = new Set(candidates.slice(0, 3).map(item => item.id));
    expect(visibleSpotlight(candidates, dismissed).map(item => item.id.split(":")[0])).toEqual(["writes-attention", "price", "month"]);
    expect(candidates[0].title).not.toContain("נדחתה");
  });

  it("does not manufacture a reminder from ambiguous, stale or already completed mileage", () => {
    const reminder = { plan, due: { odometer: 101800, completed: false }, occurrence: "reminder:oil" };
    const mileage = { id: "d", source: "fillups" as const, at: now, day: "2026-11-03", odometer: 101500, ambiguous: false };
    for (const reading of [null, { ...mileage, ambiguous: true }, { ...mileage, day: "2026-09-01" }]) {
      expect(deriveSpotlight(input({ reminders: [reminder], mileage: reading })).some(item => item.id.startsWith("reminder:"))).toBe(false);
    }
    expect(deriveSpotlight(input({ reminders: [{ ...reminder, due: { ...reminder.due, completed: true } }], mileage })).some(item => item.id.startsWith("reminder:"))).toBe(false);
  });

  it("uses canonical best efficiency in both units and never celebrates an anomalous result", () => {
    const km = deriveSpotlight(input()).find(item => item.id.startsWith("best:"));
    const liters = deriveSpotlight(input({ units: "litersPer100" })).find(item => item.id.startsWith("best:"));
    expect(km?.id).toBe(liters?.id);
    expect(km?.body).toContain("15.0");
    expect(liters?.body).toContain("6.7");
    const stats = computeStats(fills, vehicle); stats.anomalies.push({ fillupId: "d", kind: "consumptionOutlier", message: "לבדיקה" });
    expect(deriveSpotlight(input({ stats })).some(item => item.id.startsWith("best:"))).toBe(false);
    expect(deriveSpotlight(input({ stats: computeStats(fills.slice(0, 3), vehicle) })).some(item => item.id.startsWith("best:"))).toBe(false);
    expect(deriveSpotlight(input({ historyComplete: false })).some(item => item.id.startsWith("best:"))).toBe(false);
  });

  it("keeps a price change fuel-specific, month-matched and separate from guessed capacity", () => {
    const change = deriveSpotlight(input()).find(item => item.id.startsWith("price:"));
    expect(change?.body).toContain("₪50");
    expect(deriveSpotlight(input({ vehicle: { ...vehicle, tankLitersSource: "estimate" } })).find(item => item.id.startsWith("price:"))?.body).not.toContain("מיכל");
    expect(deriveSpotlight(input({ vehicle: { ...vehicle, fuelType: "diesel" } })).some(item => item.id.startsWith("price:"))).toBe(false);
    expect(deriveSpotlight(input({ prices: { byFuelType: { "95": { self: { history: { "2026-11": 8 }, source: "scheduled", current: { pricePerLiter: 8, effectiveFrom: now } } } } } })).some(item => item.id.startsWith("price:"))).toBe(false);
    expect(deriveSpotlight(input({ prices: { byFuelType: { "95": { self: { history: { "2026-10": 7, "2026-11": 8 }, source: "manual" } } } } })).some(item => item.id.startsWith("price:"))).toBe(false);
  });

  it("limits month summaries to the first seven days and does not disguise missing costs", () => {
    expect(deriveSpotlight(input()).some(item => item.id === "month:2026-10")).toBe(true);
    expect(deriveSpotlight(input({ historyComplete: false })).some(item => item.id.startsWith("month:"))).toBe(false);
    expect(deriveSpotlight(input({ now: +new Date("2026-11-08T12:00:00"), today: "2026-11-08" })).some(item => item.id.startsWith("month:"))).toBe(false);
    const rows = ledger().map(row => row.id === "c" ? { ...row, amountAgorot: null } : row);
    expect(deriveSpotlight(input({ ledger: rows })).find(item => item.id.startsWith("month:"))?.body).toContain("סכום הדלק חלקי");
  });

  it("handles malformed storage and unknown outbox state without a fake count", () => {
    expect(readSpotlightDismissals("{bad")).toEqual([]);
    expect(readSpotlightDismissals('{"all":true}')).toEqual([]);
    expect(readSpotlightDismissals('["old",7,null,"new"]')).toEqual(["old", "new"]);
    const items = deriveSpotlight(input({ vehicle: null, storageUnknown: true }));
    expect(items).toHaveLength(1); expect(items[0].sticky).toBe(true); expect(items[0].title).not.toContain("0");
  });
});
