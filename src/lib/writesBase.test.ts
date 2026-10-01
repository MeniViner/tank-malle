import { describe, expect, it } from "vitest";
import { fillupBaseMatches } from "./writesBase";
import { parseFillupDocument, serializeFillupPatch } from "./fillupSerializer";

const stored = { date: 1000, odometer: 100000, liters: 40, pricePerLiter: 7, totalCost: 280, isFullTank: true };

describe("exact fill-up mutation base", () => {
  it("accepts reader defaults on untouched legacy documents", () => {
    const parsed = parseFillupDocument("f1", stored);
    if (!parsed.ok) throw new Error("fixture invalid");
    expect(fillupBaseMatches(serializeFillupPatch(parsed.fillup), stored)).toBe(true);
  });
  it("rejects changed legacy content under identical version and marker", () => {
    const before = { ...stored, version: 5, writeId: "base" };
    expect(fillupBaseMatches(before, { ...before, notes: "intervening legacy edit" })).toBe(false);
    expect(fillupBaseMatches(before, { ...before, liters: 40.00000001 })).toBe(false);
  });
  it("detects markers even when content is unchanged", () => {
    expect(fillupBaseMatches({ ...stored, version: 5, writeId: "a" }, { ...stored, version: 5, writeId: "b" })).toBe(false);
    expect(fillupBaseMatches({ ...stored, version: 5 }, { ...stored, version: 6 })).toBe(false);
  });
  it("compares dates across Firestore Timestamp and durable epoch formats", () => {
    expect(fillupBaseMatches(stored, { ...stored, date: { toMillis: () => 1000 } })).toBe(true);
    expect(fillupBaseMatches(stored, { ...stored, date: { toMillis: () => 1001 } })).toBe(false);
  });
});
