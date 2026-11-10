import { describe, expect, it } from "vitest";
import {
  loginMoment,
  percent,
  percentPlain,
  price,
  shekel,
  shekelSigned,
  num,
  int,
} from "./format";
import { vehicleMoney } from "./vehicle/format";

/**
 * These assertions are about BIDI correctness, not arithmetic. Every string
 * here is rendered inside a dir="ltr" <bdi> island, so what is asserted is
 * exactly what the user sees, left to right.
 */
describe("RTL-safe numeric formatting", () => {
  it("puts the sign in front of a percentage", () => {
    // The regression: this used to produce "35%+".
    expect(percent(35)).toBe("+35%");
    expect(percent(-8)).toBe("−8%");
    expect(percent(0)).toBe("0%");
  });

  it("keeps one decimal when asked", () => {
    expect(percent(5.24, 1)).toBe("+5.2%");
    expect(percent(-5.24, 1)).toBe("−5.2%");
  });

  it("formats a plain percentage without a sign", () => {
    expect(percentPlain(72)).toBe("72%");
  });

  it("puts the currency symbol after the amount, joined by a narrow no-break space (v3 §5)", () => {
    expect(shekel(216.77)).toBe("217\u202F₪");
    expect(shekel(11680.89)).toBe("11,681\u202F₪");
    expect(shekel(216)).toBe("216\u202F₪");
    expect(price(8.25)).toBe("8.25\u202F₪");
  });

  it("emits the exact code points: digits, U+202F, U+20AA", () => {
    const codePoints = (value: string) => [...value].map((char) => char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"));
    expect(codePoints(shekel(777))).toEqual(["0037", "0037", "0037", "202F", "20AA"]);
    expect(codePoints(price(7.35))).toEqual(["0037", "002E", "0033", "0035", "202F", "20AA"]);
    expect(codePoints(shekelSigned(-12))).toEqual(["2212", "0031", "0032", "202F", "20AA"]);
    expect(codePoints(shekelSigned(5))).toEqual(["002B", "0035", "202F", "20AA"]);
    // No regular, no-break or bidi-control characters sneak in.
    for (const value of [shekel(1234), price(7.35), shekelSigned(-1234)]) {
      expect(value).not.toMatch(/[ \u00A0\u200E\u200F\u061C]/);
    }
  });

  it("puts the sign before the number, never before the symbol", () => {
    expect(shekelSigned(-1.5)).toBe("−2\u202F₪");
    expect(shekelSigned(1.2)).toBe("+1\u202F₪");
    expect(shekelSigned(0)).toBe("0\u202F₪");
  });

  it("uses a true minus sign, not a hyphen, so it cannot read as a list dash", () => {
    expect(shekelSigned(-0.05).startsWith("-")).toBe(false);
    expect(percent(-8).startsWith("-")).toBe(false);
  });

  it("groups thousands", () => {
    expect(int(201050)).toBe("201,050");
    expect(num(26.762, 3)).toBe("26.762");
  });

  it("applies the whole-shekel policy to totals and stored agorot, not per-litre prices", () => {
    expect(shekel(233.1)).toBe("233\u202F₪");
    expect(price(7.35)).toBe("7.35\u202F₪");
    expect(price(7.5)).toBe("7.50\u202F₪");
    expect(vehicleMoney(23310)).toBe("233\u202F₪");
    expect(vehicleMoney(-155)).toBe("−2\u202F₪");
    expect(vehicleMoney(null)).toBe("לא ידוע");
  });

  it("does not show a positive or negative sign on rounded zero", () => {
    expect(shekelSigned(-0.05)).toBe("0\u202F₪");
    expect(shekelSigned(0.2)).toBe("0\u202F₪");
    expect(vehicleMoney(-49)).toBe("0\u202F₪");
    expect(vehicleMoney(-50)).toBe("−1\u202F₪");
  });

  it("keeps unknown/non-finite monetary values out of displayed amounts", () => {
    expect(shekel(NaN)).toBe("—");
    expect(price(Infinity)).toBe("—");
    expect(shekelSigned(-Infinity)).toBe("—");
  });
});

describe("previous-login formatting", () => {
  const at = (h: number, m: number, dayOffset = 0) =>
    new Date(2026, 7, 30 - dayOffset, h, m).getTime();
  const now = new Date(2026, 7, 30, 20, 0).getTime();

  it("says today with a clock time, never 'now'", () => {
    expect(loginMoment(at(16, 42), now)).toBe("היום, 16:42");
    expect(loginMoment(at(16, 42), now)).not.toContain("עכשיו");
  });

  it("says yesterday with a clock time", () => {
    expect(loginMoment(at(23, 18, 1), now)).toBe("אתמול, 23:18");
  });

  it("gives day, month and time for an older login this year", () => {
    expect(loginMoment(new Date(2026, 7, 20, 9, 11).getTime(), now)).toBe("20 באוג׳, 09:11");
  });

  it("adds the year for a login in a previous year", () => {
    expect(loginMoment(new Date(2025, 0, 12, 8, 0).getTime(), now)).toBe(
      "12 בינו׳ 2025, 08:00",
    );
  });

  it("pads the clock to two digits", () => {
    expect(loginMoment(at(9, 5), now)).toBe("היום, 09:05");
  });
});
