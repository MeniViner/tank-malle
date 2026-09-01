import { describe, expect, it } from "vitest";
import {
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
