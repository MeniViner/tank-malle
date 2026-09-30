/**
 * The receipt triangle: litres, price per litre, total.
 *
 * Any two determine the third. The previous form derived whichever field was
 * NOT the one just typed, using whatever price happened to be in the box — a
 * suggestion nobody had confirmed — so typing the real total from the receipt
 * silently rewrote the litres the user had just copied from the same receipt.
 *
 * The rule here is ownership, not recency: a field the user typed is a
 * measurement and is never moved by arithmetic. Only the one field the user
 * did NOT author is derived. When all three are authored and disagree, nothing
 * moves; the disagreement is reported for the user to resolve.
 *
 * Pure. Strings in, strings out, so the form can keep exactly what was typed.
 */

import { parseNumberInput } from "./numeric";

export type ReceiptField = "liters" | "pricePerLiter" | "totalCost";

export interface ReceiptState {
  liters: string;
  pricePerLiter: string;
  totalCost: string;
  /** Fields the user typed (or explicitly confirmed). Never inferred. */
  authored: ReceiptField[];
}

export interface ReceiptConflict {
  /** ₪ difference between the typed total and litres × price. */
  differenceShekels: number;
  message: string;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

function numberOf(state: ReceiptState, field: ReceiptField): number {
  const kind = field === "liters" ? "liters" : field === "pricePerLiter" ? "price" : "money";
  return parseNumberInput(state[field], kind).value;
}

function isValid(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Derive the one unauthored field from the two authored ones, when both are
 * valid. A field the user owns is never touched.
 */
export function deriveReceipt(state: ReceiptState): ReceiptState {
  const authored = new Set(state.authored);
  const liters = numberOf(state, "liters");
  const price = numberOf(state, "pricePerLiter");
  const total = numberOf(state, "totalCost");
  // A suggested price is usable arithmetic even though nobody authored it;
  // it just never outranks a typed figure.
  const priceKnown = authored.has("pricePerLiter") || state.pricePerLiter.trim() !== "";

  if (!authored.has("totalCost") && authored.has("liters") && priceKnown) {
    return {
      ...state,
      totalCost: isValid(liters) && isValid(price) ? round2(liters * price).toFixed(2) : state.totalCost,
    };
  }
  if (!authored.has("liters") && authored.has("totalCost") && priceKnown) {
    return {
      ...state,
      liters: isValid(total) && isValid(price) ? String(round2(total / price)) : state.liters,
    };
  }
  if (!authored.has("pricePerLiter") && authored.has("totalCost") && authored.has("liters")) {
    return {
      ...state,
      pricePerLiter: isValid(total) && isValid(liters) ? String(round3(total / liters)) : state.pricePerLiter,
    };
  }
  return state;
}

/** The user typed into one of the three fields. */
export function typeReceiptField(
  state: ReceiptState,
  field: ReceiptField,
  value: string,
): ReceiptState {
  const authored = state.authored.includes(field) ? state.authored : [...state.authored, field];
  const next: ReceiptState = { ...state, [field]: value, authored };
  // Clearing a field hands it back to the arithmetic.
  if (value.trim() === "") {
    next.authored = authored.filter((entry) => entry !== field);
    return next;
  }
  return deriveReceipt(next);
}

/**
 * A suggested price arrived (first load, a month change, a late fetch).
 *
 * It fills the price only when the user has not authored it, and it never
 * moves an authored litres or total. When both of those are authored, the
 * price is simply not applied: the receipt already determines it.
 */
export function suggestReceiptPrice(state: ReceiptState, price: number | null): ReceiptState {
  if (price === null || !Number.isFinite(price) || price <= 0) return state;
  const authored = new Set(state.authored);
  if (authored.has("pricePerLiter")) return state;
  if (authored.has("liters") && authored.has("totalCost")) return state;
  return deriveReceipt({ ...state, pricePerLiter: String(price) });
}

/**
 * Explicit conflict between three authored figures. Null when consistent,
 * when any figure is missing, or when only two are authored (then the third
 * is derived and cannot disagree).
 */
export function receiptConflict(state: ReceiptState): ReceiptConflict | null {
  const authored = new Set(state.authored);
  if (authored.size < 3) return null;
  const liters = numberOf(state, "liters");
  const price = numberOf(state, "pricePerLiter");
  const total = numberOf(state, "totalCost");
  if (!isValid(liters) || !isValid(price) || !isValid(total)) return null;
  const expected = liters * price;
  const difference = total - expected;
  // Pump rounding is a few agorot; anything past a shekel or 1% is a real
  // disagreement between what was typed.
  if (Math.abs(difference) <= Math.max(1, expected * 0.01)) return null;
  return {
    differenceShekels: round2(difference),
    message: `${liters} ל׳ × ₪${price} = ₪${round2(expected).toFixed(2)}, אבל הסכום שהוזן הוא ₪${round2(total).toFixed(2)}`,
  };
}

/** The receipt as numbers, for saving. NaN where a field is empty or invalid. */
export function receiptNumbers(state: ReceiptState): {
  liters: number;
  pricePerLiter: number;
  totalCost: number;
} {
  return {
    liters: numberOf(state, "liters"),
    pricePerLiter: numberOf(state, "pricePerLiter"),
    totalCost: numberOf(state, "totalCost"),
  };
}
