import { describe, expect, it } from "vitest";
import {
  receiptConflict,
  suggestReceiptPrice,
  typeReceiptField,
  editReceiptField,
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

describe('interactive amount calculator', () => {
  it('switches direction repeatedly while keeping the displayed price', () => {
    let state = suggestReceiptPrice(empty, 7.5);
    state = editReceiptField(state, 'liters', '40');
    expect(state.totalCost).toBe('300.00');
    state = editReceiptField(state, 'totalCost', '150');
    expect(state.liters).toBe('20');
    state = editReceiptField(state, 'liters', '30');
    expect(state.totalCost).toBe('225.00');
    state = editReceiptField(state, 'totalCost', '375');
    expect(state.liters).toBe('50');
    expect(state.pricePerLiter).toBe('7.5');
    expect(receiptConflict(state)).toBeNull();
  });
  it('derives a missing price from the two measurements, without assuming zero', () => {
    let state = editReceiptField(empty, 'liters', '40');
    expect(state.totalCost).toBe('');
    state = editReceiptField(state, 'totalCost', '280');
    expect(state).toMatchObject({liters:'40',totalCost:'280',pricePerLiter:'7'});
    expect(suggestReceiptPrice(state,8)).toEqual(state);
  });
  it('preserves reviewed imports until an explicit edit, then clears stale derived amounts on invalid input', () => {
    const imported = typeReceiptField(typeReceiptField(suggestReceiptPrice(empty,8),'totalCost','280'),'liters','40');
    expect(imported).toMatchObject({totalCost:'280',liters:'40',pricePerLiter:'7'});
    const edited = editReceiptField(imported,'totalCost','350');
    expect(edited).toMatchObject({totalCost:'350',liters:'50',pricePerLiter:'7'});
    expect(editReceiptField(edited,'liters','')).toMatchObject({liters:'',totalCost:'',pricePerLiter:'7'});
    expect(editReceiptField(edited,'totalCost','-')).toMatchObject({totalCost:'-',liters:'',pricePerLiter:'7'});
  });
  it('supports decimal-comma and pump precision when either amount is edited', () => {
    const state = editReceiptField(editReceiptField(empty,'pricePerLiter','7,77'),'liters','26,092');
    expect(state.totalCost).toBe('202.73');
    expect(editReceiptField(state,'totalCost','388,50').liters).toBe('50');
  });
});
