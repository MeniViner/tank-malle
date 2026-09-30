import { describe, expect, it } from "vitest";
import { parseNumber, parseNumberInput } from "./numeric";

describe("field-aware number parsing", () => {
  it("reads a grouped odometer as a whole number", () => {
    expect(parseNumber("123,456", "odometer")).toBe(123_456);
    expect(parseNumber("1,234,567", "odometer")).toBe(1_234_567);
    expect(parseNumber("123.456", "odometer")).toBe(123.456);
  });

  it("uses the last separator as the decimal mark when both appear", () => {
    expect(parseNumber("1,234.5", "liters")).toBe(1234.5);
    expect(parseNumber("1.234,5", "liters")).toBe(1234.5);
    expect(parseNumber("1,234.5", "odometer")).toBe(1234.5);
  });

  it("does not turn decimal litres or prices into thousands", () => {
    expect(parseNumber("38,25", "liters")).toBe(38.25);
    expect(parseNumber("38,250", "liters")).toBe(38.25);
    expect(parseNumber("7,19", "price")).toBe(7.19);
    expect(parseNumber("7,190", "price")).toBe(7.19);
    expect(parseNumber("7.190", "price")).toBe(7.19);
  });

  it("flags the ambiguous three-digit case instead of guessing silently", () => {
    expect(parseNumberInput("7,190", "price").ambiguous).toBe(true);
    expect(parseNumberInput("7,19", "price").ambiguous).toBe(false);
    expect(parseNumberInput("1,234", "money")).toMatchObject({ value: 1234, ambiguous: true });
    expect(parseNumberInput("123,456", "odometer").ambiguous).toBe(false);
  });

  it("tolerates whitespace around and inside the number", () => {
    expect(parseNumber(" 40 ", "liters")).toBe(40);
    expect(parseNumber("1 234", "odometer")).toBe(1234);
  });

  it("refuses input that is not entirely a number", () => {
    expect(parseNumber("40 ל", "liters")).toBeNaN();
    expect(parseNumber("abc", "liters")).toBeNaN();
    expect(parseNumber("", "liters")).toBeNaN();
    expect(parseNumber("1,23,4", "odometer")).toBeNaN();
    expect(parseNumber("1.2.3", "liters")).toBeNaN();
    expect(parseNumber("12,34,567", "odometer")).toBeNaN();
  });

  it("reads plain decimals and negatives", () => {
    expect(parseNumber("40.5")).toBe(40.5);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("-0.05")).toBe(-0.05);
  });
});
