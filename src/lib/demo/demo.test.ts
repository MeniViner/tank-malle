import { describe, expect, it } from "vitest";
import { buildDemo, DEMO_EV_ID, DEMO_FUEL_ID, isDemoVehicleId } from "./demo";
import { CARE_COLLECTIONS, validCareRecord } from "../maintenance/model";
import { isEv } from "../vehicle/v3Fields";

describe("demo data", () => {
  const now = Date.UTC(2026, 10, 20, 10);
  it("is deterministic and holds a year of ordered history for both cars", () => {
    expect(buildDemo("fuel", now)).toEqual(buildDemo("fuel", now));
    const demo = buildDemo("ev", now);
    expect(demo.activeVehicleId).toBe(DEMO_EV_ID);
    expect(isEv(demo.vehicles.find(v => v.id === DEMO_EV_ID))).toBe(true);
    expect(isEv(demo.vehicles.find(v => v.id === DEMO_FUEL_ID))).toBe(false);
    for (const id of [DEMO_FUEL_ID, DEMO_EV_ID]) {
      const rows = demo.fillups[id];
      expect(rows.length).toBeGreaterThan(25);
      expect(rows[0].date).toBeGreaterThan(now - 370 * 86_400_000);
      expect(rows[rows.length - 1].date).toBeLessThan(now);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].date).toBeGreaterThan(rows[i - 1].date);
        expect(rows[i].odometer).toBeGreaterThan(rows[i - 1].odometer);
      }
      for (const row of rows) expect(row.totalCost).toBeCloseTo(row.liters * row.pricePerLiter, 1);
    }
  });

  it("writes care records the app accepts", () => {
    const demo = buildDemo("fuel", now);
    for (const id of [DEMO_FUEL_ID, DEMO_EV_ID]) for (const name of CARE_COLLECTIONS) {
      for (const record of demo.care?.[id]?.[name] ?? []) expect(validCareRecord(name, record), `${id} ${name}`).toBe(true);
    }
    expect(demo.care?.[DEMO_FUEL_ID]?.vehicleExpenses.length).toBeGreaterThan(0);
  });

  it("recognises only its own vehicle ids", () => {
    expect(isDemoVehicleId(DEMO_FUEL_ID)).toBe(true);
    expect(isDemoVehicleId("abc")).toBe(false);
    expect(isDemoVehicleId(null)).toBe(false);
  });
});
