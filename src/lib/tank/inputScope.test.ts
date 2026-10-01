import { describe, expect, it } from "vitest";
import { previousTankLevel, readScopedTankInput, type ScopedTankInput, type TankInputScope } from "./inputScope";

const a: TankInputScope = { uid: "owner", vehicleId: "A" };
const b: TankInputScope = { uid: "owner", vehicleId: "B" };
const aRecords: ScopedTankInput<{ vehicleId: string }> = { scope: a, records: [{ vehicleId: "A" }], status: "ready" };

describe("tank input account/vehicle/subscription boundaries", () => {
  it("never paints A evidence during a delayed B read with no cache", () => {
    expect(readScopedTankInput(aRecords, b)).toEqual({ records: [], status: "loading" });
    expect(readScopedTankInput({ scope: b, records: [], status: "ready" }, b)).toMatchObject({ records: [], status: "ready" });
  });
  it("distinguishes denied reads from empty server history, retaining only B's own cache", () => {
    expect(readScopedTankInput({ scope: b, records: [], status: "unavailable" }, b).status).toBe("unavailable");
    expect(readScopedTankInput({ ...aRecords, status: "unavailable" }, b).records).toEqual([]);
    const own = { scope: b, records: [{ vehicleId: "B" }], status: "unavailable" as const };
    expect(readScopedTankInput(own, b)).toMatchObject(own);
  });
  it("rejects late snapshots after A → B → A and account switches with identical vehicle IDs", () => {
    const returnedA = { ...a };
    const otherAccount = { ...a, uid: "someone-else" };
    expect(readScopedTankInput(aRecords, returnedA).records).toEqual([]);
    expect(readScopedTankInput(aRecords, otherAccount).records).toEqual([]);
    expect(readScopedTankInput(aRecords, a).records).toHaveLength(1);
  });
  it("never carries the previous vehicle's stabilised headline into a new fit", () => {
    const carryover = { scope: a, level: 0.8 };
    expect(previousTankLevel(carryover, a)).toBe(0.8);
    expect(previousTankLevel(carryover, b)).toBeNull();
    expect(previousTankLevel(carryover, { ...a })).toBeNull();
    expect(previousTankLevel(carryover, { ...a, uid: "other" })).toBeNull();
  });
});
