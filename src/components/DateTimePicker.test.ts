import { describe, expect, it } from "vitest";
import { parseTypedTime } from "../lib/format";
import { parseDate } from "../lib/import/normalize";

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
