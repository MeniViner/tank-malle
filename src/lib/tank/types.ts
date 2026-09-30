/**
 * Types for the personal tank model.
 *
 * Split from the engine modules so a UI file can name a result without pulling
 * in the maths, and so the storage shape is written down in exactly one place.
 */

/* ------------------------------------------------------------------ *
 * Stored shapes
 * ------------------------------------------------------------------ */

/** State of the tank at the END of a fill-up. */
export type FillEndState = "full" | "partial" | "unknown";

/**
 * Where an end-state claim came from.
 *
 * `legacy-assumption` is the important one: every pre-upgrade record was
 * written as a full tank without anybody being asked, and DataContext still
 * reads a missing `fullTankSource` as `"user"`. Those records are assumptions,
 * and this is what keeps them from being counted as confirmations.
 */
export type FillEndStateSource =
  | "user-confirmed"
  | "gauge-estimate"
  | "inferred"
  | "legacy-assumption"
  | "unknown";

/** Where a fuel-level number came from. Ordered strongest first. */
export type LevelSource =
  /** The user set it directly on the gauge. */
  | "direct-gauge"
  /** The user corrected a calculated value. Equivalent strength to direct. */
  | "user-correction"
  /** capacity − purchased litres, at a confirmed full fill. */
  | "derived-from-full-and-liters"
  /** before-level + purchased litres, for a partial fill. */
  | "derived-after-partial"
  | "imported-legacy"
  | "unknown";

/** Why this refuel happened. Optional, and "unknown" is a real answer. */
export type RefuelReason =
  | "routine"
  | "low-fuel"
  | "before-trip"
  | "good-price"
  | "unsure";

/** The optional tank-state fields carried on a fill-up document. */
export interface FillupTankFields {
  fillEndState?: FillEndState | null;
  fillEndStateSource?: FillEndStateSource | null;
  /** Fraction of usable capacity, 0–1. */
  preFillLevel?: number | null;
  preFillLevelSource?: LevelSource | null;
  preFillLevelUncertainty?: number | null;
  postFillLevel?: number | null;
  postFillLevelSource?: LevelSource | null;
  postFillLevelUncertainty?: number | null;
  refuelReason?: RefuelReason | null;
  /** The capacity revision the derivations at entry time were based on. */
  capacityLitersAtEntry?: number | null;
  /** Presence of the current value is the provenance boundary. */
  tankSchemaVersion?: number | null;
}

/** A gauge/odometer update that is NOT a fill-up. Creates no spending. */
export interface TankObservation {
  id: string;
  vehicleId: string;
  /** When the reading was taken. */
  observedAt: number;
  /** When it reached the app. Differs from `observedAt` on a backdated entry. */
  recordedAt: number;
  kind: "odometer" | "level" | "both";
  odometer?: number | null;
  /** Fraction of usable capacity, 0–1. */
  level?: number | null;
  levelUncertainty?: number | null;
  levelSource?: LevelSource | null;
  /** True only when the user actually stated this, rather than accepting a
   *  pre-filled suggestion. */
  confirmed: boolean;
  /** Set when the reading belongs to a fill-up rather than standing alone. */
  fillupId?: string | null;
  phase?: "before_refuel" | "after_refuel" | "standalone";
  schemaVersion?: number;
}

/** An upcoming journey the user told us about. Never becomes measured travel. */
export interface TankPlan {
  id: string;
  vehicleId: string;
  /** Local calendar day of the trip, as epoch ms at local midnight. */
  date: number;
  distanceKm: number;
  /** Whether the trip is on top of the usual driving or instead of it. */
  mode: "additional" | "replaces";
  bufferKm?: number | null;
  note?: string | null;
  createdAt?: number;
}

/** Per-vehicle tank preferences. Self-reported answers are priors, not facts. */
export interface TankPreferences {
  /** Comfort buffer to keep. A product preference, not a manufacturer figure. */
  reserveFraction: number;
  /**
   * A fixed personal refuel level. `null` means "learn it from behaviour",
   * which is the default and the point of the feature.
   */
  refuelLevelOverride: number | null;
  /** Self-reported, used only as a cold-start prior. */
  usualFillStyle?: "full" | "partial" | "unknown" | null;
  usualRefuelLevel?: number | null;
  /**
   * Behaviour samples before this moment are ignored.
   *
   * The way to say "that was the old me" without deleting a single fill-up:
   * the spending history, the consumption segments and the odometer trail all
   * stay exactly as they are, and only the habit learning starts again.
   */
  habitResetAt?: number | null;
}

export const DEFAULT_TANK_PREFERENCES: TankPreferences = {
  reserveFraction: 0.25,
  refuelLevelOverride: null,
  usualFillStyle: null,
  usualRefuelLevel: null,
  habitResetAt: null,
};

/* ------------------------------------------------------------------ *
 * Engine results
 * ------------------------------------------------------------------ */

/**
 * Structured explanation codes.
 *
 * The UI maps these to copy. Keeping them as codes rather than sentences means
 * the reason a number exists survives translation and reordering.
 */
export type ReasonCode =
  | "recentConfirmedFullAnchor"
  | "recentGaugeObservation"
  | "recentOdometer"
  | "travelForecastFromHistory"
  | "consumptionFromHistory"
  | "consumptionFromDeclaredPrior"
  | "habitFromObservations"
  | "habitFromPrior"
  | "explicitPreferenceOverride"
  | "upcomingTripRequiresEarlierRefuel"
  | "weakGaugeEstimate"
  | "insufficientRoutineSamples"
  | "insufficientTravelHistory"
  | "untrustedCapacity"
  | "historyBreak"
  | "staleAnchor"
  | "conflictingObservations"
  | "overCapacityResidual"
  | "capacitySuspect"
  | "negativeResidual"
  | "unsupportedFuelType";

/** What the app should ask for next, and why. */
export type NextUpdateKind =
  | "confirmCapacity"
  | "updateGauge"
  | "updateOdometer"
  | "confirmFullEndpoints"
  | "recordPreFillLevel"
  | "none";

/** Outcome of a first-passage question. Never encoded as 0 or Infinity. */
export type PassageStatus = "reached" | "withinHorizon" | "beyondHorizon" | "unknown";

export interface PassageResult {
  status: PassageStatus;
  /** Days from `now`. Null unless `status === "withinHorizon"`. */
  days: number | null;
  /** Scenario band around `days`, same units. Null when unsupported. */
  daysLow: number | null;
  daysHigh: number | null;
  /** Distance still available before the threshold, when supported. */
  km: number | null;
  /** The level this passage is measured against, as a fraction. */
  targetLevel: number;
}

export const UNKNOWN_PASSAGE: PassageResult = {
  status: "unknown",
  days: null,
  daysLow: null,
  daysHigh: null,
  km: null,
  targetLevel: 0,
};

/** How the balance replay ended up. */
export type ReconciliationState =
  | "ok"
  /** The arithmetic exceeds a TRUSTED capacity: a measurement is suspect. */
  | "overCapacity"
  /**
   * The arithmetic exceeds an UNTRUSTED capacity (a body-type estimate or the
   * largest fill on record). That is evidence the capacity figure is too
   * small, not that the tank state is broken — a confirmed full with more
   * fuel in it than the estimate allows says the tank is bigger than guessed.
   */
  | "capacitySuspect"
  | "negative"
  | "conflict"
  | "noAnchor"
  | "noCapacity";

export interface ReconciliationNote {
  state: ReconciliationState;
  /** Fill-up or observation the problem attaches to. */
  sourceId: string | null;
  at: number;
  /** Signed litres by which the model and the observation disagree. */
  residualLiters: number | null;
  message: string;
}
