import type { FuelType, FuelPrices } from "../stats";
import { monthKey } from "../stats";
import type { ServiceMode } from "./types";

/**
 * The government-regulated maximum price.
 *
 * In Israel this is a real, published figure for exactly one product:
 * **95-octane petrol, self-service, mainland**. There is no regulated price for
 * 98, for diesel, or for Eilat's different tax treatment.
 *
 * That is the whole reason this module exists. The previous model held one
 * price and one history map with no fuel dimension at all, so every screen that
 * wanted "the official price" for a diesel car got the 95 figure.
 */

/** Fuel-type-aware config. Each entry is a month-keyed series with a source. */
export interface RegulatedSeries {
  /** Month key → ₪/litre, e.g. { "2026-08": 7.31 }. */
  history: Record<string, number>;
  current?: {
    pricePerLiter: number;
    effectiveFrom?: number;
    /** When we last wrote it, so staleness can be reported truthfully. */
    updatedAt?: number;
  } | null;
  /** Where the figure came from. "manual" is the honest answer on Spark. */
  source?: "manual" | "scheduled" | "import";
  /** When the source was last read, as opposed to when we stored it. */
  retrievedAt?: number;
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
}

/**
 * The one product the Israeli regulated maximum actually covers.
 * Anything outside this is "unknown", not "the 95 number".
 */
export const REGULATED_FUEL_TYPE: FuelType = "95";
export const REGULATED_SERVICE_MODE: ServiceMode = "self";

export const REGULATED_LABEL = "מחיר מרבי מפוקח";
export const REGULATED_LABEL_FULL = "מחיר מרבי מפוקח לבנזין 95 בשירות עצמי";

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
        // An explicit fuel-type-aware entry wins; the legacy fields only fill
        // gaps, so a migration cannot lose newer data.
        history: { ...(typed.history ?? {}), ...(existing?.history ?? {}) },
        current: existing?.current ?? typed.current ?? null,
        source: existing?.source ?? "manual",
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
  if (typeof value === "object") {
    const candidate = value as { toMillis?: () => number; seconds?: number };
    if (typeof candidate.toMillis === "function") return candidate.toMillis();
    if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  }
  if (value instanceof Date) return value.getTime();
  return undefined;
}

function normalizeSeries(raw: unknown): RegulatedSeries | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const series = raw as RegulatedSeries;
  const price = Number(series.current?.pricePerLiter);

  return {
    history: (series.history ?? {}) as Record<string, number>,
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
    history: (data.history ?? {}) as Record<string, number>,
  };
}

export interface RegulatedLookup {
  price: number | null;
  /** True when the figure is that month's own record, not a carried-forward one. */
  fromHistory: boolean;
  effectiveMonth: string | null;
  updatedAt: number | null;
  source: RegulatedSeries["source"] | null;
}

const MISSING: RegulatedLookup = {
  price: null,
  fromHistory: false,
  effectiveMonth: null,
  updatedAt: null,
  source: null,
};

/**
 * The regulated maximum for one fuel type, service mode and month.
 *
 * Returns null — meaning "unknown" — whenever there is no authoritative figure
 * for that exact combination. There is deliberately no cross-fuel fallback:
 * showing the 95 ceiling to a diesel driver would be a fabrication.
 */
export function regulatedMaxPrice(
  config: RegulatedPriceConfig | null | undefined,
  fuelType: FuelType,
  date: number,
  serviceMode: ServiceMode = REGULATED_SERVICE_MODE,
): RegulatedLookup {
  const series = config?.byFuelType?.[fuelType]?.[serviceMode];
  if (!series) return MISSING;

  const key = monthKey(date);
  const historic = series.history?.[key];

  if (typeof historic === "number" && Number.isFinite(historic)) {
    return {
      price: historic,
      fromHistory: true,
      effectiveMonth: key,
      updatedAt: series.current?.updatedAt ?? null,
      source: series.source ?? null,
    };
  }

  const current = series.current?.pricePerLiter;
  if (typeof current === "number" && Number.isFinite(current)) {
    return {
      price: current,
      fromHistory: false,
      effectiveMonth: series.current?.effectiveFrom
        ? monthKey(series.current.effectiveFrom)
        : null,
      updatedAt: series.current?.updatedAt ?? null,
      source: series.source ?? null,
    };
  }

  return MISSING;
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
    typeof series.current?.pricePerLiter === "number"
  );
}

/**
 * Honest freshness copy for the regulated figure.
 *
 * Nothing in the running system updates this automatically — the scheduled
 * function is written but undeployed — so the UI says when it was last entered
 * rather than promising an update that will not come.
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
