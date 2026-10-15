import { describe, expect, it } from "vitest";
import { fillupsToCsv, tankUpdatesToCsv } from "../csv";
import { parseCsv } from "./csv";
import { parseRows } from "./rows";
import { parseTankUpdates } from "./tankUpdates";
import type { Fillup } from "../types";
import type { TankObservation, TankPlan } from "../tank/types";

const fillup: Fillup = { id: "f1", date: Date.UTC(2026, 9, 1, 8), odometer: 123456,
  liters: 30, pricePerLiter: 7, totalCost: 210, isFullTank: false, fullTankSource: "legacy-assumption",
  fillEndState: "unknown", fillEndStateSource: "unknown", preFillLevel: 0.2, preFillLevelSource: "direct-gauge",
  preFillLevelUncertainty: 0.05, postFillLevel: 0.7, postFillLevelSource: "derived-after-partial",
  postFillLevelUncertainty: 0.1, refuelReason: "before-trip", capacityLitersAtEntry: 50,
  tankSchemaVersion: 2, postedPricePerLiter: 7.2 };

describe("audit regression: export is a usable backup of measurements", () => {
  it("preserves all tank and price fields, including unknown state", () => {
    const result = parseRows(parseCsv(fillupsToCsv([fillup])));
    expect(result.rejected).toEqual([]);
    const { id: _id, ...data } = fillup;
    expect(result.rows[0]).toMatchObject(data);
  });
  it("rejects invalid tank levels instead of silently erasing their meaning", () => {
    const result = parseRows(parseCsv(fillupsToCsv([{ ...fillup, preFillLevel: 1.5 }])));
    expect(result.rows).toHaveLength(0); expect(result.rejected).toHaveLength(1);
  });
  it("round trips standalone measurements and plans without creating purchases", () => {
    const reading: TankObservation = { id: "o1", vehicleId: "v1", observedAt: Date.UTC(2026, 9, 1),
      recordedAt: Date.UTC(2026, 9, 2), kind: "both", odometer: 123456, level: 0.5,
      levelUncertainty: 0.1, levelSource: "direct-gauge", confirmed: true, phase: "standalone", schemaVersion: 1 };
    const plan: TankPlan = { id: "p1", vehicleId: "v1", date: Date.UTC(2026, 10, 1), distanceKm: 400,
      mode: "additional", bufferKm: 30, note: "נסיעה", createdAt: Date.UTC(2026, 9, 2) };
    const result = parseTankUpdates(parseCsv(tankUpdatesToCsv([reading], [plan])));
    expect(result.rejected).toEqual([]);
    expect(result.records).toEqual([{ type: "observation", value: reading }, { type: "plan", value: plan }]);
  });
});
