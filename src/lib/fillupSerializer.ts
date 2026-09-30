/**
 * The ONE place a fill-up is turned into a Firestore document and back.
 *
 * The audits found the form spreading whole UI objects into writes: an Undo
 * after an edit sent the record's `id` as a field, which the rules whitelist
 * rejects, so "ביטול" quietly never happened; a station picked from history
 * carried whatever keys an old import left on it. Both are the same bug —
 * there was no serializer, only object spreads.
 *
 * Everything here is pure and JSON-safe. Dates travel as epoch milliseconds;
 * the "set by the server" timestamp is a sentinel string, converted to the
 * SDK's `serverTimestamp()` by the thin adapter in DataContext. That is what
 * lets the very same payload live in the outbox, be exported, be compared
 * against a server read, and be retried without a second code path.
 */

import type { Fillup, StationRef } from "./stats";
import type { OutboxPayload } from "./outbox";

export const SERVER_TIMESTAMP = "__serverTimestamp__";

/** Keys the rules accept on a fill-up. Anything else is dropped, never sent. */
export const FILLUP_KEYS = [
  "date",
  "odometer",
  "liters",
  "pricePerLiter",
  "totalCost",
  "isFullTank",
  "station",
  "notes",
  "createdAt",
  "continuityBreakBefore",
  "fullTankSource",
  "postedPricePerLiter",
  "fuelType",
  "importSource",
  "importBatchId",
  "importRowHash",
  "schemaVersion",
  "fillEndState",
  "fillEndStateSource",
  "preFillLevel",
  "preFillLevelSource",
  "preFillLevelUncertainty",
  "postFillLevel",
  "postFillLevelSource",
  "postFillLevelUncertainty",
  "refuelReason",
  "capacityLitersAtEntry",
  "tankSchemaVersion",
  // Optimistic-concurrency version: 1 on create, previous + 1 on every
  // update. The rules refuse an update whose version is not exactly the
  // stored one plus one, so a stale edit is rejected by the SERVER rather
  // than silently winning a check-then-write race.
  "version",
] as const;

const STATION_KEYS = ["name", "lat", "lng", "stationId", "brand"] as const;

/** Bounds mirrored from firestore.rules `validFillup`, kept next to each other. */
export const FILLUP_LIMITS = {
  odometerMax: 3_000_000,
  litersMax: 500,
  pricePerLiterMax: 100,
  totalCostMax: 50_000,
  notesMax: 500,
  stationNameMax: 120,
  stationIdMax: 64,
  brandMax: 60,
  /** Tolerance on liters × price vs total: the larger of ₪5 and 5%. */
  totalToleranceAbs: 5,
  totalToleranceRel: 0.05,
} as const;

const FUEL_TYPES = new Set(["95", "98", "diesel", "other"]);
const END_STATES = new Set(["full", "partial", "unknown"]);
const END_STATE_SOURCES = new Set([
  "user-confirmed",
  "gauge-estimate",
  "inferred",
  "legacy-assumption",
  "unknown",
]);
const LEVEL_SOURCES = new Set([
  "direct-gauge",
  "user-correction",
  "derived-from-full-and-liters",
  "derived-after-partial",
  "imported-legacy",
  "unknown",
]);
const REASONS = new Set(["routine", "low-fuel", "before-trip", "good-price", "unsure"]);

/**
 * A station reference with only the keys the rules accept, trimmed to their
 * limits. A record imported with an extra key on its station used to be
 * rejected the moment it was re-saved from the form.
 */
export function sanitizeStation(station: unknown): StationRef | null {
  if (!station || typeof station !== "object") return null;
  const raw = station as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;

  const out: StationRef = { name: name.slice(0, FILLUP_LIMITS.stationNameMax) };
  if (typeof raw.lat === "number" && Number.isFinite(raw.lat)) out.lat = raw.lat;
  if (typeof raw.lng === "number" && Number.isFinite(raw.lng)) out.lng = raw.lng;
  if (typeof raw.stationId === "string" && raw.stationId.trim()) {
    out.stationId = raw.stationId.trim().slice(0, FILLUP_LIMITS.stationIdMax);
  }
  if (typeof raw.brand === "string" && raw.brand.trim()) {
    out.brand = raw.brand.trim().slice(0, FILLUP_LIMITS.brandMax);
  }
  return out;
}

/** The writable part of a fill-up: no id, and creation metadata is optional. */
export type FillupWrite = Omit<Fillup, "id" | "createdAt"> & { createdAt?: number | null };

/**
 * Serialise a fill-up for writing.
 *
 * Only whitelisted keys, only defined values. `createdAt` becomes the server
 * sentinel when absent (a new record) and is preserved as a number when the
 * record already has one (a restore), so creation metadata is immutable.
 */
export function serializeFillup(
  fillup: FillupWrite,
  options: { includeCreatedAt?: boolean } = {},
): OutboxPayload {
  const source = fillup as unknown as Record<string, unknown>;
  const out: OutboxPayload = {};

  for (const key of FILLUP_KEYS) {
    if (key === "createdAt") continue;
    const value = source[key];
    if (value === undefined) continue;
    if (key === "station") {
      out.station = sanitizeStation(value);
      continue;
    }
    if (key === "notes") {
      const text = typeof value === "string" ? value.trim() : "";
      out.notes = text ? text.slice(0, FILLUP_LIMITS.notesMax) : null;
      continue;
    }
    out[key] = value;
  }

  if (options.includeCreatedAt !== false) {
    out.createdAt =
      typeof fillup.createdAt === "number" && Number.isFinite(fillup.createdAt)
        ? fillup.createdAt
        : SERVER_TIMESTAMP;
  }

  return out;
}

/**
 * The patch for an update: the serialised record WITHOUT creation metadata,
 * so an edit (or the Undo of one) can never rewrite `createdAt`, and never
 * carries `id`.
 */
export function serializeFillupPatch(fillup: FillupWrite): OutboxPayload {
  return serializeFillup(fillup, { includeCreatedAt: false });
}

/** Firestore Timestamp-like → epoch ms, or null when it is not a date at all. */
export function toEpochMillis(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (value && typeof value === "object") {
    const candidate = value as { toMillis?: () => number; seconds?: number };
    if (typeof candidate.toMillis === "function") {
      const millis = candidate.toMillis();
      return Number.isFinite(millis) ? millis : null;
    }
    if (typeof candidate.seconds === "number" && Number.isFinite(candidate.seconds)) {
      return candidate.seconds * 1000;
    }
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type ParsedFillup =
  | { ok: true; fillup: Fillup }
  | { ok: false; id: string; reason: string; raw: Record<string, unknown> };

/**
 * Read a stored document into a `Fillup`.
 *
 * A record whose date cannot be read is reported as malformed rather than
 * silently stamped with "now" — which is what the old reader did, and which
 * moved a broken record to the top of the history and into every average.
 */
export function parseFillupDocument(id: string, data: Record<string, unknown>): ParsedFillup {
  const date = toEpochMillis(data.date);
  if (date === null) {
    return { ok: false, id, reason: "התאריך של הרשומה אינו קריא", raw: data };
  }
  const odometer = numberOrNull(data.odometer);
  const liters = numberOrNull(data.liters);
  if (odometer === null || liters === null) {
    return { ok: false, id, reason: "קילומטראז׳ או ליטרים חסרים ברשומה", raw: data };
  }

  const fillup: Fillup = {
    id,
    date,
    odometer,
    liters,
    pricePerLiter: numberOrNull(data.pricePerLiter) ?? 0,
    totalCost: numberOrNull(data.totalCost) ?? 0,
    isFullTank: data.isFullTank !== false,
    station: sanitizeStation(data.station),
    notes: typeof data.notes === "string" ? data.notes : null,
    createdAt: toEpochMillis(data.createdAt) ?? undefined,
    // Absent on every pre-upgrade document, and absence must read as "no
    // break", so the default is false.
    continuityBreakBefore: data.continuityBreakBefore === true,
    fullTankSource: data.fullTankSource === "legacy-assumption" ? "legacy-assumption" : "user",
    postedPricePerLiter: numberOrNull(data.postedPricePerLiter),
    fuelType: (typeof data.fuelType === "string" && FUEL_TYPES.has(data.fuelType)
      ? data.fuelType
      : null) as Fillup["fuelType"],
    importSource: typeof data.importSource === "string" ? data.importSource : null,
    importBatchId: typeof data.importBatchId === "string" ? data.importBatchId : null,
    importRowHash: typeof data.importRowHash === "string" ? data.importRowHash : null,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,

    // Optional tank-state measurements. Absence must stay absent — a missing
    // level is a missing observation, not a zero.
    fillEndState: (typeof data.fillEndState === "string" && END_STATES.has(data.fillEndState)
      ? data.fillEndState
      : null) as Fillup["fillEndState"],
    fillEndStateSource: (typeof data.fillEndStateSource === "string" &&
    END_STATE_SOURCES.has(data.fillEndStateSource)
      ? data.fillEndStateSource
      : null) as Fillup["fillEndStateSource"],
    preFillLevel: numberOrNull(data.preFillLevel),
    preFillLevelSource: (typeof data.preFillLevelSource === "string" &&
    LEVEL_SOURCES.has(data.preFillLevelSource)
      ? data.preFillLevelSource
      : null) as Fillup["preFillLevelSource"],
    preFillLevelUncertainty: numberOrNull(data.preFillLevelUncertainty),
    postFillLevel: numberOrNull(data.postFillLevel),
    postFillLevelSource: (typeof data.postFillLevelSource === "string" &&
    LEVEL_SOURCES.has(data.postFillLevelSource)
      ? data.postFillLevelSource
      : null) as Fillup["postFillLevelSource"],
    postFillLevelUncertainty: numberOrNull(data.postFillLevelUncertainty),
    refuelReason: (typeof data.refuelReason === "string" && REASONS.has(data.refuelReason)
      ? data.refuelReason
      : null) as Fillup["refuelReason"],
    capacityLitersAtEntry: numberOrNull(data.capacityLitersAtEntry),
    tankSchemaVersion: numberOrNull(data.tankSchemaVersion),
    // Absent on every pre-upgrade document: read as 0, so the first
    // versioned update writes 1 — which is what the rules expect.
    version: numberOrNull(data.version) ?? 0,
  };

  return { ok: true, fillup };
}

/** A fill-up rebuilt from an outbox payload, for showing and editing it. */
export function fillupFromPayload(id: string, payload: OutboxPayload): Fillup | null {
  const parsed = parseFillupDocument(id, payload);
  return parsed.ok ? parsed.fillup : null;
}

/* ------------------------------------------------------------------ *
 * Client-side validation, mirroring the rules field by field
 * ------------------------------------------------------------------ */

export type FillupField =
  | "date"
  | "odometer"
  | "liters"
  | "pricePerLiter"
  | "totalCost"
  | "notes"
  | "station"
  | "postedPricePerLiter"
  | "tank";

export interface FieldError {
  field: FillupField;
  message: string;
}

const isFinitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function levelOk(value: unknown): boolean {
  return value == null || (typeof value === "number" && value >= 0 && value <= 1);
}

/**
 * Every constraint the server enforces, with a field-specific Hebrew message.
 *
 * The form shows these BEFORE sending, so a document the rules would reject
 * never leaves the device as a doomed write. The rules stay the authority;
 * this only makes their answer arrive early and legibly.
 */
export function validateFillupPayload(payload: OutboxPayload): FieldError[] {
  const errors: FieldError[] = [];
  const fmt = (n: number) => n.toLocaleString("he-IL");

  const date = payload.date;
  if (typeof date !== "number" || !Number.isFinite(date)) {
    errors.push({ field: "date", message: "יש להזין תאריך תקין" });
  }

  const odometer = payload.odometer;
  if (!isFinitePositive(odometer)) {
    errors.push({ field: "odometer", message: "יש להזין קילומטראז׳ תקין" });
  } else if (odometer >= FILLUP_LIMITS.odometerMax) {
    errors.push({
      field: "odometer",
      message: `הקילומטראז׳ חייב להיות קטן מ־${fmt(FILLUP_LIMITS.odometerMax)}`,
    });
  }

  const liters = payload.liters;
  if (!isFinitePositive(liters)) {
    errors.push({ field: "liters", message: "יש להזין כמות ליטרים תקינה" });
  } else if (liters > FILLUP_LIMITS.litersMax) {
    errors.push({ field: "liters", message: `כמות הליטרים חייבת להיות עד ${FILLUP_LIMITS.litersMax}` });
  }

  const price = payload.pricePerLiter;
  if (!isFiniteNonNegative(price)) {
    errors.push({ field: "pricePerLiter", message: "יש להזין מחיר לליטר תקין" });
  } else if (price > FILLUP_LIMITS.pricePerLiterMax) {
    errors.push({
      field: "pricePerLiter",
      message: `המחיר לליטר חייב להיות עד ₪${FILLUP_LIMITS.pricePerLiterMax}`,
    });
  }

  const total = payload.totalCost;
  if (!isFiniteNonNegative(total)) {
    errors.push({ field: "totalCost", message: "יש להזין סכום תקין" });
  } else if (total > FILLUP_LIMITS.totalCostMax) {
    errors.push({
      field: "totalCost",
      message: `הסכום חייב להיות עד ₪${fmt(FILLUP_LIMITS.totalCostMax)}`,
    });
  } else if (
    total !== 0 &&
    isFinitePositive(liters) &&
    isFiniteNonNegative(price)
  ) {
    const expected = liters * price;
    const tolerance = FILLUP_LIMITS.totalToleranceAbs + expected * FILLUP_LIMITS.totalToleranceRel;
    if (Math.abs(total - expected) > tolerance) {
      errors.push({
        field: "totalCost",
        message: `הסכום (₪${total.toFixed(2)}) לא מסתדר עם ${liters} ל׳ × ₪${price} = ₪${expected.toFixed(2)}`,
      });
    }
  }

  const posted = payload.postedPricePerLiter;
  if (posted != null) {
    if (!isFiniteNonNegative(posted) || posted > FILLUP_LIMITS.pricePerLiterMax) {
      errors.push({ field: "postedPricePerLiter", message: "מחיר המשאבה אינו תקין" });
    }
  }

  const notes = payload.notes;
  if (notes != null && (typeof notes !== "string" || notes.length > FILLUP_LIMITS.notesMax)) {
    errors.push({ field: "notes", message: `ההערה ארוכה מדי (עד ${FILLUP_LIMITS.notesMax} תווים)` });
  }

  const station = payload.station;
  if (station != null) {
    const record = station as Record<string, unknown>;
    const keys = Object.keys(record);
    const unknown = keys.filter((key) => !(STATION_KEYS as readonly string[]).includes(key));
    if (
      unknown.length > 0 ||
      typeof record.name !== "string" ||
      record.name.length === 0 ||
      record.name.length > FILLUP_LIMITS.stationNameMax
    ) {
      errors.push({ field: "station", message: "פרטי התחנה אינם תקינים" });
    }
  }

  const tankFieldsOk =
    levelOk(payload.preFillLevel) &&
    levelOk(payload.postFillLevel) &&
    levelOk(payload.preFillLevelUncertainty) &&
    levelOk(payload.postFillLevelUncertainty) &&
    (payload.fillEndState == null || END_STATES.has(String(payload.fillEndState))) &&
    (payload.fillEndStateSource == null ||
      END_STATE_SOURCES.has(String(payload.fillEndStateSource))) &&
    (payload.preFillLevelSource == null || LEVEL_SOURCES.has(String(payload.preFillLevelSource))) &&
    (payload.postFillLevelSource == null ||
      LEVEL_SOURCES.has(String(payload.postFillLevelSource))) &&
    (payload.refuelReason == null || REASONS.has(String(payload.refuelReason))) &&
    (payload.capacityLitersAtEntry == null ||
      (isFinitePositive(payload.capacityLitersAtEntry) && payload.capacityLitersAtEntry <= 500)) &&
    (payload.tankSchemaVersion == null ||
      (typeof payload.tankSchemaVersion === "number" && payload.tankSchemaVersion >= 1));
  if (!tankFieldsOk) {
    errors.push({ field: "tank", message: "מצב המיכל אינו תקין — נקו את הסעיף ונסו שוב" });
  }

  const version = payload.version;
  if (version != null && !(typeof version === "number" && Number.isInteger(version) && version >= 1)) {
    errors.push({ field: "tank", message: "גרסת הרשומה אינה תקינה" });
  }

  for (const key of Object.keys(payload)) {
    if (!(FILLUP_KEYS as readonly string[]).includes(key)) {
      errors.push({ field: "tank", message: `שדה לא מוכר ברשומה: ${key}` });
    }
  }

  return errors;
}

/* ------------------------------------------------------------------ *
 * Comparison, for reconciling an outbox entry with a server read
 * ------------------------------------------------------------------ */

/**
 * Content comparison ignores creation metadata (the server stamps it) and the
 * concurrency version (two writes with identical content are the same
 * content whichever version number carried them).
 */
const COMPARED_KEYS = FILLUP_KEYS.filter((key) => key !== "createdAt" && key !== "version");

function sameValue(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) if (!sameValue(left[key], right[key])) return false;
    return true;
  }
  return a === b;
}

/**
 * True when a server document carries the same content as a serialised
 * payload. Creation metadata is ignored (the server stamps it); the `date`
 * on the server side may be a Timestamp-like object.
 */
export function fillupPayloadMatches(payload: OutboxPayload, server: OutboxPayload): boolean {
  for (const key of COMPARED_KEYS) {
    const mine = payload[key];
    const theirs = key === "date" ? toEpochMillis(server[key]) : server[key];
    if (!sameValue(mine === undefined ? null : mine, theirs === undefined ? null : theirs)) {
      return false;
    }
  }
  return true;
}
