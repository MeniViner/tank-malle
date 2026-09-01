/**
 * Value normalisation for imported spreadsheets.
 *
 * Real exports are full of presentation characters that are invisible in a
 * spreadsheet view and fatal to Number.parseFloat: Unicode bidi marks around
 * every RTL-embedded number, non-breaking spaces between the amount and the
 * currency symbol, Hebrew unit words glued to the value, thousands separators,
 * and a hyphen standing in for "no value".
 *
 * Everything here is pure and unit-tested against the shapes the attached
 * legacy workbook actually contains.
 */

/**
 * Bidi control characters. Excel and Google Sheets embed these around numbers
 * inside RTL text; they survive export and make "‏192.70 ‏₪" a 10-character
 * string that looks like an 8-character one.
 *
 * U+200E LRM · U+200F RLM · U+061C ALM · U+202A–U+202E embeddings/overrides
 * · U+2066–U+2069 isolates · U+FEFF BOM
 */
const BIDI_MARKS = /[‎‏؜‪-‮⁦-⁩﻿]/g;

/** U+00A0 NBSP · U+202F narrow NBSP · U+2007 figure space · U+200B ZWSP */
const ODD_SPACES = /[   ​]/g;

/** Currency symbols that may sit on either side of the number. */
const CURRENCY = /[₪$€£]/g;

/**
 * Hebrew (and English) unit words that appear inside a value cell.
 * Ordered longest-first so "ליטר/100 ק״מ" is stripped before "ליטר".
 */
const UNIT_WORDS = [
  "ליטר/100 ק״מ",
  'ליטר/100 ק"מ',
  "ק״מ/ליטר",
  'ק"מ/ליטר',
  "קמ״ל",
  'קמ"ל',
  "ק״מ",
  'ק"מ',
  "ליטר",
  "ל׳",
  "ימים",
  "יום",
  "km/l",
  "km",
  "l",
];

/** Strings that mean "this cell is empty". */
const EMPTY_TOKENS = new Set(["", "-", "–", "—", "‒", "n/a", "na", "null", "none", "#n/a"]);

/**
 * Strip presentation characters and return the bare text.
 * Never throws; a non-string input is coerced.
 */
export function cleanText(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .replace(BIDI_MARKS, "")
    .replace(ODD_SPACES, " ")
    .trim();
}

/** True when the cell carries no value, including the legacy "-" placeholder. */
export function isEmptyCell(raw: unknown): boolean {
  return EMPTY_TOKENS.has(cleanText(raw).toLowerCase());
}

/** Strip currency symbols and unit words, leaving the numeric run. */
function stripUnits(text: string): string {
  let out = text.replace(CURRENCY, " ");
  for (const unit of UNIT_WORDS) {
    out = out.split(unit).join(" ");
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Decide what a comma means, then parse.
 *
 * - Both "." and "," present → the LAST one is the decimal separator.
 * - Only "," present, more than once → thousands separators.
 * - Only "," present, once, followed by exactly three digits → thousands
 *   ("201,050" is an odometer, not 201.05).
 * - Only "," present, once, otherwise → decimal ("7,02" → 7.02).
 *
 * "1,500" meaning one-and-a-half is genuinely ambiguous; thousands wins,
 * which is the right default for odometers and money.
 */
function normaliseSeparators(text: string): string {
  const hasDot = text.includes(".");
  const commas = (text.match(/,/g) ?? []).length;

  if (commas === 0) return text;

  if (hasDot) {
    const lastDot = text.lastIndexOf(".");
    const lastComma = text.lastIndexOf(",");
    return lastComma > lastDot
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  }

  if (commas > 1) return text.replace(/,/g, "");

  const after = text.slice(text.indexOf(",") + 1).replace(/\D/g, "");
  return after.length === 3 ? text.replace(",", "") : text.replace(",", ".");
}

/**
 * Parse a number out of a spreadsheet cell.
 * Returns null for an empty cell or anything that is not a number.
 */
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (isEmptyCell(raw)) return null;

  const stripped = stripUnits(cleanText(raw));
  // Keep digits, separators and a leading sign; drop anything else that
  // survived (stray letters, percent signs, parentheses).
  const candidate = normaliseSeparators(stripped).replace(/[^\d.\-+]/g, "");
  if (candidate === "" || candidate === "-" || candidate === "+") return null;

  const parsed = Number.parseFloat(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse a positive number; returns null for zero, negatives and non-numbers. */
export function parsePositive(raw: unknown): number | null {
  const value = parseNumber(raw);
  return value !== null && value > 0 ? value : null;
}

/* ------------------------------------------------------------------ *
 * Dates and times
 * ------------------------------------------------------------------ */

/**
 * Excel stores dates as days since 1899-12-30 (the "1900 system", including
 * its deliberate leap-year bug, which the 1899-12-30 epoch already accounts
 * for). Values below this are far more likely to be a plain number than a
 * date, so the caller decides when to apply this.
 */
export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2_958_465) return null;
  const days = Math.floor(serial);
  const millisInDay = Math.round((serial - days) * 86_400_000);
  const utc = Date.UTC(1899, 11, 30) + days * 86_400_000;
  // Read back as local wall-clock time: a spreadsheet date has no timezone,
  // and the user means the date they typed.
  const asUtc = new Date(utc + millisInDay);
  return new Date(
    asUtc.getUTCFullYear(),
    asUtc.getUTCMonth(),
    asUtc.getUTCDate(),
    asUtc.getUTCHours(),
    asUtc.getUTCMinutes(),
    asUtc.getUTCSeconds(),
  );
}

/** { hours, minutes } from "15:45", "15:45:30", "9:5" or an Excel day fraction. */
export function parseTime(raw: unknown): { hours: number; minutes: number } | null {
  if (isEmptyCell(raw)) return null;

  // A bare fraction of a day, which is how Excel stores a time-only cell.
  if (typeof raw === "number") {
    if (raw < 0 || raw >= 1) return null;
    const totalMinutes = Math.round(raw * 1440);
    return { hours: Math.floor(totalMinutes / 60) % 24, minutes: totalMinutes % 60 };
  }

  const text = cleanText(raw);
  const match = text.match(/^(\d{1,2})[:.](\d{1,2})(?:[:.](\d{1,2}))?/);
  if (!match) return null;

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Parse a date cell. Accepts an Excel serial, an ISO string, DD/MM/YYYY and
 * YYYY-MM-DD, with or without a trailing time.
 *
 * Day-first is assumed for slash and dot formats: the source is an Israeli
 * spreadsheet, where DD/MM/YYYY is the convention. When the first component is
 * unambiguously a year (four digits) that reading wins instead.
 */
export function parseDate(raw: unknown): Date | null {
  if (isEmptyCell(raw)) return null;

  if (typeof raw === "number") return excelSerialToDate(raw);

  const text = cleanText(raw);

  // YYYY-MM-DD [HH:MM[:SS]]
  const iso = text.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (iso) {
    return makeDate(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      Number(iso[4] ?? 0),
      Number(iso[5] ?? 0),
      Number(iso[6] ?? 0),
    );
  }

  // DD/MM/YYYY [HH:MM[:SS]] — also accepts a two-digit year.
  const dmy = text.match(
    /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return makeDate(
      year,
      Number(dmy[2]),
      Number(dmy[1]),
      Number(dmy[4] ?? 0),
      Number(dmy[5] ?? 0),
      Number(dmy[6] ?? 0),
    );
  }

  return null;
}

function makeDate(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  seconds: number,
): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, hours, minutes, seconds, 0);
  // Reject 31/02 and friends rather than silently rolling into March.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** Combine a date cell and a separate time cell into one instant. */
export function combineDateTime(dateCell: unknown, timeCell: unknown): Date | null {
  const date = parseDate(dateCell);
  if (!date) return null;

  const time = parseTime(timeCell);
  if (time) {
    date.setHours(time.hours, time.minutes, 0, 0);
  } else if (typeof dateCell !== "number") {
    // A date-only string with no time column: leave whatever the date parser
    // found (midnight for a bare date, the embedded time otherwise).
  }
  return date;
}
