import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTypedTime } from "../lib/format";
import { parseDate } from "../lib/import/normalize";

const SOURCE = readFileSync(new URL("./DateTimePicker.tsx", import.meta.url), "utf8");

describe("typed time entry", () => {
  it("accepts any minute, not just multiples of five", () => {
    // The exact case the old five-minute stepper could not express.
    expect(parseTypedTime("18:47")).toEqual({ hours: 18, minutes: 47 });
    expect(parseTypedTime("07:01")).toEqual({ hours: 7, minutes: 1 });
    expect(parseTypedTime("23:59")).toEqual({ hours: 23, minutes: 59 });
    expect(parseTypedTime("00:00")).toEqual({ hours: 0, minutes: 0 });
  });

  it("accepts a dot separator and a bare four-digit form", () => {
    expect(parseTypedTime("18.47")).toEqual({ hours: 18, minutes: 47 });
    expect(parseTypedTime("1847")).toEqual({ hours: 18, minutes: 47 });
    expect(parseTypedTime("847")).toEqual({ hours: 8, minutes: 47 });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseTypedTime("  9:05 ")).toEqual({ hours: 9, minutes: 5 });
  });

  it("rejects an impossible clock time rather than clamping it", () => {
    expect(parseTypedTime("24:00")).toBeNull();
    expect(parseTypedTime("12:60")).toBeNull();
    expect(parseTypedTime("99:99")).toBeNull();
  });

  it("rejects text it cannot read, so the field can say why", () => {
    expect(parseTypedTime("")).toBeNull();
    expect(parseTypedTime("evening")).toBeNull();
    expect(parseTypedTime("6pm")).toBeNull();
  });
});

describe("typed date entry", () => {
  it("accepts both formats the field advertises", () => {
    const a = parseDate("24/03/2026");
    const b = parseDate("2026-03-24");
    expect(a?.getTime()).toBe(b?.getTime());
    expect(a?.getDate()).toBe(24);
    expect(a?.getMonth()).toBe(2);
    expect(a?.getFullYear()).toBe(2026);
  });

  it("reads day-first, as an Israeli user writes it", () => {
    expect(parseDate("03/04/2026")?.getMonth()).toBe(3); // April, not March
  });

  it("reaches a date years back in one step", () => {
    const old = parseDate("15/06/2019");
    expect(old?.getFullYear()).toBe(2019);
    expect(old?.getMonth()).toBe(5);
  });

  it("rejects an impossible date instead of rolling it forward", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("32/01/2026")).toBeNull();
  });
});

/**
 * Two fields, and nothing between them.
 *
 * The steppers went first — nine taps to reach 18:47 — and the month grid with
 * them: it paged one month at a time, so a record from two years back cost two
 * dozen taps, and it duplicated a device picker that does the same job better.
 * Asserted against the source so neither can quietly come back in a refactor.
 */
describe("date and time controls", () => {
  it("keeps the manual field and both OS pickers", () => {
    expect(SOURCE).toContain('aria-label="שעה — הקלדה ידנית"');
    expect(SOURCE).toContain('aria-label="תאריך — הקלדה ידנית"');
    expect(SOURCE).toContain('aria-label="בחירת שעה מהמכשיר"');
    expect(SOURCE).toContain('aria-label="בחירת תאריך מהמכשיר"');
  });

  it("opens the device picker from an icon, not from a label naming the device", () => {
    expect(SOURCE).toContain('pickerLabel="פתיחת לוח השנה"');
    expect(SOURCE).toContain('pickerLabel="פתיחת בורר השעה"');
    expect(SOURCE).not.toContain("לוח שנה של המכשיר");
    expect(SOURCE).not.toContain("שעון של המכשיר");
  });

  it("renders neither steppers nor a calendar grid", () => {
    expect(SOURCE).not.toContain("TimeRow");
    expect(SOURCE).not.toContain("function Stepper");
    expect(SOURCE).not.toContain("function Caret");
    expect(SOURCE).not.toContain("— הגדלה");
    expect(SOURCE).not.toContain("— הקטנה");
    expect(SOURCE).not.toContain('aria-label="חודש קודם"');
    expect(SOURCE).not.toContain('aria-label="חודש הבא"');
    expect(SOURCE).not.toContain("WEEKDAYS");
  });

  it("accepts the two-digit year form the field is used with", () => {
    const short = parseDate("05/09/26");
    expect(short?.getFullYear()).toBe(2026);
    expect(short?.getMonth()).toBe(8);
    expect(short?.getDate()).toBe(5);
  });

  it("still accepts the exact minutes the steppers could not reach", () => {
    expect(parseTypedTime("14:14")).toEqual({ hours: 14, minutes: 14 });
    expect(parseTypedTime("18:47")).toEqual({ hours: 18, minutes: 47 });
  });
});
