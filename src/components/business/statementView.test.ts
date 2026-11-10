import { describe, expect, it } from "vitest";
import type { MonthlyStatement } from "../../lib/business/statement";
import { parseDecimal } from "../../lib/format";
import { businessForm, statementFileName } from "./statementView";

describe("business statement form (biz on the vehicle)", () => {
  it("an empty form clears the business details", () => {
    expect(businessForm({ company: " ", driver: "", usage: "" }, parseDecimal)).toEqual({ ok: true, biz: null });
  });

  it("trims names and keeps the typed usage exactly (no rounding)", () => {
    expect(businessForm({ company: "  מ. וינר בע״מ ", driver: "מני", usage: "62.5" }, parseDecimal))
      .toEqual({ ok: true, biz: { company: "מ. וינר בע״מ", driver: "מני", usagePct: 62.5 } });
    expect(businessForm({ company: "", driver: "", usage: "0" }, parseDecimal)).toEqual({ ok: true, biz: { usagePct: 0 } });
  });

  it.each(["101", "-1", "abc"])("refuses a usage of %s with a Hebrew message", usage => {
    const result = businessForm({ company: "", driver: "", usage }, parseDecimal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/0.*100/);
  });

  it("refuses names over the stored limits", () => {
    expect(businessForm({ company: "א".repeat(121), driver: "", usage: "" }, parseDecimal).ok).toBe(false);
  });
});

describe("statement export file names", () => {
  const statement = (plate: string | null) => ({ month: "2026-10", vehicle: { id: "veh/1", plate } }) as unknown as MonthlyStatement;
  it("uses the plate digits, or a safe vehicle id, and the month", () => {
    expect(statementFileName(statement("1234567"), "csv")).toBe("tank-maleh-statement-1234567-2026-10.csv");
    expect(statementFileName(statement(null), "html")).toBe("tank-maleh-statement-veh1-2026-10.html");
  });
});
