/**
 * Explainability: why an estimate says what it says, and what would improve it
 * most.
 *
 * The prompt chooser is a transparent priority rule, deliberately NOT called
 * information gain — none is computed, and naming it that would dress a
 * reasonable heuristic up as something it is not.
 */

import type { BalanceResult } from "./balance";
import { elapsedDays } from "./calendar";
import {
  HABIT_CLAIM_THRESHOLD,
  MIN_CONSUMPTION_QUALITY_MASS,
  NEXT_UPDATE_COOLDOWN_DAYS,
  STALE_ODOMETER_DAYS,
} from "./config";
import type { ConsumptionEstimate } from "./consumption";
import type { ForecastResult } from "./forecast";
import type { HabitProfile } from "./habits";
import type { MobilityEstimate } from "./mobility";
import type { FuelType } from "../stats";
import type { NextUpdateKind, ReasonCode } from "./types";

export interface QualityInput {
  balance: BalanceResult;
  consumption: ConsumptionEstimate;
  mobility: MobilityEstimate;
  habit: HabitProfile;
  forecast: ForecastResult;
  capacityTrusted: boolean;
  /**
   * True when a capacity figure exists at all, trusted or not. An approximation
   * is offered for confirmation inline, beside the number itself, so the
   * generic prompt would be the same request asked twice on one screen.
   */
  capacityKnown: boolean;
  fuelType: FuelType;
  now: number;
}

/**
 * Reason codes, strongest evidence first then problems.
 *
 * Codes, not sentences: the reason a number exists has to survive being
 * reordered, translated and rendered in two different places.
 */
export function buildReasonCodes(input: QualityInput): ReasonCode[] {
  const { balance, consumption, mobility, habit, forecast, capacityTrusted } = input;
  const codes: ReasonCode[] = [];

  if (input.fuelType === "other") {
    return ["unsupportedFuelType"];
  }

  if (balance.anchor?.quality === "confirmed-full") codes.push("recentConfirmedFullAnchor");
  else if (balance.anchor?.quality === "direct-gauge") codes.push("recentGaugeObservation");
  else if (balance.anchor?.quality === "derived") codes.push("weakGaugeEstimate");

  if (balance.lastOdometer) {
    const age = elapsedDays(balance.lastOdometer.at, input.now);
    if (age <= STALE_ODOMETER_DAYS) codes.push("recentOdometer");
  }

  if (consumption.source === "history") codes.push("consumptionFromHistory");
  else if (consumption.source === "declared-prior") codes.push("consumptionFromDeclaredPrior");

  if (mobility.rung !== "none") codes.push("travelForecastFromHistory");
  else codes.push("insufficientTravelHistory");

  if (habit.overridden) codes.push("explicitPreferenceOverride");
  else if (habit.learningWeight >= HABIT_CLAIM_THRESHOLD) codes.push("habitFromObservations");
  else {
    codes.push("habitFromPrior");
    codes.push("insufficientRoutineSamples");
  }

  if (forecast.tripPullsForward) codes.push("upcomingTripRequiresEarlierRefuel");
  if (!capacityTrusted) codes.push("untrustedCapacity");
  if (balance.breaksCrossed > 0) codes.push("historyBreak");
  if (forecast.current.stale) codes.push("staleAnchor");

  if (balance.notes.some((note) => note.state === "conflict")) {
    codes.push("conflictingObservations");
  }
  if (balance.notes.some((note) => note.state === "overCapacity")) {
    codes.push("overCapacityResidual");
  }
  if (balance.notes.some((note) => note.state === "negative")) {
    codes.push("negativeResidual");
  }

  return codes;
}

/**
 * The one line Home has room for.
 *
 * A problem outranks a reassurance: someone whose capacity is unconfirmed needs
 * to be told that before they are told the anchor is recent.
 */
const PRIMARY_ORDER: ReasonCode[] = [
  "unsupportedFuelType",
  "untrustedCapacity",
  "conflictingObservations",
  "overCapacityResidual",
  "negativeResidual",
  "staleAnchor",
  "historyBreak",
  "upcomingTripRequiresEarlierRefuel",
  "explicitPreferenceOverride",
  "habitFromObservations",
  "insufficientRoutineSamples",
  "recentConfirmedFullAnchor",
  "recentGaugeObservation",
  "weakGaugeEstimate",
  "consumptionFromHistory",
  "consumptionFromDeclaredPrior",
  "insufficientTravelHistory",
  "travelForecastFromHistory",
  "recentOdometer",
  "habitFromPrior",
];

export function primaryReason(codes: readonly ReasonCode[]): ReasonCode | null {
  for (const code of PRIMARY_ORDER) {
    if (codes.includes(code)) return code;
  }
  return codes[0] ?? null;
}

export interface NextUpdate {
  kind: NextUpdateKind;
  /** Why this one was chosen, for the details sheet. */
  reason: ReasonCode | null;
}

/**
 * What to ask for next.
 *
 * One prompt at a time, chosen from the largest practical source of
 * uncertainty, and silent while the user's dismissal is still within its
 * cooldown. Nobody gets five requests on launch.
 */
export function chooseNextUpdate(
  input: QualityInput,
  dismissedAt: Partial<Record<NextUpdateKind, number>> = {},
): NextUpdate {
  const { balance, consumption, habit, capacityTrusted, now } = input;

  const suppressed = (kind: NextUpdateKind): boolean => {
    const at = dismissedAt[kind];
    if (typeof at !== "number") return false;
    return elapsedDays(at, now) < NEXT_UPDATE_COOLDOWN_DAYS;
  };

  const candidates: NextUpdate[] = [];

  if (input.fuelType === "other") return { kind: "none", reason: "unsupportedFuelType" };

  if (!capacityTrusted && !input.capacityKnown) {
    candidates.push({ kind: "confirmCapacity", reason: "untrustedCapacity" });
  }
  if (!balance.anchor) {
    candidates.push({ kind: "updateGauge", reason: "weakGaugeEstimate" });
  } else if (
    balance.lastOdometer &&
    elapsedDays(balance.lastOdometer.at, now) > STALE_ODOMETER_DAYS
  ) {
    candidates.push({ kind: "updateOdometer", reason: "staleAnchor" });
  }
  if (consumption.qualityMass < MIN_CONSUMPTION_QUALITY_MASS) {
    candidates.push({ kind: "confirmFullEndpoints", reason: "consumptionFromDeclaredPrior" });
  }
  if (!habit.overridden && habit.learningWeight < HABIT_CLAIM_THRESHOLD) {
    candidates.push({ kind: "recordPreFillLevel", reason: "insufficientRoutineSamples" });
  }

  for (const candidate of candidates) {
    if (!suppressed(candidate.kind)) return candidate;
  }
  return { kind: "none", reason: null };
}
