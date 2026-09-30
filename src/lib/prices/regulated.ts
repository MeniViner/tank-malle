import type { FuelType, FuelPrices, Vehicle } from "../stats";
import { monthKey } from "../stats";
import { heMonthName } from "../format";
import type { ServiceMode } from "./types";

/**
 * The government-regulated maximum.
 *
 * In Israel this is a real, published figure for exactly one product:
 * **95-octane petrol, self-service, mainland**. There is no regulated price for
 * 98, for diesel, or for Eilat's different tax treatment.
 *
 * That is the whole reason this module exists. The previous model held one
 * price and one history map with no fuel dimension at all, so every screen that
 * wanted "the official price" for a diesel car got the 95 figure.
 *
 * This module is also the ONE place a price suggestion or an "official"
 * comparison figure comes from: `suggestPricePerLiter` for the fill-up form
 * and settings, `officialPriceFor` for the home card and the statistics.
 * Three screens used to read three different fields of the same document and
 * give three different answers; now they all ask here.
 */

/** A manual admin entry, scoped to one month. Never labelled "מפוקח". */
export interface ManualOverride {
  pricePerLiter: number;
  /** The month it applies to, e.g. "2026-09". Outside it, it does not win. */
  month: string;
  /** Epoch ms of the entry. */
  setAt: number;
  note?: string | null;
}

/** Fuel-type-aware config. Each entry is a month-keyed series with a source. */
export interface RegulatedSeries {
  /**
   * Month key → ₪/litre, e.g. { "2026-08": 7.31 }. The EFFECTIVE price per
   * month: inside its own month a manual override wins here.
   */
  history: Record<string, number>;
  current?: {
    pricePerLiter: number;
    effectiveFrom?: number;
    /** When we last wrote it, so staleness can be reported truthfully. */
    updatedAt?: number;
  } | null;
  /** Where the LATEST write came from. "manual" is the honest answer on Spark. */
  source?: "manual" | "scheduled" | "import";
  /** When the source was last read, as opposed to when we stored it. */
  retrievedAt?: number;
  /** An admin's entry for one month. See docs/PRICE-SOURCE-AND-CONFIDENCE-MODEL.md §9. */
  manualOverride?: ManualOverride | null;
  /**
   * What the scheduled job read, per month — kept even when a manual override
   * wins, so the automatic value can be restored and the override audited.
   */
  scheduledHistory?: Record<string, number>;
}

/** What the daily job reports about itself. Written on every run, success or not. */
export interface PriceAutomation {
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastError?: string | null;
  lastReadMonth?: string | null;
  lastReadPrice?: number | null;
  /** "direct" or "proxy" — which route reached gov.il. */
  lastVia?: string | null;
  targetProjectId?: string | null;
}

export interface RegulatedPriceConfig {
  /** fuelType → serviceMode → series. Sparse: absence means "unknown". */
  byFuelType?: Partial<
    Record<FuelType, Partial<Record<ServiceMode, RegulatedSeries>>>
  >;
  /** Region key, for a future Eilat series. Absent means mainland. */
  region?: string;
  /** Legacy top-level shape, read through the adapter below. */
  current?: FuelPrices["current"];
  history?: FuelPrices["history"];
  /**
   * Legacy top-level source tag: the job writes "gov.il", the seed script
   * "manual-seed". Only consulted when no per-fuel series exists.
   */
  source?: string;
  automation?: PriceAutomation | null;
}

/**
 * The one product the Israeli regulated maximum actually covers.
 * Anything outside this is "unknown", not "the 95 number".
 */
export const REGULATED_FUEL_TYPE: FuelType = "95";
export const REGULATED_SERVICE_MODE: ServiceMode = "self";

export const REGULATED_LABEL = "מחיר מרבי מפוקח";
export const REGULATED_LABEL_FULL = "מחיר מרבי מפוקח לבנזין 95 בשירות עצמי";
export const MANUAL_LABEL = "מחיר שהוזן ידנית";
export const MANUAL_LABEL_FULL = "מחיר שהוזן ידנית על ידי מנהל המערכת";

/** "ספטמבר", or "ספטמבר 2025" when the month is not in `relativeTo`'s year. */
export function priceMonthLabel(
  month: string | null | undefined,
  relativeTo: number = Date.now(),
): string {
  if (!month) return "";
  const [year, monthNumber] = month.split("-").map(Number);
  const name = heMonthName(monthNumber);
  if (!name) return month;
  return year === new Date(relativeTo).getFullYear() ? name : `${name} ${year}`;
}

/**
 * Read the legacy `appConfig/fuelPrices` document into the fuel-type-aware
 * shape.
 *
 * The old document has no fuel dimension. The only defensible reading is that
 * it always meant 95 self-service — which is what the admin editor and the
 * seed script were entering — so it is filed there and nowhere else. It is
 * never copied across to 98 or diesel.
 */
export function adaptLegacyConfig(
  legacy: FuelPrices | RegulatedPriceConfig | null | undefined,
): RegulatedPriceConfig {
  if (!legacy) return { byFuelType: {} };

  const typed = legacy as RegulatedPriceConfig;
  const byFuelType: NonNullable<RegulatedPriceConfig["byFuelType"]> = {
    ...(typed.byFuelType ?? {}),
  };

  const hasLegacyTopLevel =
    typed.current != null || (typed.history && Object.keys(typed.history).length > 0);

  if (hasLegacyTopLevel) {
    const existing = byFuelType[REGULATED_FUEL_TYPE]?.[REGULATED_SERVICE_MODE];
    byFuelType[REGULATED_FUEL_TYPE] = {
      ...byFuelType[REGULATED_FUEL_TYPE],
      [REGULATED_SERVICE_MODE]: {
        // Everything the explicit series carries (override, scheduled
        // history, …) survives untouched.
        ...existing,
        // An explicit fuel-type-aware entry wins; the legacy fields only fill
        // gaps, so a migration cannot lose newer data.
        history: { ...(typed.history ?? {}), ...(existing?.history ?? {}) },
        current: existing?.current ?? typed.current ?? null,
        // The job tags its legacy write "gov.il"; anything else was typed in.
        source: existing?.source ?? (typed.source === "gov.il" ? "scheduled" : "manual"),
        retrievedAt: existing?.retrievedAt,
      },
    };
  }

  return { ...typed, byFuelType };
}

/**
 * Firestore timestamps → epoch milliseconds, everywhere in the price document.
 *
 * The document is read in two places (the app's live listener and the admin
 * console) and every consumer of it — freshness text, staleness checks — does
 * date arithmetic on `updatedAt`. A Timestamp object reaching them produces
 * "NaN" on screen, which is how this was found. Duck-typed on purpose: this
 * module stays free of the Firebase SDK so the price rules can be unit tested
 * without it.
 */
function millis(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object") {
    const candidate = value as { toMillis?: () => number; seconds?: number };
    if (typeof candidate.toMillis === "function") return candidate.toMillis();
    if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  }
  return undefined;
}

function numberMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function normalizeOverride(raw: unknown): ManualOverride | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const override = raw as ManualOverride;
  const price = Number(override.pricePerLiter);
  if (!Number.isFinite(price) || typeof override.month !== "string") return undefined;
  return {
    pricePerLiter: price,
    month: override.month,
    setAt: millis(override.setAt) ?? 0,
    note: override.note ?? null,
  };
}

function normalizeSeries(raw: unknown): RegulatedSeries | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const series = raw as RegulatedSeries;
  const price = Number(series.current?.pricePerLiter);

  const normalized: RegulatedSeries = {
    history: numberMap(series.history),
    current: Number.isFinite(price)
      ? {
          pricePerLiter: price,
          effectiveFrom: millis(series.current?.effectiveFrom),
          updatedAt: millis(series.current?.updatedAt),
        }
      : null,
    source: series.source,
    retrievedAt: millis(series.retrievedAt),
  };
  const override = normalizeOverride(series.manualOverride);
  if (override !== undefined) normalized.manualOverride = override;
  if (series.scheduledHistory && typeof series.scheduledHistory === "object") {
    normalized.scheduledHistory = numberMap(series.scheduledHistory);
  }
  return normalized;
}

function normalizeAutomation(raw: unknown): PriceAutomation | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  const readPrice = Number(a.lastReadPrice);
  return {
    lastAttemptAt: millis(a.lastAttemptAt),
    lastSuccessAt: millis(a.lastSuccessAt),
    lastFailureAt: millis(a.lastFailureAt),
    lastError: typeof a.lastError === "string" ? a.lastError : null,
    lastReadMonth: typeof a.lastReadMonth === "string" ? a.lastReadMonth : null,
    lastReadPrice: Number.isFinite(readPrice) && a.lastReadPrice != null ? readPrice : null,
    lastVia: typeof a.lastVia === "string" ? a.lastVia : null,
    targetProjectId: typeof a.targetProjectId === "string" ? a.targetProjectId : null,
  };
}

/** The stored `appConfig/fuelPrices` document, with every date as a number. */
export function normalizePriceDocument(raw: unknown): RegulatedPriceConfig {
  if (!raw || typeof raw !== "object") return { byFuelType: {} };
  const data = raw as RegulatedPriceConfig;

  const byFuelType: NonNullable<RegulatedPriceConfig["byFuelType"]> = {};
  for (const [fuelType, modes] of Object.entries(data.byFuelType ?? {})) {
    const normalized: Record<string, RegulatedSeries> = {};
    for (const [mode, series] of Object.entries(modes ?? {})) {
      const value = normalizeSeries(series);
      if (value) normalized[mode] = value;
    }
    byFuelType[fuelType as FuelType] = normalized as NonNullable<
      RegulatedPriceConfig["byFuelType"]
    >[FuelType];
  }

  const currentPrice = Number(data.current?.pricePerLiter);
  const automation = normalizeAutomation(data.automation);

  return {
    byFuelType,
    region: data.region,
    current: Number.isFinite(currentPrice)
      ? {
          pricePerLiter: currentPrice,
          effectiveFrom: millis(data.current?.effectiveFrom),
          updatedAt: millis(data.current?.updatedAt),
        }
      : null,
    history: numberMap(data.history),
    source: typeof data.source === "string" ? data.source : undefined,
    ...(automation !== undefined ? { automation } : {}),
  };
}

export interface RegulatedLookup {
  price: number | null;
  /** True when the figure is that month's own record, not a carried-forward one. */
  fromHistory: boolean;
  effectiveMonth: string | null;
  updatedAt: number | null;
  source: RegulatedSeries["source"] | null;
  /**
   * True when the figure was typed in by an admin (a manual override for the
   * month, or a series whose last write was manual). Such a figure is never
   * presented as the regulated maximum.
   */
  isManual: boolean;
  /** True only for the one product Israel regulates AND a non-manual figure. */
  isRegulated: boolean;
}

const MISSING: RegulatedLookup = {
  price: null,
  fromHistory: false,
  effectiveMonth: null,
  updatedAt: null,
  source: null,
  isManual: false,
  isRegulated: false,
};

/** Whether a series' latest write was a hand entry. Unknown counts as manual. */
function seriesIsManual(series: RegulatedSeries): boolean {
  return series.source !== "scheduled" && series.source !== "import";
}

/**
 * The regulated maximum for one fuel type, service mode and month.
 *
 * Returns null — meaning "unknown" — whenever there is no authoritative figure
 * for that exact combination. There is deliberately no cross-fuel fallback:
 * showing the 95 ceiling to a diesel driver would be a fabrication.
 *
 * A manual override wins inside its own month only. For any other month the
 * month's record, then the carried-forward current price, answer as before.
 */
export function regulatedMaxPrice(
  config: RegulatedPriceConfig | null | undefined,
  fuelType: FuelType,
  date: number,
  serviceMode: ServiceMode = REGULATED_SERVICE_MODE,
): RegulatedLookup {
  const series = config?.byFuelType?.[fuelType]?.[serviceMode];
  if (!series) return MISSING;

  const regulable =
    fuelType === REGULATED_FUEL_TYPE && serviceMode === REGULATED_SERVICE_MODE;
  const key = monthKey(date);

  const override = series.manualOverride;
  if (
    override &&
    override.month === key &&
    Number.isFinite(override.pricePerLiter) &&
    override.pricePerLiter > 0
  ) {
    return {
      price: override.pricePerLiter,
      fromHistory: true,
      effectiveMonth: key,
      updatedAt: override.setAt || series.current?.updatedAt || null,
      source: "manual",
      isManual: true,
      isRegulated: false,
    };
  }

  const historic = series.history?.[key];
  if (typeof historic === "number" && Number.isFinite(historic)) {
    // A month the job wrote stays "automatic" even after a later manual
    // write flipped the series' source — the scheduled record says so.
    const scheduled = series.scheduledHistory?.[key];
    const isManual =
      typeof scheduled === "number" && scheduled === historic ? false : seriesIsManual(series);
    return {
      price: historic,
      fromHistory: true,
      effectiveMonth: key,
      updatedAt: series.current?.updatedAt ?? null,
      source: series.source ?? null,
      isManual,
      isRegulated: regulable && !isManual,
    };
  }

  const current = series.current?.pricePerLiter;
  if (typeof current === "number" && Number.isFinite(current)) {
    const isManual = seriesIsManual(series);
    return {
      price: current,
      fromHistory: false,
      effectiveMonth: series.current?.effectiveFrom
        ? monthKey(series.current.effectiveFrom)
        : latestMonth(series.history),
      updatedAt: series.current?.updatedAt ?? null,
      source: series.source ?? null,
      isManual,
      isRegulated: regulable && !isManual,
    };
  }

  return MISSING;
}

function latestMonth(history: Record<string, number> | undefined): string | null {
  const keys = Object.keys(history ?? {}).sort();
  return keys.length ? keys[keys.length - 1] : null;
}

/** True when a regulated figure exists at all for this fuel type. */
export function hasRegulatedPrice(
  config: RegulatedPriceConfig | null | undefined,
  fuelType: FuelType,
  serviceMode: ServiceMode = REGULATED_SERVICE_MODE,
): boolean {
  const series = config?.byFuelType?.[fuelType]?.[serviceMode];
  if (!series) return false;
  return (
    Object.keys(series.history ?? {}).length > 0 ||
    typeof series.current?.pricePerLiter === "number" ||
    typeof series.manualOverride?.pricePerLiter === "number"
  );
}

/**
 * Honest freshness copy for the regulated figure.
 *
 * Says when the figure was last written and by whom, rather than promising an
 * update that may not come.
 */
export function regulatedFreshnessText(
  lookup: RegulatedLookup,
  now: number = Date.now(),
): string {
  if (lookup.price === null) return "טרם הוזן מחיר מרבי מפוקח";
  if (lookup.updatedAt === null) return "מקור העדכון לא ידוע";

  const updated = new Date(lookup.updatedAt);
  const current = new Date(now);
  const sameMonth =
    updated.getFullYear() === current.getFullYear() &&
    updated.getMonth() === current.getMonth();

  if (lookup.source === "scheduled") {
    return sameMonth ? "עודכן אוטומטית החודש" : "לא עודכן אוטומטית החודש";
  }
  return sameMonth ? "המחיר עודכן ידנית" : "המחיר לא עודכן החודש";
}

/* ------------------------------------------------------------------ *
 * The one entry point for a price suggestion
 * ------------------------------------------------------------------ */

export type PriceSuggestionSource =
  /** The vehicle's legacy fixed price. Replaces everything else. */
  | "legacyManual"
  /** The official figure plus the vehicle's legacy fixed adjustment. */
  | "legacyAdjusted"
  /** The regulated maximum for 95 self-service, written by the job. */
  | "regulatedMax"
  /** A figure an admin typed in — for any fuel type. Never "מפוקח". */
  | "manualConfig"
  /** No official figure exists for this fuel type, and nothing was entered. */
  | "unsupportedFuelType"
  /** 95, but no figure at all. */
  | "none";

export interface PriceSuggestion {
  price: number | null;
  source: PriceSuggestionSource;
  /** True when the figure is the month's own record rather than a carry-over. */
  fromHistory: boolean;
  /** The month the figure belongs to, which may not be the requested one. */
  effectiveMonth: string | null;
  /** The fuel type the figure applies to, so a caller cannot misattribute it. */
  fuelType: FuelType;
  updatedAt: number | null;
  isRegulated: boolean;
  /** True when the figure is a manual admin entry (never shown as "מפוקח"). */
  isManual: boolean;
  /** Hebrew source text for the form. Names the month and any fallback. */
  label: string;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** "לבנזין 95", "לסולר" … for the label copy. */
const FUEL_FOR: Record<FuelType, string> = {
  "95": "לבנזין 95",
  "98": "לבנזין 98",
  diesel: "לסולר",
  other: "לסוג דלק זה",
};

/**
 * The label for an official figure alone: what it is, and — when it is a
 * carry-over — which month it really belongs to.
 */
export function describeOfficialPrice(
  official: Pick<RegulatedLookup, "price" | "isManual" | "fromHistory" | "effectiveMonth">,
  date: number = Date.now(),
): string {
  if (official.price === null) return "אין מחיר רשמי";
  const month = priceMonthLabel(official.effectiveMonth, date);
  if (!official.fromHistory) {
    return month ? `לפי המחיר האחרון הידוע · ${month}` : "לפי המחיר האחרון הידוע";
  }
  const base = official.isManual ? MANUAL_LABEL : REGULATED_LABEL;
  return month ? `${base} · ${month}` : base;
}

/**
 * The price the fill-up form (and the settings screen) should propose for a
 * vehicle on a date. Precedence:
 *
 *   1. the vehicle's legacy manual price, replacing everything
 *   2. the stored series for the vehicle's OWN fuel type and that month:
 *      an admin's entry → `manualConfig`; the job's 95 figure → `regulatedMax`
 *   3. + the vehicle's legacy fixed adjustment → `legacyAdjusted`
 *
 * No cross-fuel fallback, ever. A figure that is not the month's own record
 * says so in its label and names the month it does belong to.
 */
export function suggestPricePerLiter(
  date: number,
  vehicle:
    | Pick<Vehicle, "priceAdjustment" | "manualPricePerLiter" | "fuelType">
    | null
    | undefined,
  config: RegulatedPriceConfig | FuelPrices | null | undefined,
): PriceSuggestion {
  const fuelType = vehicle?.fuelType ?? REGULATED_FUEL_TYPE;

  if (vehicle?.manualPricePerLiter && vehicle.manualPricePerLiter > 0) {
    return {
      price: round(vehicle.manualPricePerLiter, 3),
      source: "legacyManual",
      fromHistory: false,
      effectiveMonth: null,
      fuelType,
      updatedAt: null,
      isRegulated: false,
      isManual: false,
      label: "מחיר קבוע שהוגדר ברכב · ניתן לשינוי בהגדרות הרכב",
    };
  }

  const lookup = regulatedMaxPrice(adaptLegacyConfig(config), fuelType, date);
  const common = {
    fromHistory: lookup.fromHistory,
    effectiveMonth: lookup.effectiveMonth,
    fuelType,
    updatedAt: lookup.updatedAt,
    isRegulated: lookup.isRegulated,
    isManual: lookup.isManual,
  };

  if (lookup.price === null) {
    if (fuelType !== REGULATED_FUEL_TYPE) {
      return {
        ...common,
        price: null,
        source: "unsupportedFuelType",
        label: `אין מחיר מרבי מפוקח ${FUEL_FOR[fuelType] ?? FUEL_FOR.other} — הזינו את המחיר ששילמתם`,
      };
    }
    return {
      ...common,
      price: null,
      source: "none",
      label: "לא הוזן מחיר מרבי מפוקח — הזינו את המחיר ששילמתם",
    };
  }

  const month = priceMonthLabel(lookup.effectiveMonth, date);
  const withMonth = (text: string) => (month ? `${text} · ${month}` : text);

  // What the figure is, before any personal adjustment is described.
  const basis = lookup.isManual
    ? lookup.fromHistory
      ? withMonth(MANUAL_LABEL_FULL)
      : withMonth("לפי המחיר האחרון הידוע שהוזן ידנית")
    : lookup.fromHistory
      ? withMonth(`מחיר מרבי מפוקח ${FUEL_FOR[REGULATED_FUEL_TYPE]}`)
      : withMonth("לפי המחיר המרבי המפוקח האחרון הידוע");

  const adjustment = vehicle?.priceAdjustment ?? 0;
  if (adjustment !== 0) {
    return {
      ...common,
      price: round(Math.max(0, lookup.price + adjustment), 3),
      source: "legacyAdjusted",
      label: `${basis} + התאמה קבועה`,
    };
  }

  return {
    ...common,
    price: round(lookup.price, 3),
    source: lookup.isManual ? "manualConfig" : "regulatedMax",
    label: basis,
  };
}

/**
 * The official figure to compare a paid price against, for a fuel type on a
 * date. Date-matched: a fill-up from July is compared with July's figure, not
 * today's. `isRegulated` is false for anything an admin typed in, and for any
 * fuel type Israel does not regulate.
 */
export function officialPriceFor(
  config: RegulatedPriceConfig | FuelPrices | null | undefined,
  fuelType: FuelType,
  date: number,
): {
  price: number | null;
  isRegulated: boolean;
  isManual: boolean;
  fromHistory: boolean;
  effectiveMonth: string | null;
  updatedAt: number | null;
} {
  const lookup = regulatedMaxPrice(adaptLegacyConfig(config), fuelType, date);
  return {
    price: lookup.price,
    isRegulated: lookup.isRegulated,
    isManual: lookup.isManual,
    fromHistory: lookup.fromHistory,
    effectiveMonth: lookup.effectiveMonth,
    updatedAt: lookup.updatedAt,
  };
}
