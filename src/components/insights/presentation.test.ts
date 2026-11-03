import { describe, expect, it } from "vitest";
import { EMPTY_CARE, type ServiceEvent, type VehicleExpense } from "../../lib/maintenance/model";
import { buildRange } from "../../lib/periods";
import type { RegulatedPriceConfig } from "../../lib/prices/regulated";
import { computeStats, type Fillup, type Vehicle } from "../../lib/stats";
import { buildLedger } from "../../lib/vehicle/derived";
import { EMPTY_EXTRA } from "../../lib/vehicle/model";
import { consumptionNumber, consumptionPoints, consumptionRangeLabel, consumptionSummary, insightRange, insightTab, journalRangeLink, knownLedgerAmount, odometerPoints, priceSummary, spendingSummary } from "./presentation";

const at = (day: string) => +new Date(`${day}T12:00:00`);
const now = at("2026-11-03");
const vehicle: Vehicle = { id: "v", make: "מאזדה", model: "3", fuelType: "95", tankLiters: 50, tankLitersSource: "user", priceAdjustment: 0, archived: false };
const fill = (id: string, day: string, odometer: number, liters = 40, patch: Partial<Fillup> = {}): Fillup => ({
  id, date: at(day), odometer, liters, pricePerLiter: 7, totalCost: liters * 7, isFullTank: true, ...patch,
});
const service = (id: string, day: string, costAgorot: number | null): ServiceEvent => ({
  id, schemaVersion: 1, version: 1, day, title: "טיפול", jobs: ["oil"], odometer: null, costAgorot, garage: "", notes: "", completedPlanIds: [],
});
const expense = (id: string, day: string, costAgorot: number | null, category: VehicleExpense["category"] = "parking"): VehicleExpense => ({
  id, schemaVersion: 1, version: 1, day, title: "הוצאה", category, costAgorot, notes: "",
});
const month = (value = "2026-10") => insightRange(new URLSearchParams({ month: value }), now).range;

describe("Insights periods and destination contracts", () => {
  it("resolves the Home month link through inclusive local month-end and the production Journal query", () => {
    const selected = insightRange(new URLSearchParams("tab=spend&month=2026-10"), now);
    expect(selected.fromDay).toBe("2026-10-01");
    expect(selected.toDay).toBe("2026-10-31");
    expect(new Date(selected.range.to!).getHours()).toBe(23);
    expect(new Date(selected.range.to!).getMilliseconds()).toBe(999);
    expect(selected.value).toBe("selected-month");
    const url = new URL(journalRangeLink("expense", selected.fromDay, selected.toDay), "https://example.invalid");
    expect(url.pathname).toBe("/history");
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: "2026-10-01", to: "2026-10-31", kind: "expense" });
    expect(url.searchParams.has("filter")).toBe(false);
  });

  it("handles leap months and rejects malformed month links without losing a valid period", () => {
    expect(insightRange(new URLSearchParams("month=2024-02"), now).toDay).toBe("2024-02-29");
    for (const invalid of ["2026-13", "2026-00", "2026-1", "2026-10-extra", "1800-10"]) {
      const selected = insightRange(new URLSearchParams({ month: invalid, period: "3m" }), now);
      expect(selected.month).toBeNull();
      expect(selected.range.key).toBe("3m");
    }
    expect(insightRange(new URLSearchParams("period=nonsense"), now).range.key).toBe("6m");
    expect(insightTab("costs")).toBe("spend");
    expect(insightTab("prices")).toBe("price");
    expect(insightTab(null)).toBe("cons");
  });
});

describe("Insights projects canonical consumption without rebuilding it", () => {
  const source = [
    fill("opening", "2026-09-28", 1000, 45, { totalCostUnknown: true }),
    fill("partial", "2026-10-02", 1100, 10, { isFullTank: false }),
    fill("close", "2026-10-10", 1500), fill("last", "2026-10-20", 2400, 60),
  ];

  it("presents actual histogram bounds in ascending display units after reciprocal conversion", () => {
    expect(consumptionRangeLabel(10, 20, "kmPerLiter")).toBe("10.0–20.0");
    expect(consumptionRangeLabel(10, 20, "litersPer100")).toBe("5.0–10.0");
    expect(consumptionRangeLabel(8, 10, "litersPer100")).toBe("10.0–12.5");
    expect(consumptionRangeLabel(12, 12, "kmPerLiter")).toBe("12.0");
    expect(consumptionRangeLabel(0, 10, "litersPer100")).toBe("—");
  });

  it("keeps the segment whose opening full tank is outside the range and weights actual distance/litres", () => {
    const stats = computeStats(source, vehicle);
    const before = JSON.stringify(stats);
    const summary = consumptionSummary(stats, month());
    expect(summary.segments.map(segment => segment.endId)).toEqual(["close", "last"]);
    expect(summary.km).toBe(1400);
    expect(summary.liters).toBe(110);
    expect(summary.average).toBeCloseTo(1400 / 110, 10);
    expect(summary.average).not.toBe(12.5);
    expect(summary.costKnown).toBe(true);
    expect(summary.costPerKm).toBeCloseTo(770 / 1400, 10);
    expect(summary.best?.endId).toBe("last");
    expect(summary.worst?.endId).toBe("close");
    expect(JSON.stringify(stats)).toBe(before);
  });

  it("counts missing costs by contributor identity, including a backdated partial and excluding its baseline", () => {
    const backdated = [fill("opening", "2026-10-05", 1000, 30, { totalCostUnknown: true }),
      fill("partial", "2026-10-02", 1100, 10, { isFullTank: false, totalCostUnknown: true }), fill("close", "2026-10-10", 1500)];
    const summary = consumptionSummary(computeStats(backdated, vehicle), month());
    expect(summary.average).toBe(10);
    expect(summary.costKnown).toBe(false);
    expect(summary.costPerKm).toBeNull();
    expect(consumptionSummary(computeStats(backdated.map(row => row.id === "partial" ? { ...row, totalCostUnknown: false } : row), vehicle), month()).costKnown).toBe(true);
  });

  it("converts both chart values and the own-average consistently, preserving canonical best and tone", () => {
    const stats = computeStats(source, vehicle);
    const summary = consumptionSummary(stats, month());
    const km = consumptionPoints(summary, stats, "kmPerLiter");
    const liters = consumptionPoints(summary, stats, "litersPer100");
    expect(km.map(point => point.endId)).toEqual(liters.map(point => point.endId));
    expect(liters[1].value).toBeCloseTo(100 / km[1].value!, 10);
    expect(consumptionNumber(summary.average!, "litersPer100")).toBeCloseTo(110 / 1400 * 100, 10);
    expect(summary.lastTone).toBe("better");
  });

  it("keeps both boundary observations and breaks the line even when the new island starts with a partial", () => {
    const stats = computeStats([fill("a", "2026-10-01", 1000), fill("b", "2026-10-04", 1400),
      fill("break", "2026-10-06", 6000, 5, { isFullTank: false, continuityBreakBefore: true }),
      fill("c", "2026-10-09", 6100, 10), fill("d", "2026-10-13", 6600, 50)], vehicle);
    const summary = consumptionSummary(stats, month());
    const points = consumptionPoints(summary, stats, "kmPerLiter");
    expect(points.map(point => point.endId)).toEqual(["b", null, "d"]);
    expect(points.map(point => point.value)).toEqual([10, null, 10]);
    const odometer = odometerPoints(stats, month());
    expect(odometer.filter(point => point.odometer !== null).map(point => point.key)).toEqual(["a", "b", "break", "c", "d"]);
    expect(odometer.filter(point => point.odometer === null)).toHaveLength(1);
    expect(summary.km).toBe(900);
  });

  it("leaves open/empty periods unmeasured while retaining the canonical open segment", () => {
    const stats = computeStats(source.slice(0, 2), vehicle);
    const summary = consumptionSummary(stats, month());
    expect(summary.average).toBeNull();
    expect(summary.costPerKm).toBeNull();
    expect(summary.best).toBeNull();
    expect(stats.openSegment.pendingFillups).toBe(1);
    expect(stats.openSegment.liters).toBe(10);
  });
});

describe("Insights prices use actual selected receipts and historical source evidence", () => {
  const prices: RegulatedPriceConfig = { byFuelType: { "95": { self: { source: "manual", history: { "2026-10": 7.5, "2026-11": 8 },
    scheduledHistory: { "2026-10": 7.5 }, current: { pricePerLiter: 8, effectiveFrom: at("2026-11-01") } } } } };
  const priced = (id: string, day: string, odometer: number, liters: number, amount: number, stationId: string, name: string, patch: Partial<Fillup> = {}) =>
    fill(id, day, odometer, liters, { totalCost: amount, pricePerLiter: amount / liters, station: { stationId, name }, ...patch });

  it("keeps unidentified purchases in the average without presenting their placeholder as a ranked station", () => {
    const stats = computeStats([
      fill("unknown", "2026-10-01", 1000, 10, { totalCost: 10, station: { name: "לא ידוע" } }),
      fill("unknown2", "2026-10-03", 1100, 10, { totalCost: 20, station: { name: "תחנה לא ידועה" } }),
      fill("named", "2026-10-05", 1200, 10, { totalCost: 70, station: { name: "פז אשדוד" } }),
      fill("catalog", "2026-10-07", 1300, 10, { totalCost: 80, station: { stationId: "catalog-95", name: "תחנה 95" } }),
    ], vehicle);
    const summary = priceSummary(stats, vehicle, prices, month());
    expect(summary.knownCount).toBe(4);
    expect(summary.average).toBe(4.5);
    expect(summary.stations.map(station => station.name)).toEqual(["פז אשדוד", "תחנה 95"]);
    expect(summary.stations[1].key).toBe("id:catalog-95");
  });

  it("ranks the period by litres-weighted recorded cost and stable station identity, not lifetime or missing amounts", () => {
    const stats = computeStats([
      priced("old", "2026-09-01", 1000, 40, 80, "old", "זולה בעבר"),
      priced("a", "2026-10-01", 1400, 40, 288, "a", "שם ישן"), priced("a2", "2026-10-05", 1500, 10, 78, "a", "שם מעודכן"),
      priced("b", "2026-10-10", 1900, 40, 284, "b", "תחנה ב"),
      priced("unknown", "2026-10-12", 2000, 10, 0, "a", "שם מעודכן", { totalCostUnknown: true }),
      priced("diesel", "2026-10-15", 2400, 40, 40, "d", "סולר", { fuelType: "diesel" }),
    ], vehicle);
    const summary = priceSummary(stats, vehicle, prices, month());
    expect(summary.stations.map(station => station.key)).toEqual(["id:b", "id:a"]);
    expect(summary.stations[1]).toMatchObject({ name: "שם מעודכן", count: 3, knownCount: 2, unknown: 1, average: 7.32 });
    expect(summary.average).toBeCloseTo(650 / 90, 10);
    expect(summary.otherFuelCount).toBe(1);
    expect(summary.unknown).toBe(1);
    expect(summary.spread).toBeCloseTo(.22, 10);
    expect(summary.tankSpread).toBeCloseTo(11, 10);
    expect(priceSummary(stats, { ...vehicle, tankLitersSource: "estimate" }, prices, month()).tankSpread).toBeNull();
  });

  it("labels a historical scheduled figure honestly after a later manual write and does not substitute today's month", () => {
    const stats = computeStats([fill("oct", "2026-10-12", 1000), fill("nov", "2026-11-02", 1400)], vehicle);
    const summary = priceSummary(stats, vehicle, prices, buildRange("all", now));
    expect(summary.points.map(point => [point.official, point.referenceKind])).toEqual([[7.5, "regulated"], [8, "manual"]]);
    const currentOnly: RegulatedPriceConfig = { byFuelType: { "95": { self: { history: {}, source: "scheduled", current: { pricePerLiter: 9, effectiveFrom: at("2026-11-01") } } } } };
    expect(priceSummary(stats, vehicle, currentOnly, month()).points[0].official).toBeNull();
  });

  it("keeps manual, nonregulated and missing fuel-specific references distinct", () => {
    const diesel = { ...vehicle, fuelType: "diesel" as const };
    const stats = computeStats([fill("d", "2026-10-10", 1000)], diesel);
    expect(priceSummary(stats, diesel, prices, month()).points[0].official).toBeNull();
    for (const [source, expected] of [["manual", "manual"], ["scheduled", "reference"]] as const) {
      const config: RegulatedPriceConfig = { byFuelType: { diesel: { self: { history: { "2026-10": 6.5 }, source } } } };
      expect(priceSummary(stats, diesel, config, month()).points[0].referenceKind).toBe(expected);
    }
  });

  it("leaves an all-unknown paid average and ranking unavailable, while retaining a known zero", () => {
    const unknown = priced("u", "2026-10-01", 1000, 40, 0, "a", "תחנה", { totalCostUnknown: true });
    const result = priceSummary(computeStats([unknown], vehicle), vehicle, prices, month());
    expect(result.average).toBeNull();
    expect(result.points[0].paid).toBeNull();
    expect(result.stations).toHaveLength(0);
    const knownZero = priceSummary(computeStats([{ ...unknown, totalCostUnknown: false }], vehicle), vehicle, prices, month());
    expect(knownZero.average).toBe(0);
    expect(knownZero.stations[0].average).toBe(0);
  });
});

describe("Insights spending projects the full signed ledger", () => {
  it("includes fuel, service, expenses and negative refunds without treating an unknown amount as zero", () => {
    const ledger = buildLedger([fill("f", "2026-10-01", 1000, 10)], [], { ...EMPTY_CARE,
      serviceEvents: [service("s", "2026-10-02", 50000)], vehicleExpenses: [expense("e", "2026-10-03", 3000), expense("r", "2026-10-04", 15000, "refund"), expense("u", "2026-10-05", null)],
    }, EMPTY_EXTRA);
    const summary = spendingSummary(ledger, "2026-10-01", "2026-10-31");
    expect(summary.amount).toBe(45000);
    expect(summary.expenseAmount).toBe(-12000);
    expect(summary.totals.unknown).toBe(1);
    expect(summary.months[0]).toMatchObject({ fuel: 70, service: 500, other: 30, refunds: -150, total: 450, unknown: 1 });
    expect(summary.months.reduce((sum, row) => sum + (row.total ?? 0), 0) * 100).toBe(summary.amount);
  });

  it("renders expenses without any fuel records and keeps every empty month in an all-history chart", () => {
    const ledger = buildLedger([], [], { ...EMPTY_CARE, serviceEvents: [service("early", "2025-01-04", 10000), service("late", "2026-03-04", 50000)] }, EMPTY_EXTRA);
    const summary = spendingSummary(ledger, "1900-01-01", "2026-03-31");
    expect(summary.amount).toBe(60000);
    expect(summary.fuelCount).toBe(0);
    expect(summary.months).toHaveLength(15);
    expect(summary.months[0].key).toBe("2025-01");
    expect(summary.months[1]).toMatchObject({ key: "2025-02", total: 0, count: 0 });
    expect(summary.months.at(-1)?.key).toBe("2026-03");
  });

  it("preserves all-unknown, unknown refunds, explicit zero and negative-net periods as distinct states", () => {
    const missing = buildLedger([], [], { ...EMPTY_CARE, vehicleExpenses: [expense("unknown-refund", "2026-10-01", null, "refund")] }, EMPTY_EXTRA);
    const unknown = spendingSummary(missing, "2026-10-01", "2026-10-31");
    expect(unknown.amount).toBeNull();
    expect(unknown.expenseAmount).toBeNull();
    expect(unknown.months[0]).toMatchObject({ refunds: null, other: 0, total: null, unknown: 1 });
    const zero = buildLedger([], [], { ...EMPTY_CARE, serviceEvents: [service("zero", "2026-10-01", 0)] }, EMPTY_EXTRA);
    expect(knownLedgerAmount(zero)).toBe(0);
    const refund = buildLedger([], [], { ...EMPTY_CARE, vehicleExpenses: [expense("refund", "2026-10-01", 12345, "refund")] }, EMPTY_EXTRA);
    expect(spendingSummary(refund, "2026-10-01", "2026-10-31").amount).toBe(-12345);
  });

  it("uses the same selected calendar days for the summary and its Journal destination", () => {
    const rows = buildLedger([], [], { ...EMPTY_CARE, serviceEvents: [service("before", "2026-09-30", 10000), service("first", "2026-10-01", 20000), service("last", "2026-10-31", 30000), service("after", "2026-11-01", 40000)] }, EMPTY_EXTRA);
    const selected = insightRange(new URLSearchParams("month=2026-10"), now);
    const summary = spendingSummary(rows, selected.fromDay, selected.toDay);
    expect(summary.rows.map(row => row.id).sort()).toEqual(["first", "last"]);
    expect(summary.serviceAmount).toBe(50000);
    expect(new URLSearchParams(journalRangeLink("service", selected.fromDay, selected.toDay).split("?")[1]).get("to")).toBe("2026-10-31");
  });
});
