/**
 * Numeric input parsing that is field-aware and consumes the whole input.
 *
 * The old `parseDecimal` replaced every comma with a dot and stripped anything
 * else, so "123,456" on an odometer became 123.456 and "1,234.5" became
 * 1.234 — both valid to the rules, both silently wrong. A parser cannot know
 * whether a comma is a thousands separator or a decimal comma from the
 * characters alone; it CAN know what kind of field it is reading.
 */

export type NumericFieldKind =
  /** Whole kilometres; a comma followed by three digits is a thousands group. */
  | "odometer"
  /** Litres: decimals are normal and a comma is a decimal comma. */
  | "liters"
  /** ₪ per litre, typically two or three decimals. */
  | "price"
  /** A money total: two decimals, thousands possible. */
  | "money"
  /** A plain decimal with no field knowledge (the previous behaviour, made strict). */
  | "decimal";

export interface ParsedNumber {
  value: number;
  /**
   * True when the input admits two readings and the field kind decided. The
   * UI can show what it understood rather than letting the guess pass silently.
   */
  ambiguous: boolean;
  /** How the value was read, for the explanation line. */
  interpretation: string | null;
}

const NOT_A_NUMBER: ParsedNumber = { value: Number.NaN, ambiguous: false, interpretation: null };

function finish(text: string, ambiguous: boolean, interpretation: string | null): ParsedNumber {
  const value = Number(text);
  if (!Number.isFinite(value)) return NOT_A_NUMBER;
  return { value, ambiguous, interpretation };
}

/** Every group after the first separator must be exactly three digits. */
function validGroups(groups: string[]): boolean {
  return groups.length > 1 && groups.slice(1).every((group) => /^\d{3}$/.test(group))
    && /^\d{1,3}$/.test(groups[0]);
}

/**
 * Parse a typed number. Returns NaN for anything that is not entirely a
 * number: "40 ל" is rejected rather than read as 40, because a unit the user
 * typed in the wrong field is a signal, not noise.
 */
export function parseNumberInput(raw: string, kind: NumericFieldKind = "decimal"): ParsedNumber {
  // Arabic-Indic and Eastern Arabic digits appear on some Hebrew keyboards.
  const text = raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    // Thin/regular spaces between groups ("1 234") are accepted as grouping.
    .replace(/[\s  ]+/g, "");

  if (text === "") return NOT_A_NUMBER;
  if (!/^-?[\d.,]+$/.test(text)) return NOT_A_NUMBER;

  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  if (body === "" || body === "." || body === ",") return NOT_A_NUMBER;

  const sign = negative ? "-" : "";
  const commas = body.split(",").length - 1;
  const dots = body.split(".").length - 1;

  // Both separators present: the LAST one is the decimal mark, the other must
  // form valid thousands groups. "1,234.5" → 1234.5 · "1.234,5" → 1234.5.
  if (commas > 0 && dots > 0) {
    const lastComma = body.lastIndexOf(",");
    const lastDot = body.lastIndexOf(".");
    const decimalMark = lastComma > lastDot ? "," : ".";
    const groupMark = decimalMark === "," ? "." : ",";
    if (body.split(decimalMark).length !== 2) return NOT_A_NUMBER;
    const [whole, fraction] = body.split(decimalMark);
    if (!validGroups(whole.split(groupMark)) || !/^\d+$/.test(fraction)) return NOT_A_NUMBER;
    return finish(`${sign}${whole.split(groupMark).join("")}.${fraction}`, false, null);
  }

  // Only dots: one dot is a decimal point; several must be thousands groups.
  if (dots > 0) {
    if (dots === 1) {
      const [whole, fraction] = body.split(".");
      if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return NOT_A_NUMBER;
      return finish(`${sign}${whole || "0"}.${fraction || "0"}`, false, null);
    }
    const groups = body.split(".");
    if (!validGroups(groups)) return NOT_A_NUMBER;
    return finish(`${sign}${groups.join("")}`, false, null);
  }

  // Only commas.
  if (commas > 0) {
    const groups = body.split(",");
    if (commas >= 2) {
      if (!validGroups(groups)) return NOT_A_NUMBER;
      return finish(`${sign}${groups.join("")}`, false, null);
    }
    const [whole, fraction] = groups;
    if (!/^\d+$/.test(whole) || !/^\d+$/.test(fraction)) return NOT_A_NUMBER;

    const threeDigits = fraction.length === 3 && whole.length <= 3;
    if (kind === "odometer") {
      // "123,456" km is a grouped whole number; "123,4" is somebody's decimal
      // comma on a field that is whole kilometres anyway.
      if (threeDigits) return finish(`${sign}${whole}${fraction}`, false, "נקרא כמספר שלם");
      return finish(`${sign}${whole}.${fraction}`, false, null);
    }
    if (kind === "money" && threeDigits) {
      // ₪1,234 is far more common than a three-decimal shekel amount.
      return finish(`${sign}${whole}${fraction}`, true, `נקרא כ־${whole}${fraction} ₪`);
    }
    // Litres and prices: a comma is a decimal comma. "38,250" is 38.25 L,
    // "7,190" is ₪7.19 — a three-decimal pump figure, not thousands of litres.
    const decimal = `${sign}${whole}.${fraction}`;
    return finish(decimal, threeDigits, threeDigits ? `נקרא כ־${whole}.${fraction}` : null);
  }

  if (!/^\d+$/.test(body)) return NOT_A_NUMBER;
  return finish(`${sign}${body}`, false, null);
}

/** Convenience: the value only. NaN when the input is not entirely a number. */
export function parseNumber(raw: string, kind: NumericFieldKind = "decimal"): number {
  return parseNumberInput(raw, kind).value;
}
