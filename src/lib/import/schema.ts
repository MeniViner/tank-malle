/**
 * Format detection, header mapping and the normalised row shape every parser
 * produces. Detection is by header content, never by column position: the
 * legacy exporter is free to reorder or add columns.
 */

import { cleanText } from "./normalize";

/** Bump when the meaning of an exported column changes. */
export const EXPORT_SCHEMA_VERSION = 2;

export type SourceFormat =
  /** Tank Maleh's own export, v1 (pre-upgrade) or v2. */
  | "tank-maleh-v1"
  | "tank-maleh-v2"
  /** The older Fuel Tracker workbook. */
  | "legacy-fuel-tracker"
  | "unknown";

/** Canonical field names the mapper resolves headers onto. */
export type Field =
  | "date"
  | "time"
  | "odometer"
  | "liters"
  | "pricePerLiter"
  | "totalCost"
  | "isFullTank"
  | "continuityBreakBefore"
  | "station"
  | "stationId"
  | "latitude"
  | "longitude"
  | "fuelType"
  | "notes"
  | "vehicleLabel"
  | "recordId"
  | "postedPricePerLiter"
  | "personalDiscountPerLiter"
  /** Legacy derived columns. Never imported; only scanned for the reset marker. */
  | "legacyDerived";

/**
 * Header aliases, normalised. Hebrew and English, Tank Maleh and legacy.
 * A header not listed here is ignored rather than guessed at.
 */
const ALIASES: Record<string, Field> = {};

function alias(field: Field, ...headers: string[]): void {
  for (const header of headers) ALIASES[normaliseHeader(header)] = field;
}

alias("date", "תאריך", "date", "fill date", "datetime", "date_time");
alias("time", "שעה", "time", "hour");
alias("odometer", "קילומטראז'", "קילומטראז׳", "קילומטראז", "מד אוץ", "מונה", "odometer", "odometer_km", "odometer km", "km", "mileage");
alias("liters", "כמות דלק", "ליטרים", "כמות", "liters", "litres", "litres_filled", "amount");
alias("totalCost", "מחיר כולל", "עלות כוללת", "סה\"כ", "total_cost", "total cost", "total", "cost");
alias("pricePerLiter", "ממוצע מחיר ליחידת נפח", "מחיר לליטר", "מחיר ליטר", "price_per_liter", "price per liter", "paid_price_per_liter", "unit price");
alias("postedPricePerLiter", "מחיר בתחנה", "posted_station_price_per_liter", "posted price");
alias("personalDiscountPerLiter", "הנחה אישית", "personal_discount_per_liter");
alias("fuelType", "סוג דלק", "fuel_type", "fuel type", "fuel");
alias("station", "תחנת דלק", "תחנה", "station", "station_name", "station_name_snapshot", "station name");
alias("stationId", "station_id", "station id", "מזהה תחנה");
alias("latitude", "latitude", "lat", "קו רוחב");
alias("longitude", "longitude", "lng", "lon", "קו אורך");
alias("notes", "הערות", "הערה", "notes", "note", "comment");
alias("isFullTank", "מיכל מלא", "מילאתי עד מלא", "is_full_tank", "filled_to_full", "full_tank", "full");
alias("continuityBreakBefore", "continuity_break_before", "התחלת תקופה חדשה", "break_before");
alias("vehicleLabel", "הרכב הנבחר", "רכב", "vehicle", "vehicle_label", "vehicle_id");
alias("recordId", "record_id", "id");

// Legacy derived columns. Their VALUES are never imported — the engine
// recomputes all of this — but they are still read, because the legacy
// exporter wrote its "calculation restarted" marker into them.
alias(
  "legacyDerived",
  "מרחק קודם",
  "ימים",
  "ממוצע מרחק ליחידת נפח",
  "ממוצע צריכה ל-100",
  "ממוצע עלות למרחק",
  "מרחק ליום",
  "ממוצע עלות יומית",
);

/**
 * Normalise a header for matching: strip bidi marks, unify the several
 * apostrophes Hebrew abbreviations use, collapse whitespace, lowercase.
 */
export function normaliseHeader(raw: unknown): string {
  return cleanText(raw)
    .replace(/[׳'`’]/g, "'")
    .replace(/[״"“”]/g, '"')
    .replace(/[_\s]+/g, " ")
    .trim()
    .toLowerCase();
}

/** Resolve one header cell to a canonical field, or null if unrecognised. */
export function fieldForHeader(raw: unknown): Field | null {
  return ALIASES[normaliseHeader(raw)] ?? null;
}

/** header row → { field: columnIndex }. First match wins. */
export function mapHeaders(headerRow: unknown[]): Partial<Record<Field, number>> {
  const map: Partial<Record<Field, number>> = {};
  headerRow.forEach((cell, index) => {
    const field = fieldForHeader(cell);
    if (field && field !== "legacyDerived" && map[field] === undefined) {
      map[field] = index;
    }
  });
  return map;
}

/** Column indices of the legacy derived block, scanned for the reset marker. */
export function legacyDerivedColumns(headerRow: unknown[]): number[] {
  const columns: number[] = [];
  headerRow.forEach((cell, index) => {
    if (fieldForHeader(cell) === "legacyDerived") columns.push(index);
  });
  return columns;
}

/**
 * Identify the format from the header row alone.
 *
 * The legacy workbook is recognised by its derived-column block, which Tank
 * Maleh never writes; Tank Maleh v2 by its explicit schema columns.
 */
export function detectFormat(headerRow: unknown[]): SourceFormat {
  const fields = new Set(
    headerRow.map((cell) => fieldForHeader(cell)).filter((f): f is Field => f !== null),
  );

  if (fields.has("continuityBreakBefore") || fields.has("recordId")) return "tank-maleh-v2";
  if (legacyDerivedColumns(headerRow).length >= 3) return "legacy-fuel-tracker";
  if (fields.has("isFullTank") && fields.has("odometer")) return "tank-maleh-v1";
  if (fields.has("odometer") && fields.has("liters") && fields.has("date")) {
    // Enough to import, but we cannot claim to know which exporter wrote it.
    return "unknown";
  }
  return "unknown";
}

/** The legacy exporter's marker for "start calculating again from here". */
export const LEGACY_RESET_MARKER = "התחלת חישוב מחדש";
