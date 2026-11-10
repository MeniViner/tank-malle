import { describe, expect, it } from "vitest";
import { latestMonthWithData } from "./monthWithData";

const at = (year: number, month: number, day = 15) => new Date(year, month - 1, day, 12).getTime();

describe("latestMonthWithData (Design v3 §5)", () => {
  it("shows today's month when it already has a purchase", () => {
    const result = latestMonthWithData([{ date: at(2026, 10, 3) }, { date: at(2026, 11, 2), amount: 240 }], new Date(2026, 10, 10));
    expect(result).toEqual({ key: "2026-11", year: 2026, month: 11, label: "נוב׳", longLabel: "נובמבר", isCurrent: true });
  });

  it("falls back to the previous month with data when this month has none yet", () => {
    const result = latestMonthWithData([{ date: at(2026, 8) }, { date: at(2026, 10, 28), amount: 312.4 }], new Date(2026, 10, 1));
    expect(result).toMatchObject({ key: "2026-10", label: "אוק׳", isCurrent: false });
  });

  it("skips empty months, not just the current one", () => {
    const result = latestMonthWithData([{ date: at(2026, 7) }], new Date(2026, 10, 1));
    expect(result).toMatchObject({ key: "2026-07", label: "יול׳", isCurrent: false });
  });

  it("crosses the year boundary", () => {
    const result = latestMonthWithData([{ date: at(2025, 11) }, { date: "2025-12-31" }], new Date(2026, 0, 4));
    expect(result).toMatchObject({ key: "2025-12", year: 2025, month: 12, label: "דצמ׳", isCurrent: false });
  });

  it("reads civil date strings as written (no UTC shift at month edges)", () => {
    expect(latestMonthWithData([{ date: "2026-10-31" }], new Date(2026, 10, 1))?.key).toBe("2026-10");
    expect(latestMonthWithData([{ date: "2026-11-01T00:10" }], new Date(2026, 10, 1))?.key).toBe("2026-11");
  });

  it("ignores future-dated rows", () => {
    const result = latestMonthWithData([{ date: at(2026, 12) }, { date: at(2026, 9) }], new Date(2026, 10, 1));
    expect(result?.key).toBe("2026-09");
  });

  it("does not count zero or unknown amounts as purchases", () => {
    const result = latestMonthWithData([
      { date: at(2026, 11), amount: 0 },
      { date: at(2026, 11), amount: null },
      { date: at(2026, 11), amount: Number.NaN },
      { date: at(2026, 9), amount: -40 },
    ], new Date(2026, 10, 20));
    expect(result?.key).toBe("2026-09");
  });

  it("returns null when there is no data at all, so the caller shows —, never 0 ₪", () => {
    expect(latestMonthWithData([], new Date(2026, 10, 1))).toBeNull();
    expect(latestMonthWithData([{ date: "not a date" }, { date: at(2027, 1) }], new Date(2026, 10, 1))).toBeNull();
  });

  it("accepts Date rows and an epoch `today`", () => {
    expect(latestMonthWithData([{ date: new Date(2026, 1, 28) }], at(2026, 3, 1))).toMatchObject({ key: "2026-02", label: "פבר׳" });
  });
});
