import { describe, expect, it } from "vitest";
import {
  receiptConflict,
  suggestReceiptPrice,
  typeReceiptField,
  type ReceiptState,
} from "./receipt";

const empty: ReceiptState = { liters: "", pricePerLiter: "", totalCost: "", authored: [] };

describe("receipt ownership", () => {
  it("PRICE-02: typing the real total never rewrites typed litres", () => {
    let state = suggestReceiptPrice(empty, 8);
    state = typeReceiptField(state, "liters", "40");
    expect(state.totalCost).toBe("320.00");
    state = typeReceiptField(state, "totalCost", "280");
    expect(state.liters).toBe("40");
    // The unauthored field — the suggested price — is what moves.
    expect(state.pricePerLiter).toBe("7");
  });

  it("derives the total from litres and price", () => {
    let state = typeReceiptField(empty, "pricePerLiter", "7.19");
    state = typeReceiptField(state, "liters", "38.2");
    expect(state.totalCost).toBe("274.66");
  });

  it("derives litres from total and price", () => {
    let state = typeReceiptField(empty, "pricePerLiter", "7");
    state = typeReceiptField(state, "totalCost", "280");
    expect(state.liters).toBe("40");
  });

  it("derives the price from litres and total, in every typing order", () => {
    let a = typeReceiptField(empty, "liters", "40");
    a = typeReceiptField(a, "totalCost", "280");
    expect(a.pricePerLiter).toBe("7");

    let b = typeReceiptField(empty, "totalCost", "280");
    b = typeReceiptField(b, "liters", "40");
    expect(b.pricePerLiter).toBe("7");
  });

  it("a late or month-changed suggested price does not touch an authored receipt", () => {
    let state = typeReceiptField(empty, "liters", "40");
    state = typeReceiptField(state, "totalCost", "280");
    const after = suggestReceiptPrice(state, 8.25);
    expect(after).toEqual(state);
  });

  it("a suggested price fills an unauthored price and derives the total", () => {
    const state = suggestReceiptPrice(typeReceiptField(empty, "liters", "40"), 7.5);
    expect(state.pricePerLiter).toBe("7.5");
    expect(state.totalCost).toBe("300.00");
  });

  it("a typed price is never overwritten by a suggestion", () => {
    const state = suggestReceiptPrice(typeReceiptField(empty, "pricePerLiter", "6.9"), 7.5);
    expect(state.pricePerLiter).toBe("6.9");
  });

  it("three authored figures that disagree are reported, not moved", () => {
    let state = typeReceiptField(empty, "liters", "40");
    state = typeReceiptField(state, "pricePerLiter", "7");
    state = typeReceiptField(state, "totalCost", "300");
    expect(state).toMatchObject({ liters: "40", pricePerLiter: "7", totalCost: "300" });
    const conflict = receiptConflict(state);
    expect(conflict?.differenceShekels).toBe(20);
  });

  it("pump rounding is not a conflict", () => {
    let state = typeReceiptField(empty, "liters", "40");
    state = typeReceiptField(state, "pricePerLiter", "7.31");
    state = typeReceiptField(state, "totalCost", "292");
    expect(receiptConflict(state)).toBeNull();
  });

  it("clearing a field hands it back to the arithmetic", () => {
    let state = typeReceiptField(empty, "liters", "40");
    state = typeReceiptField(state, "pricePerLiter", "7");
    state = typeReceiptField(state, "totalCost", "300");
    state = typeReceiptField(state, "totalCost", "");
    expect(state.authored).toEqual(["liters", "pricePerLiter"]);
    state = typeReceiptField(state, "liters", "41");
    expect(state.totalCost).toBe("287.00");
  });

  it("applies a discount by typing the price: total follows the litres", () => {
    let state = typeReceiptField(empty, "liters", "40");
    state = typeReceiptField(state, "pricePerLiter", "6.5");
    expect(state.totalCost).toBe("260.00");
  });
});
