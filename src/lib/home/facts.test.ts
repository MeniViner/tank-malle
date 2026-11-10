import { describe, expect, it } from "vitest";
import type { TcoResult } from "../tco";
import type { LedgerRow } from "../vehicle/derived";
import { energyPer100Km, fuelMonthFact, homeStatus } from "./facts";
import { plannedTripSpotlight } from "./spotlight";

const fuel = (id: string, day: string, totalCost: number | null): LedgerRow => ({
  key: `fillups/${id}`, id, collection: "fillups", kind: "fuel", day, at: Date.parse(`${day}T10:00:00`), title: "תדלוק", notes: "",
  amountAgorot: totalCost === null ? null : Math.round(totalCost * 100), financial: true, odometer: null,
  record: { id, date: Date.parse(`${day}T10:00:00`), odometer: 1, liters: 30, pricePerLiter: 7, totalCost: totalCost ?? 0,
    totalCostUnknown: totalCost === null, isFull: true } as unknown as LedgerRow["record"],
});
const service = (id: string, day: string, costAgorot: number): LedgerRow => ({
  key: `serviceEvents/${id}`, id, collection: "serviceEvents", kind: "service", day, at: null, title: "טיפול", notes: "",
  amountAgorot: costAgorot, financial: true, odometer: null, record: {} as LedgerRow["record"],
});

describe("fuelMonthFact (v3 §5 previous month with data)", () => {
  it("shows today's month when it has a fill-up", () => {
    const fact = fuelMonthFact([fuel("a", "2026-11-03", 200.4), fuel("b", "2026-11-08", 100), fuel("c", "2026-10-20", 300)], "2026-11-10");
    expect(fact.month).toMatchObject({ key: "2026-11", isCurrent: true, longLabel: "נובמבר" });
    expect(fact.value).toBeCloseTo(300.4, 6);
  });

  it("falls back to the latest earlier month with a fill-up, never 0 for an empty month", () => {
    const fact = fuelMonthFact([fuel("c", "2026-09-20", 300), service("s", "2026-11-02", 50000), fuel("d", "2026-08-01", 90)], "2026-11-10");
    expect(fact.month).toMatchObject({ key: "2026-09", isCurrent: false, longLabel: "ספטמבר" });
    expect(fact.value).toBe(300);
  });

  it("crosses the year boundary and ignores future-dated fill-ups", () => {
    const fact = fuelMonthFact([fuel("dec", "2025-12-30", 250), fuel("future", "2026-01-20", 999)], "2026-01-05");
    expect(fact.month?.key).toBe("2025-12");
    expect(fact.value).toBe(250);
  });

  it("an unknown cost in the shown month gives no partial sum", () => {
    const fact = fuelMonthFact([fuel("a", "2026-11-03", 200), fuel("b", "2026-11-04", null), fuel("c", "2026-10-03", 100)], "2026-11-10");
    expect(fact.month?.key).toBe("2026-11");
    expect(fact.value).toBeNull();
  });

  it("an incomplete history or no fill-ups never claims a total", () => {
    expect(fuelMonthFact([fuel("a", "2026-11-03", 200)], "2026-11-10", true)).toMatchObject({ month: { key: "2026-11" }, value: null });
    expect(fuelMonthFact([service("s", "2026-11-02", 100)], "2026-11-10")).toEqual({ month: null, value: null });
    expect(fuelMonthFact([], "bad-day")).toEqual({ month: null, value: null });
  });

  it("keeps exact values (display rounds, the fact does not)", () => {
    expect(fuelMonthFact([fuel("a", "2026-11-03", 123.456)], "2026-11-10").value).toBe(123.456);
  });
});

describe("energyPer100Km (EV facts row)", () => {
  const tco = (fuelValue: number | null) => ({ parts: [{ id: "fuel", label: "דלק", value: fuelValue, knownValue: fuelValue ?? 0 }] }) as unknown as TcoResult;
  it("divides the monthly energy part by the monthly distance", () => {
    expect(energyPer100Km(tco(304), 50)).toBeCloseTo(304 / (50 * 30.4) * 100, 9);
  });
  it("needs both a known energy part and real daily travel", () => {
    expect(energyPer100Km(tco(null), 50)).toBeNull();
    expect(energyPer100Km(tco(304), null)).toBeNull();
    expect(energyPer100Km(tco(304), .2)).toBeNull();
  });
});

describe("homeStatus (v3 §2.2)", () => {
  const base = { hasFillups: true, level: .67, low: false, spotlightCount: 0, docs: undefined, today: "2026-11-10" };
  it("is silent without fill-ups", () => {
    expect(homeStatus({ ...base, hasFillups: false })).toBeNull();
  });
  it("low fuel wins", () => {
    expect(homeStatus({ ...base, level: .08, low: true, spotlightCount: 2 })).toEqual({ kind: "low" });
  });
  it("cards present → the refuel line, only with a known level", () => {
    expect(homeStatus({ ...base, spotlightCount: 1 })).toEqual({ kind: "refuel", level: .67 });
    expect(homeStatus({ ...base, level: null, spotlightCount: 1 })).toBeNull();
  });
  it("nothing to show → all fine, with the test date only while valid", () => {
    expect(homeStatus({ ...base, docs: { test: { due: "2027-03-01" } } })).toEqual({ kind: "ok", testDue: "2027-03-01" });
    expect(homeStatus({ ...base, docs: { test: { due: "2026-11-01" } } })).toEqual({ kind: "ok", testDue: null });
    expect(homeStatus({ ...base, docs: "broken" })).toEqual({ kind: "ok", testDue: null });
  });
});

describe("planned-trip spotlight (v3 §2.3)", () => {
  it("is a dismissible warn card that opens the tank sheet, keyed by plan and day", () => {
    const item = plannedTripSpotlight({ planId: "p1", day: "2026-11-12", distanceKm: 420, rangeToReserveKm: 180.6 });
    expect(item).toMatchObject({ id: "trip:p1:2026-11-12", tone: "warn", icon: "road", title: "כדאי לתדלק לפני הנסיעה", target: { kind: "tank" } });
    expect(item.sticky).toBeUndefined();
    expect(item.body).toContain("420 ק״מ");
    expect(item.body).toContain("181 ק״מ עד לרזרבה");
  });
  it("omits the range when it is unknown or exhausted", () => {
    expect(plannedTripSpotlight({ planId: "p", day: "2026-11-12", distanceKm: 50, rangeToReserveKm: null }).body).not.toContain("רזרבה");
    expect(plannedTripSpotlight({ planId: "p", day: "2026-11-12", distanceKm: 50, rangeToReserveKm: 0 }).body).not.toContain("רזרבה");
  });
});
