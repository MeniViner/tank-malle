import { vehicleDiscount, discountedPrice, discountLabel } from './discount';
import type { FuelType, FuelPrices, Vehicle } from "../stats";
import { heMonthName } from "../format";
import { isOfficialNotice, israelMidnight, israelMonthKey, noticeFromReading, NOTICE_FRESHNESS_MS, priceTimeline, type OfficialPriceNotice, type PublicPriceReading, type PublicPriceSnapshot } from './publicSource';
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
  /** Effective timestamp → price, including changes inside a month. */
  timeline?: Record<string, number>;
  /** Official dated notices, including future prices. Never copied early into current/history. */
  notices?: Record<string, OfficialPriceNotice>;
  sourceUrl?: string | null;
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
    timeline: numberMap(series.timeline),
    notices: normalizeNotices(series.notices),
    sourceUrl: series.sourceUrl,
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

function normalizeNotices(raw: unknown): Record<string, OfficialPriceNotice> {
  const notices: Record<string, OfficialPriceNotice> = {};
  if (!raw || typeof raw !== 'object') return notices;
  for (const value of Object.values(raw)) {
    if (!value || typeof value !== 'object') continue;
    const candidate = value as OfficialPriceNotice;
    const notice = { ...candidate, effectiveFrom: millis(candidate.effectiveFrom), retrievedAt: millis(candidate.retrievedAt) };
    if (isOfficialNotice({ ...notice, withdrawn: false })) notices[notice.effectiveFrom!] = notice as OfficialPriceNotice;
  }
  return notices;
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
  effectiveFrom?: number | null;
  sourceUrl?: string | null;
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

interface DatedPrice {
  price: number;
  at: number;
  notice?: OfficialPriceNotice;
}

function datedPrices(series: RegulatedSeries): DatedPrice[] {
  const entries = new Map<number, DatedPrice>();
  for (const [at, price] of Object.entries(series.timeline ?? {})) {
    if (Number.isFinite(Number(at)) && Number.isFinite(price) && price > 0) entries.set(Number(at), { at: Number(at), price });
  }
  const current = series.current;
  if (!seriesIsManual(series) && current && Number.isFinite(current.effectiveFrom) && current.pricePerLiter > 0 && !entries.has(current.effectiveFrom!)) {
    entries.set(current.effectiveFrom!, { at: current.effectiveFrom!, price: current.pricePerLiter });
  }
  for (const notice of Object.values(series.notices ?? {})) {
    if (notice.withdrawn === true) { entries.delete(notice.effectiveFrom); continue; }
    // A distant advance notice needs rechecking near activation, not an indefinite offline promise.
    if (!isOfficialNotice(notice)) continue;
    if (notice.effectiveFrom - notice.retrievedAt <= NOTICE_FRESHNESS_MS) entries.set(notice.effectiveFrom, { at: notice.effectiveFrom, price: notice.pricePerLiter, notice });
    else if (!(current?.effectiveFrom === notice.effectiveFrom && (current.updatedAt ?? 0) >= notice.effectiveFrom)) entries.delete(notice.effectiveFrom);
  }
  return [...entries.values()].sort((a, b) => a.at - b.at);
}

function overrideApplies(series: RegulatedSeries, date: number, latest?: DatedPrice): boolean {
  const override = series.manualOverride;
  return !!override && override.month === israelMonthKey(date) && Number.isFinite(override.pricePerLiter) && override.pricePerLiter > 0
    && (!latest || israelMonthKey(latest.at) !== override.month || override.setAt >= latest.at);
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
  if (!series || !Number.isFinite(date) || date <= 0) return MISSING;

  const regulable =
    fuelType === REGULATED_FUEL_TYPE && serviceMode === REGULATED_SERVICE_MODE;
  const key = israelMonthKey(date);
  const events = datedPrices(series);
  const dated = events.filter(p => p.at <= date).at(-1);

  const override = series.manualOverride;
  if (
    override && overrideApplies(series, date, dated)
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

  if (dated && israelMonthKey(dated.at) === key) {
    return { price: dated.price, fromHistory: true, effectiveMonth: key,
      updatedAt: dated.notice?.retrievedAt ?? series.retrievedAt ?? series.current?.updatedAt ?? null,
      source: 'scheduled', isManual: false, isRegulated: regulable, effectiveFrom: dated.at,
      sourceUrl: dated.notice?.sourceUrl ?? series.sourceUrl ?? null };
  }

  const historic = series.history?.[key];
  // A monthly bucket containing the latest price cannot fill a known earlier gap.
  const datedMonth = events.some(p => israelMonthKey(p.at) === key)
    || Object.values(series.notices ?? {}).some(p => p.withdrawn === true && israelMonthKey(p.effectiveFrom) === key)
    || typeof series.current?.effectiveFrom === 'number' && Number.isFinite(series.current.effectiveFrom)
      && series.current.effectiveFrom > date && israelMonthKey(series.current.effectiveFrom) === key;
  if (!datedMonth && typeof historic === "number" && Number.isFinite(historic) && historic > 0) {
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

  if (dated) {
    return { price: dated.price, fromHistory: false, effectiveMonth: israelMonthKey(dated.at),
      updatedAt: dated.notice?.retrievedAt ?? series.retrievedAt ?? series.current?.updatedAt ?? null,
      source: 'scheduled', isManual: false, isRegulated: regulable, effectiveFrom: dated.at,
      sourceUrl: dated.notice?.sourceUrl ?? series.sourceUrl ?? null };
  }

  const current = series.current?.pricePerLiter;
  const currentFrom = typeof series.current?.effectiveFrom === 'number' && Number.isFinite(series.current.effectiveFrom)
    && series.current.effectiveFrom > 0 ? series.current.effectiveFrom : null;
  const lastMonth = latestMonth(series.history);
  // A monthly record is evidence only for the price it actually contains.
  // Prefer that period to updatedAt: an advance announcement may have been
  // read before the month in which its price applies.
  const currentMonth = lastMonth && series.history[lastMonth] === current ? lastMonth : null;
  const observedAt = typeof series.current?.updatedAt === 'number' && Number.isFinite(series.current.updatedAt)
    && series.current.updatedAt > 0 ? series.current.updatedAt : null;
  const currentKnownByDate = currentFrom !== null ? currentFrom <= date
    : currentMonth !== null ? currentMonth <= key
      : observedAt !== null && observedAt <= date;
  if (!datedMonth && typeof current === "number" && Number.isFinite(current) && current > 0
      && currentKnownByDate) {
    const isManual = seriesIsManual(series);
    return {
      price: current,
      fromHistory: false,
      effectiveMonth: currentFrom !== null ? israelMonthKey(currentFrom)
        : currentMonth ?? (observedAt !== null ? israelMonthKey(observedAt) : null),
      updatedAt: series.current?.updatedAt ?? null,
      source: series.source ?? null,
      isManual,
      isRegulated: regulable && !isManual,
    };
  }

  return MISSING;
}

function latestMonth(history: Record<string, number> | undefined): string | null {
  const keys = Object.keys(history ?? {}).filter(key => /^\d{4}-(0[1-9]|1[0-2])$/.test(key)
    && Number.isFinite(history![key]) && history![key] > 0).sort();
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
    Object.values(series.notices ?? {}).some(isOfficialNotice) ||
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
  /** An explicit discount from the dated official price. */
  | "personalDiscount"
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

/** The dated official price minus an explicit discount. Historical receipts
 * and legacy absolute overrides never set the price for a new receipt.
 */
export function suggestPricePerLiter(
  date: number,
  vehicle:
    | Pick<Vehicle, "priceAdjustment" | "priceDiscount" | "manualPricePerLiter" | "fuelType">
    | null
    | undefined,
  config: RegulatedPriceConfig | FuelPrices | null | undefined,
): PriceSuggestion {
  const fuelType = vehicle?.fuelType ?? REGULATED_FUEL_TYPE;

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

  const discount = vehicleDiscount(vehicle);
  if (discount && discount.value > 0) {
    return {
      ...common,
      price: discountedPrice(lookup.price, discount),
      source: "personalDiscount",
      label: `${basis} · ${discountLabel(discount)}`,
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
  effectiveFrom?: number | null;
  sourceUrl?: string | null;
} {
  const lookup = regulatedMaxPrice(adaptLegacyConfig(config), fuelType, date);
  return {
    price: lookup.price,
    isRegulated: lookup.isRegulated,
    isManual: lookup.isManual,
    fromHistory: lookup.fromHistory,
    effectiveMonth: lookup.effectiveMonth,
    updatedAt: lookup.updatedAt,
    effectiveFrom: lookup.effectiveFrom,
    sourceUrl: lookup.sourceUrl,
  };
}

/** Overlay an already effective legacy reading. Ordinary users never write global config. */
export function withPublicPrice(config: RegulatedPriceConfig | null, reading: { price: number; month: string; effectiveFrom: number; readAt: number; url: string } | null, now = Date.now()): RegulatedPriceConfig | null {
  if (!reading || reading.effectiveFrom > now) return config;
  const base = adaptLegacyConfig(config);
  const old = base.byFuelType?.['95']?.self;
  if ((old?.current?.effectiveFrom ?? 0) > reading.effectiveFrom && !old?.notices?.[old.current!.effectiveFrom!]?.withdrawn) return base;
  const override = old?.manualOverride;
  const keepOverride = override && override.month === reading.month && override.setAt >= reading.effectiveFrom;
  const series: RegulatedSeries = { ...old, history: { ...old?.history, ...(!keepOverride ? { [reading.month]: reading.price } : {}) },
    scheduledHistory: { ...old?.scheduledHistory, [reading.month]: reading.price },
    timeline: priceTimeline(old, reading),
    ...(!keepOverride ? { current: { pricePerLiter: reading.price, effectiveFrom: reading.effectiveFrom, updatedAt: reading.readAt },
      source: 'scheduled' as const, sourceUrl: reading.url, retrievedAt: reading.readAt,
      ...(override?.month === reading.month ? { manualOverride: null } : {}) } : {}) };
  return { ...base, byFuelType: { ...base.byFuelType, '95': { ...base.byFuelType?.['95'], self: series } } };
}

/** Store confirmed notices separately, then update legacy active pointers using only elapsed events. */
export function withPublicPrices(config: RegulatedPriceConfig | null, snapshot: PublicPriceSnapshot | null, now = Date.now()): RegulatedPriceConfig | null {
  if (!snapshot) return config;
  let base = adaptLegacyConfig(config);
  const old = base.byFuelType?.['95']?.self;
  const notices = { ...old?.notices };
  for (const notice of Object.values(notices)) {
    if (notice.retrievedAt < notice.effectiveFrom && notice.retrievedAt <= snapshot.readAt && snapshot.checkedUrls?.includes(notice.sourceUrl)
      && !snapshot.notices.some(p => p.url === notice.sourceUrl && p.effectiveFrom === notice.effectiveFrom)) {
      notices[notice.effectiveFrom] = { ...notice, retrievedAt: snapshot.readAt, withdrawn: true };
    }
  }
  const accepted: PublicPriceReading[] = [];
  for (const reading of snapshot.notices) {
    const notice = noticeFromReading(reading);
    if (!notice || notice.retrievedAt > now || (notices[notice.effectiveFrom]?.retrievedAt ?? 0) > notice.retrievedAt) continue;
    notices[notice.effectiveFrom] = notice;
    accepted.push(reading);
  }
  base = { ...base, byFuelType: { ...base.byFuelType, '95': { ...base.byFuelType?.['95'], self: { ...old, history: old?.history ?? {}, notices } } } };
  for (const reading of accepted.sort((a, b) => a.effectiveFrom - b.effectiveFrom)) {
    if (reading.effectiveFrom <= now && reading.effectiveFrom - reading.readAt <= NOTICE_FRESHNESS_MS) base = withPublicPrice(base, reading, now)!;
  }
  return base;
}

export interface OfficialPriceChange {
  price: number;
  previousPrice: number;
  effectiveFrom: number;
  delta: number;
  sourceUrl: string | null;
}

function changeFor(config: RegulatedPriceConfig, series: RegulatedSeries, current: DatedPrice): OfficialPriceChange | null {
  const month = israelMonthKey(current.at);
  const [year, monthNumber] = month.split('-').map(Number);
  const start = israelMidnight(year, monthNumber, 1)!;
  let previous = datedPrices(series).filter(p => p.at < current.at).at(-1);
  // A mid-month change must have an earlier event in the SAME month. October is not evidence of the price on 4 November.
  if (!previous || israelMonthKey(previous.at) !== month) {
    // Legacy jobs sometimes stored UTC midnight for a month start. Their previous month's authoritative bucket is still usable.
    if (current.at - start > 3 * 3_600_000) return null;
    const lookup = regulatedMaxPrice(config, '95', start - 1);
    if (!lookup.isRegulated || !lookup.fromHistory || lookup.price === null || lookup.effectiveMonth !== israelMonthKey(start - 1)) return null;
    previous = { at: start - 1, price: lookup.price };
  } else {
    const lookup = regulatedMaxPrice(config, '95', current.at - 1);
    if (!lookup.isRegulated || lookup.price !== previous.price) return null;
  }
  const delta = current.price - previous.price;
  if (Math.abs(delta) < .005) return null;
  return { price: current.price, previousPrice: previous.price, effectiveFrom: current.at, delta, sourceUrl: current.notice?.sourceUrl ?? null };
}

/** Latest actual transition, independent of when this user last opened the app. */
export function latestOfficialPriceChange(config: RegulatedPriceConfig | null | undefined, now: number): OfficialPriceChange | null {
  const base = adaptLegacyConfig(config), series = base.byFuelType?.['95']?.self;
  if (!series) return null;
  const current = datedPrices(series).filter(p => p.at <= now).at(-1);
  const lookup = regulatedMaxPrice(base, '95', now);
  if (!current || !lookup.isRegulated || lookup.price !== current.price || israelMonthKey(current.at) !== israelMonthKey(now)) return null;
  return changeFor(base, series, current);
}

/** Hide an unrefreshed advance alert after 48 hours; active price evidence remains available. */
export function upcomingOfficialPrice(config: RegulatedPriceConfig | null | undefined, now: number): (OfficialPriceNotice & { change: OfficialPriceChange | null }) | null {
  const base = adaptLegacyConfig(config), series = base.byFuelType?.['95']?.self;
  if (!series) return null;
  const notice = Object.values(series.notices ?? {}).filter(isOfficialNotice)
    .filter(p => p.effectiveFrom > now && p.retrievedAt <= now && now - p.retrievedAt <= NOTICE_FRESHNESS_MS)
    .sort((a, b) => a.effectiveFrom - b.effectiveFrom)[0];
  if (!notice) return null;
  return { ...notice, change: changeFor(base, series, { price: notice.pricePerLiter, at: notice.effectiveFrom, notice }) };
}

/** Every public-price date is expressed in the jurisdiction that sets the price. */
export function officialPriceMoment(at: number): string {
  const date = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long', year: 'numeric' }).format(at);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  return `${date} בשעה ${time}`;
}
