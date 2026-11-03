import { describe, expect, it } from "vitest";
import { formatCivilDay, parseCivilDay } from "./civilDate";

describe("civil date drafts", () => {
  it("reads complete day-first and ISO input without changing the calendar day", () => {
    for (const text of ["05/09/2026", "05/09/26", "2026-09-05", " 05/09/2026 "]) {
      expect(parseCivilDay(text)).toBe("2026-09-05");
    }
    expect(parseCivilDay("03/04/2026")).toBe("2026-04-03");
    expect(formatCivilDay("2026-09-05")).toBe("05/09/2026");
  });

  it("preserves the established two-digit year convention", () => {
    expect(parseCivilDay("01/01/69")).toBe("2069-01-01");
    expect(parseCivilDay("01/01/70")).toBe("1970-01-01");
  });

  it("rejects invalid visible drafts instead of accepting a prefix or date rollover", () => {
    for (const text of ["", " ", "05/", "5/9/2026", "05.09.2026", "05-09-2026", "2026/09/05", "2026-9-05", "31/02/2026", "29/02/1900", "29/02/2100", "2026-13-01", "01/01/1899", "01/01/2200", "2026-09-05T12:00:00Z", "05/09/2026 anything", "46317", "05/09/026"]) {
      expect(parseCivilDay(text)).toBeNull();
    }
    expect(parseCivilDay("29/02/2000")).toBe("2000-02-29");
    expect(parseCivilDay("29/02/2028")).toBe("2028-02-29");
    expect(parseCivilDay("01/01/1900")).toBe("1900-01-01");
    expect(parseCivilDay("31/12/2199")).toBe("2199-12-31");
  });

  it("does not invent a date for absent or malformed source values", () => {
    expect(formatCivilDay(null)).toBe("");
    expect(formatCivilDay(undefined)).toBe("");
    expect(formatCivilDay("2026-02-31")).toBe("");
  });
});
