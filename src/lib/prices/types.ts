import type { FuelType } from "../stats";

/**
 * The price domain.
 *
 * Five different things were previously all called "pricePerLiter". They are
 * not interchangeable, and conflating them is what let a 95-octane reference
 * be displayed as a diesel price.
 */

/** Self-service or full service. The regulated ceiling differs between them. */
export type ServiceMode = "self" | "full";

/** Where a resolved figure came from. Never blended. */
export type PriceSourceKind =
  /** Government-regulated maximum. A ceiling, not an observed price. */
  | "regulated-max"
  /** Backend-computed aggregate of confirmed community reports. */
  | "station-posted-aggregate"
  /** A single community report. Low confidence by construction. */
  | "station-posted-single"
  /** A configured, billed external provider. Off unless explicitly enabled. */
  | "external-provider"
  /** What this user paid here before. Personal knowledge, never public. */
  | "personal-history"
  /** No trustworthy figure exists. */
  | "unknown";

export type Freshness = "fresh" | "aging" | "stale" | "unknown";
export type Confidence = "high" | "medium" | "low" | "none";

/**
 * One resolved price, with everything needed to present it honestly.
 *
 * `price === null` is a first-class answer. "We do not know the diesel price at
 * this station" is correct and must be said, rather than substituted for.
 */
export interface ResolvedPrice {
  stationId: string | null;
  fuelType: FuelType;
  serviceMode: ServiceMode | null;
  price: number | null;
  source: PriceSourceKind;
  /** When the figure was observed or took effect. */
  observedAt: number | null;
  freshness: Freshness;
  confidence: Confidence;
  reportCount: number;
  uniqueReporters: number;
  /**
   * True when `price` is a regulated MAXIMUM rather than an observed pump
   * price. The UI must render it as "עד ₪X", never as the price.
   */
  isCeiling: boolean;
  /** Hebrew explanation of what this figure is and how much to trust it. */
  explanation: string;
}

/** A public, backend-written aggregate. Clients can read but never write it. */
export interface StationPriceAggregate {
  stationId: string;
  fuelType: FuelType;
  serviceMode: ServiceMode;
  /** Median, not mean — one fat-fingered report must not move the answer. */
  medianPrice: number;
  acceptedReports: number;
  uniqueReporters: number;
  lastVerifiedAt: number;
  /** Spread across accepted reports; a wide spread lowers confidence. */
  spread: number;
  moderation?: "ok" | "flagged" | "suppressed";
}

/**
 * A user's own pricing rule. Explicitly scoped — a permanent, invisible,
 * vehicle-wide override is exactly what this replaces.
 */
export interface PersonalPriceRule {
  id: string;
  /** null means "any station"; a rule should normally name one. */
  stationId: string | null;
  fuelType: FuelType | null;
  /** ₪ per litre off the posted price. Negative means a surcharge. */
  discountPerLiter: number;
  /** Payment card or membership this depends on, for the user's own recall. */
  label?: string | null;
  /** Epoch ms; past this the rule stops applying rather than lingering. */
  expiresAt?: number | null;
  /**
   * Carried over from vehicle.priceAdjustment / vehicle.manualPricePerLiter.
   * A legacy rule is shown and offered for review; it is never applied as a
   * silent permanent default.
   */
  legacy?: boolean;
  /** True once the user has confirmed a legacy rule is still correct. */
  reviewed?: boolean;
}

/** Freshness thresholds, per source. Configurable and unit-tested. */
export interface FreshnessPolicy {
  /** Community observations go stale fastest — pump prices move weekly. */
  communityFreshMs: number;
  communityStaleMs: number;
  externalFreshMs: number;
  externalStaleMs: number;
  /** The regulated maximum is a monthly figure. */
  regulatedFreshMs: number;
  regulatedStaleMs: number;
}

const DAY = 86_400_000;

export const DEFAULT_FRESHNESS: FreshnessPolicy = {
  communityFreshMs: 3 * DAY,
  communityStaleMs: 14 * DAY,
  externalFreshMs: 2 * DAY,
  externalStaleMs: 10 * DAY,
  regulatedFreshMs: 35 * DAY,
  regulatedStaleMs: 70 * DAY,
};

/** Minimum distinct reporters before an aggregate is called high confidence. */
export const MIN_REPORTERS_FOR_HIGH_CONFIDENCE = 3;

/**
 * Plausible price bands per fuel type, in shekels per litre.
 *
 * Used to reject typos and abuse before they can reach an aggregate. Wide on
 * purpose: this is a sanity bound, not a forecast.
 */
export const PLAUSIBLE_RANGE: Record<FuelType, { min: number; max: number }> = {
  "95": { min: 3, max: 15 },
  "98": { min: 3, max: 18 },
  diesel: { min: 3, max: 15 },
  other: { min: 1, max: 30 },
};

export function isPlausiblePrice(fuelType: FuelType, price: number): boolean {
  const range = PLAUSIBLE_RANGE[fuelType] ?? PLAUSIBLE_RANGE.other;
  return Number.isFinite(price) && price >= range.min && price <= range.max;
}
