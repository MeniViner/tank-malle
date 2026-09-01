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

  it("puts the currency symbol in front of the amount", () => {
    expect(shekel(216.77)).toBe("₪216.77");
    expect(shekel(216)).toBe("₪216");
    expect(price(8.25)).toBe("₪8.25");
  });

  it("puts the sign in front of the currency symbol", () => {
    expect(shekelSigned(-0.05)).toBe("−₪0.05");
    expect(shekelSigned(1.2)).toBe("+₪1.20");
    expect(shekelSigned(0)).toBe("₪0.00");
  });

  it("uses a true minus sign, not a hyphen, so it cannot read as a list dash", () => {
    expect(shekelSigned(-0.05).startsWith("-")).toBe(false);
    expect(percent(-8).startsWith("-")).toBe(false);
  });

  it("groups thousands", () => {
    expect(int(201050)).toBe("201,050");
    expect(num(26.762, 3)).toBe("26.762");
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
