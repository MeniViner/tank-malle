/**
 * Rows → normalised records, and a plan describing exactly what an import
 * would do before it does it.
 *
 * Only raw inputs are imported. Every legacy derived column (previous
 * distance, days, km/L, L/100 km, cost per km, distance per day, daily cost)
 * is deliberately discarded and recomputed by the canonical engine — importing
 * them would create a second, divergent source of truth.
 */

import type { Fillup, FuelType, StationRef } from "../stats";
import {
  LEGACY_RESET_MARKER,
  detectFormat,
  legacyDerivedColumns,
  mapHeaders,
  type Field,
  type SourceFormat,
} from "./schema";
import { cleanText, combineDateTime, isEmptyCell, parseNumber, parsePositive } from "./normalize";

export interface ImportedRow {
  /** 1-based row number in the source sheet, for the rejection report. */
  rowNumber: number;
  date: number;
  odometer: number;
  liters: number;
  pricePerLiter: number;
  totalCost: number;
  isFullTank: boolean;
  fullTankSource: "user" | "legacy-assumption";
  continuityBreakBefore: boolean;
  station: StationRef | null;
  fuelType: FuelType | null;
  notes: string | null;
  warnings: string[];
}

export interface RejectedRow {
  rowNumber: number;
  reason: string;
}

export interface ParseResult {
  format: SourceFormat;
  rows: ImportedRow[];
  rejected: RejectedRow[];
  /** Statements the user must see before confirming, e.g. the full-tank default. */
  assumptions: string[];
  /**
   * Values found in the source's "vehicle" column. Import metadata, NOT a
   * make/model — "Imported Fuel Data 2026" must never become a vehicle.
   */
  vehicleLabels: string[];
  /**
   * Machine vehicle identity from a Tank Maleh export's `vehicle_id` column.
   * Used to auto-select the target vehicle; NEVER shown to the user — an
   * opaque Firestore id in the preview is noise, not information.
   */
  vehicleIds: string[];
  /**
   * Every data row the source contained: `rows.length + rejected.length`.
   *
   * Kept explicitly because "rows read" previously meant "rows that parsed",
   * which produced the impossible-looking "2 rows read · 3 not importable".
   */
  totalRows: number;
  breakCount: number;
  /** Every row-level warning, flattened, so the preview can show them all. */
  warnings: string[];
}

const FUEL_ALIASES: { test: RegExp; type: FuelType }[] = [
  { test: /סולר|דיזל|diesel/i, type: "diesel" },
  { test: /98/, type: "98" },
  { test: /95|בנזין|petrol|gasoline/i, type: "95" },
];

function parseFuelType(raw: unknown): FuelType | null {
  if (isEmptyCell(raw)) return null;
  const text = cleanText(raw);
  for (const { test, type } of FUEL_ALIASES) if (test.test(text)) return type;
  return "other";
}

/** "1"/"true"/"כן"/"מלא" → true; "0"/"false"/"לא"/"חלקי" → false. */
function parseBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (isEmptyCell(raw)) return null;
  const text = cleanText(raw).toLowerCase();
  if (/^(1|true|yes|y|כן|מלא|full)$/.test(text)) return true;
  if (/^(0|false|no|n|לא|חלקי|partial)$/.test(text)) return false;
  return null;
}

function cell(row: unknown[], index: number | undefined): unknown {
  return index === undefined ? undefined : row[index];
}

/**
 * Parse a whole sheet: header row first, then every data row.
 *
 * A row that cannot produce a valid record is rejected with a reason rather
 * than silently dropped or half-imported.
 */
export function parseRows(
  table: unknown[][],
  /**
   * Which cells came from a formula, when the source can tell us (XLSX).
   *
   * A cached formula result is the only value available and is usually right,
   * but it is not something the user typed: a workbook edited without
   * recalculation carries a stale one. Raw inputs computed this way are
   * imported AND flagged, so the preview can say so rather than the importer
   * either refusing a legitimate file or passing the value off as entered.
   */
  formulaCells: boolean[][] = [],
): ParseResult {
  const rejected: RejectedRow[] = [];
  const rows: ImportedRow[] = [];
  const assumptions: string[] = [];
  const vehicleLabels = new Set<string>();
  const vehicleIds = new Set<string>();

  const headerRow = table[0] ?? [];
  const format = detectFormat(headerRow);
  const columns: Partial<Record<Field, number>> = mapHeaders(headerRow);
  const derivedColumns = legacyDerivedColumns(headerRow);

  if (columns.date === undefined || columns.odometer === undefined || columns.liters === undefined) {
    return {
      format,
      rows: [],
      rejected: [
        {
          rowNumber: 1,
          reason: "לא נמצאו עמודות תאריך, קילומטראז׳ וכמות דלק — ודאו שהקובץ מכיל שורת כותרות.",
        },
      ],
      assumptions: [],
      vehicleLabels: [],
      vehicleIds: [],
      totalRows: 0,
      breakCount: 0,
      warnings: [],
    };
  }

  const isLegacy = format === "legacy-fuel-tracker";
  const hasFullTankColumn = columns.isFullTank !== undefined;

  if (isLegacy && !hasFullTankColumn) {
    assumptions.push(
      "לקובץ המקורי אין סימון של תדלוק חלקי. כל התדלוקים ייובאו כתדלוק מלא, כפי " +
        "שהקובץ הישן חישב אותם. אפשר לערוך כל רשומה אחרי הייבוא.",
    );
  }
  if (derivedColumns.length > 0) {
    assumptions.push(
      "עמודות החישוב מהקובץ הישן (מרחק קודם, ימים, קמ״ל, ל׳/100, עלות לק״מ) לא " +
        "ייובאו — כל הנתונים האלה מחושבים מחדש מהנתונים הגולמיים.",
    );
  }

  for (let i = 1; i < table.length; i += 1) {
    const raw = table[i] ?? [];
    const rowNumber = i + 1;

    // A completely blank row is skipped silently; a partially filled one is a
    // rejection the user should see.
    if (raw.every((value) => isEmptyCell(value))) continue;

    const label = cleanText(cell(raw, columns.vehicleLabel));
    if (label) vehicleLabels.add(label);
    const sourceVehicleId = cleanText(cell(raw, columns.vehicleId));
    if (sourceVehicleId) vehicleIds.add(sourceVehicleId);

    const when = combineDateTime(cell(raw, columns.date), cell(raw, columns.time));
    if (!when) {
      rejected.push({ rowNumber, reason: "תאריך לא תקין" });
      continue;
    }

    const odometer = parsePositive(cell(raw, columns.odometer));
    if (odometer === null) {
      rejected.push({ rowNumber, reason: "קילומטראז׳ חסר או לא תקין" });
      continue;
    }

    const liters = parsePositive(cell(raw, columns.liters));
    if (liters === null) {
      rejected.push({ rowNumber, reason: "כמות דלק חסרה או לא תקינה" });
      continue;
    }

    const warnings: string[] = [];

    // Price and total are mutually derivable; require at least one.
    let pricePerLiter = parsePositive(cell(raw, columns.pricePerLiter));
    let totalCost = parseNumber(cell(raw, columns.totalCost));

    if (pricePerLiter === null && totalCost !== null && totalCost > 0) {
      pricePerLiter = totalCost / liters;
    } else if (totalCost === null && pricePerLiter !== null) {
      totalCost = pricePerLiter * liters;
    }

    if (pricePerLiter === null || totalCost === null) {
      rejected.push({ rowNumber, reason: "אין מחיר לליטר ואין מחיר כולל" });
      continue;
    }

    // Raw inputs computed by a formula are usable but not typed; say so.
    const formulaRow = formulaCells[i] ?? [];
    const formulaFields = (
      [
        ["קילומטראז׳", columns.odometer],
        ["כמות דלק", columns.liters],
        ["מחיר כולל", columns.totalCost],
        ["מחיר לליטר", columns.pricePerLiter],
      ] as const
    )
      .filter(([, index]) => index !== undefined && formulaRow[index] === true)
      .map(([label]) => label);

    if (formulaFields.length > 0) {
      warnings.push(
        `שורה ${rowNumber}: ${formulaFields.join(", ")} חושבו בנוסחה בגיליון ולא הוקלדו — ` +
          `ודאו שהערך מעודכן`,
      );
    }

    // Pump rounding makes an exact match unrealistic; flag only real conflicts.
    const implied = pricePerLiter * liters;
    if (totalCost > 0 && Math.abs(implied - totalCost) > Math.max(1, totalCost * 0.05)) {
      warnings.push(
        `שורה ${rowNumber}: המחיר הכולל אינו תואם למחיר לליטר כפול הכמות`,
      );
    }

    // The legacy exporter wrote "התחלת חישוב מחדש" into the derived columns of
    // the row that opened a new calculation period. That is exactly our
    // continuityBreakBefore.
    const explicitBreak = parseBoolean(cell(raw, columns.continuityBreakBefore));
    const legacyBreak = derivedColumns.some((index) =>
      cleanText(raw[index]).includes(LEGACY_RESET_MARKER),
    );

    const declaredFull = parseBoolean(cell(raw, columns.isFullTank));

    // "-" is the legacy placeholder for "no value"; it is not a station name.
    const stationCell = cell(raw, columns.station);
    const stationName = isEmptyCell(stationCell) ? "" : cleanText(stationCell);
    const lat = parseNumber(cell(raw, columns.latitude));
    const lng = parseNumber(cell(raw, columns.longitude));
    const stationId = cleanText(cell(raw, columns.stationId));

    const notesCell = cell(raw, columns.notes);
    const notes = isEmptyCell(notesCell) ? "" : cleanText(notesCell);

    rows.push({
      rowNumber,
      date: when.getTime(),
      odometer,
      liters,
      pricePerLiter: round(pricePerLiter, 3),
      totalCost: round(totalCost, 2),
      isFullTank: declaredFull ?? true,
      fullTankSource: declaredFull === null ? "legacy-assumption" : "user",
      continuityBreakBefore: explicitBreak ?? legacyBreak,
      station:
        stationName || stationId
          ? {
              name: stationName || "תחנה ללא שם",
              ...(lat !== null ? { lat } : {}),
              ...(lng !== null ? { lng } : {}),
              stationId: stationId || null,
            }
          : null,
      fuelType: parseFuelType(cell(raw, columns.fuelType)),
      notes: notes || null,
      warnings,
    });
  }

  return {
    format,
    rows,
    rejected,
    assumptions,
    vehicleLabels: [...vehicleLabels],
    vehicleIds: [...vehicleIds],
    totalRows: rows.length + rejected.length,
    breakCount: rows.filter((row) => row.continuityBreakBefore).length,
    warnings: rows.flatMap((row) => row.warnings),
  };
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f + Number.EPSILON) / f;
}

/* ------------------------------------------------------------------ *
 * Import identity
 * ------------------------------------------------------------------ */

/**
 * FNV-1a, 64-bit. Deterministic, synchronous and dependency-free, which
 * matters because the same hash must be computable in a pure unit test, in the
 * browser and later in a backend cleanup job.
 */
function fnv1a64(input: string): string {
  const PRIME = 1099511628211n;
  const MASK = (1n << 64n) - 1n;
  let hash = 14695981039346656037n;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash ^ BigInt(input.charCodeAt(i) & 0xff)) * PRIME) & MASK;
    // Multi-byte characters contribute their high byte too, so Hebrew station
    // names are not all folded onto their low bytes.
    const high = input.charCodeAt(i) >> 8;
    if (high !== 0) hash = ((hash ^ BigInt(high)) * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * The identity of a fill-up for duplicate detection.
 *
 * Deliberately built from the fields a person would use to decide "this is the
 * same fill-up": vehicle, when, odometer, liters, cost and fuel type. Notes,
 * station and the full-tank flag are excluded so that re-importing a file the
 * user has since edited does not create a second copy.
 *
 * The date is quantised to the minute: the app stores seconds, spreadsheets
 * usually do not, and a one-second difference is not a different fill-up.
 */
export function identityHash(
  vehicleId: string,
  record: {
    date: number;
    odometer: number;
    liters: number;
    totalCost: number;
    fuelType?: FuelType | null;
  },
  /**
   * The vehicle's fuel type, used when the record does not carry its own.
   * Manually entered records have no per-record fuel type — they inherit the
   * vehicle's — so both sides must resolve it the same way or an imported row
   * would never recognise its manually entered twin.
   */
  vehicleFuelType?: FuelType | null,
): string {
  const minute = Math.floor(record.date / 60_000);
  const parts = [
    vehicleId,
    String(minute),
    record.odometer.toFixed(0),
    record.liters.toFixed(2),
    record.totalCost.toFixed(2),
    record.fuelType ?? vehicleFuelType ?? "",
  ];
  return fnv1a64(parts.join("|"));
}

/** Identity of an already-stored record, so a manual entry also de-duplicates. */
export function fillupIdentityHash(
  vehicleId: string,
  fillup: Fillup,
  vehicleFuelType?: FuelType | null,
): string {
  return fillup.importRowHash ?? identityHash(vehicleId, fillup, vehicleFuelType);
}
