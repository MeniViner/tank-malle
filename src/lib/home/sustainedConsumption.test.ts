import { describe, expect, it } from "vitest";
import { computeStats, type Fillup, type Vehicle } from "../stats";
import { TANK_SCHEMA_VERSION } from "../tank/config";
import { sustainedConsumptionSpotlight } from "./sustainedConsumption";

const DAY = 86_400_000;
const now = +new Date("2026-11-05T12:00:00Z");
const vehicle: Vehicle = { id: "car", make: "Test", model: "Car", fuelType: "95", priceAdjustment: 0, archived: false };

function fills(rates = [12, 12, 12, 10, 10, 10], volumes = rates.map(() => 40)): Fillup[] {
  let odometer = 100000;
  return [null, ...rates].map((rate, index) => {
    if (rate !== null) odometer += rate * volumes[index - 1];
    const liters = index ? volumes[index - 1] : 40;
    return { id: `f${index}`, date: now - (rates.length - index) * 7 * DAY, odometer, liters,
      totalCost: liters * 7, pricePerLiter: 7, isFullTank: true, fillEndState: "full",
      fillEndStateSource: "user-confirmed", tankSchemaVersion: TANK_SCHEMA_VERSION };
  });
}

const insight = (source = fills(), patch: Partial<Parameters<typeof sustainedConsumptionSpotlight>[0]> = {}) =>
  sustainedConsumptionSpotlight({ now, stats: computeStats(source, vehicle, null, now), units: "kmPerLiter", historyComplete: true, ...patch });

describe("sustained consumption insight", () => {
  it("compares the latest three measured segments with the disjoint preceding three", () => {
    const item = insight();
    expect(item).toMatchObject({ tone: "warn", icon: "chart", target: { kind: "segment", endId: "f6" } });
    expect(item?.title).toBe("20% יותר דלק לק״מ לאורך 3 מקטעים");
    expect(item?.body).toContain("10.0 קמ״ל");
    expect(item?.body).toContain("12.0 קמ״ל");
    expect(item?.body).toContain("תנאי הנסיעה");
    expect(item?.body).not.toMatch(/תקלה|מוסך|לחץ אוויר/);
  });

  it("weights both windows by total distance and volume, not a mean of ratios", () => {
    const item = insight(fills([14, 12, 10, 9, 9, 9], [10, 40, 50, 20, 40, 50]));
    expect(item?.title).toContain("24%");
    expect(item?.body).toContain("11.2 קמ״ל");
    expect(item?.body).not.toContain("12.0 קמ״ל");
  });

  it("uses the same extra-fuel percentage and dismissal ID in either display unit", () => {
    const km = insight(), liters = insight(fills(), { units: "litersPer100" });
    expect(liters?.id).toBe(km?.id);
    expect(liters?.title).toBe(km?.title);
    expect(liters?.body).toContain("10.0 ל׳/100 ק״מ");
    expect(liters?.body).toContain("8.3 ל׳/100 ק״מ");
  });

  it("includes the 15% boundary and excludes a smaller difference or improvement", () => {
    expect(insight(fills([11.5, 11.5, 11.5, 10, 10, 10]))?.title).toContain("15%");
    expect(insight(fills([12, 12, 12, 10.5, 10.5, 10.5]))).toBeNull();
    expect(insight(fills([10, 10, 10, 12, 12, 12]))).toBeNull();
  });

  it("requires deterioration in every recent segment, even if the average crosses 15%", () => {
    expect(insight(fills([12, 12, 12, 12, 9, 9]))).toBeNull();
  });

  it("requires six segments and does not make a claim from incomplete history", () => {
    expect(insight(fills().slice(1))).toBeNull();
    expect(insight(fills(), { historyComplete: false })).toBeNull();
    expect(insight([], { now: NaN })).toBeNull();
  });

  it("requires confirmed full endpoints, not legacy assumptions or inferred full tanks", () => {
    for (const patch of [
      { tankSchemaVersion: undefined },
      { fillEndStateSource: "legacy-assumption" as const },
      { fillEndStateSource: "inferred" as const },
      { fillEndStateSource: null },
    ]) {
      const source = fills(); source[3] = { ...source[3], ...patch };
      expect(insight(source)).toBeNull();
    }
  });

  it("keeps the latest window instead of skipping an unreliable segment", () => {
    const source = fills([12, 12, 12, 12, 10, 10, 10]);
    source.at(-1)!.fillEndStateSource = "unknown";
    expect(insight(source)).toBeNull();
  });

  it("rejects anomalies on the opening fill or a contributing partial fill", () => {
    const source = withPartial();
    for (const id of ["f0", "partial", "f6"]) {
      const stats = computeStats(source, vehicle, null, now);
      stats.anomalies.push({ fillupId: id, kind: "tankOverfill", message: "test" });
      expect(insight(source, { stats })).toBeNull();
    }
  });

  it("allows correctly recorded partial fills between two confirmed full endpoints", () => {
    const item = insight(withPartial());
    expect(item?.title).toContain("20%");
    expect(item?.body).toContain("10.0 קמ״ל");
  });

  it("rejects invalid contributing volumes and nonchronological readings", () => {
    for (const value of [0, -1, NaN, Infinity]) {
      const source = withPartial(); source.find(row => row.id === "partial")!.liters = value;
      expect(insight(source)).toBeNull();
    }
    const source = withPartial(); source.find(row => row.id === "partial")!.date = source.at(-1)!.date + DAY;
    expect(insight(source)).toBeNull();
  });

  it("requires at least 100 km and 10 liters in each segment", () => {
    expect(insight(fills([12, 12, 12, 10, 10, 10], [40, 40, 40, 10, 40, 40]))).not.toBeNull();
    expect(insight(fills([12, 12, 12, 10, 10, 10], [40, 40, 40, 9, 40, 40]))).toBeNull();
    expect(insight(fills([11, 11, 11, 9, 9, 9], [40, 40, 40, 10, 40, 40]))).toBeNull();
  });

  it("does not cross a history break or reuse a trend from an earlier island", () => {
    const source = fills(); source[3].continuityBreakBefore = true;
    expect(insight(source)).toBeNull();
    const afterBreak = { ...fills().at(-1)!, id: "new-island", date: now + DAY, odometer: 104000, continuityBreakBefore: true, isFullTank: false, fillEndState: "partial" as const };
    expect(insight([...fills(), afterBreak], { now: now + DAY })).toBeNull();
  });

  it("accepts a break before the first baseline anchor once six fresh segments exist", () => {
    const source = fills(); source[0].continuityBreakBefore = true;
    expect(insight(source)).not.toBeNull();
  });

  it("requires a closing fill within 30 days and no future timestamps", () => {
    expect(insight(fills(), { now: now + 30 * DAY })).not.toBeNull();
    expect(insight(fills(), { now: now + 30 * DAY + 1 })).toBeNull();
    expect(insight(fills(), { now: now - 1 })).toBeNull();
  });

  it("limits the comparison to 180 days of recorded travel", () => {
    const source = fills(); source[0].date = now - 180 * DAY;
    expect(insight(source)).not.toBeNull();
    source[0].date -= 1;
    expect(insight(source)).toBeNull();
  });

  it("has a stable ID until new or corrected evidence changes the comparison", () => {
    const original = insight()!;
    expect(insight(fills(), { now: now + DAY })?.id).toBe(original.id);
    const edited = fills(); edited.at(-1)!.liters += 1;
    expect(insight(edited)?.id).not.toBe(original.id);
  });
});

function withPartial(): Fillup[] {
  const source = fills();
  const end = source[4];
  source.splice(4, 0, { ...end, id: "partial", date: end.date - DAY, odometer: end.odometer - 100,
    liters: 10, totalCost: 70, isFullTank: false, fillEndState: "partial" });
  end.liters = 30; end.totalCost = 210;
  return source;
}
