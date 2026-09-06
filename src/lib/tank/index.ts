/**
 * The tank model, assembled.
 *
 * Split deliberately into two stages:
 *
 *   fitTankModel  — the expensive part. Depends only on the stored data.
 *   projectTank   — the cheap part. Depends on `now`, and runs on every tick.
 *
 * That split is what lets a screen update the estimate as time passes without
 * refitting seven segments and a weekly travel model every minute.
 *
 * `now` and the timezone are always arguments. Nothing here reads the clock.
 */

import {
  isTankCapacityTrusted,
  sortFillups,
  type Fillup,
  type Vehicle,
} from "../stats";
import { replayBalance, type BalanceResult } from "./balance";
import { DEFAULT_TIME_ZONE, TANK_MODEL_VERSION } from "./config";
import { estimateConsumption, type ConsumptionEstimate } from "./consumption";
import { forecast, type CurrentEstimate, type ForecastResult } from "./forecast";
import { buildBehaviorSamples, learnHabitProfile, type BehaviorSample, type HabitProfile } from "./habits";
import { estimateMobility, type MobilityEstimate } from "./mobility";
import { buildEventStream, type FillEvent, type TankEvent } from "./observations";
import { buildReasonCodes, chooseNextUpdate, primaryReason, type NextUpdate } from "./quality";
import {
  DEFAULT_TANK_PREFERENCES,
  type NextUpdateKind,
  type PassageResult,
  type ReasonCode,
  type ReconciliationNote,
  type TankObservation,
  type TankPlan,
  type TankPreferences,
} from "./types";

export interface TankModelInput {
  fillups: readonly Fillup[];
  observations: readonly TankObservation[];
  vehicle: Vehicle | null | undefined;
  preferences: TankPreferences;
  /** Coarse clock for recency weighting. Rounding it keeps the fit cacheable. */
  now: number;
  timeZone?: string;
  /** Previous headline level, so the displayed figure does not oscillate. */
  previousDisplayLevel?: number | null;
}

export interface TankModelFit {
  events: TankEvent[];
  capacityLiters: number | null;
  capacityTrusted: boolean;
  consumption: ConsumptionEstimate;
  mobility: MobilityEstimate;
  balance: BalanceResult;
  habit: HabitProfile;
  samples: BehaviorSample[];
  timeZone: string;
}

/** The expensive half: everything that depends only on stored data. */
export function fitTankModel(input: TankModelInput): TankModelFit {
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const vehicle = input.vehicle ?? null;
  const capacityTrusted = isTankCapacityTrusted(vehicle);
  const capacityLiters = capacityTrusted ? (vehicle?.tankLiters ?? null) : null;

  const fillups = sortFillups([...input.fillups]);
  const consumption = estimateConsumption(fillups, vehicle, input.now);
  const mobility = estimateMobility(fillups, input.observations, input.now, timeZone);
  const events = buildEventStream(fillups, input.observations, capacityLiters);

  const balance = replayBalance({
    events,
    capacityLiters,
    consumptionLitersPerKm: consumption.litersPerKm,
    consumptionSd: consumption.sd,
  });

  const allSamples = buildBehaviorSamples({
    events,
    capacityLiters,
    now: input.now,
    litersPerKm: consumption.litersPerKm,
    kmPerDay: mobility.kmPerDay,
  });

  // A habit reset drops the behaviour evidence and nothing else. Spending,
  // consumption segments and the odometer trail are untouched, because "my
  // habits changed" is not a reason to lose four years of fuel records.
  const resetAt = input.preferences.habitResetAt;
  const samples =
    typeof resetAt === "number" && Number.isFinite(resetAt)
      ? allSamples.filter((sample) => sample.at >= resetAt)
      : allSamples;

  const habit = learnHabitProfile(
    samples,
    input.preferences,
    input.previousDisplayLevel ?? null,
  );

  return {
    events,
    capacityLiters,
    capacityTrusted,
    consumption,
    mobility,
    balance,
    habit,
    samples,
    timeZone,
  };
}

/** What the last recorded refuel left behind, for the "after last fill" row. */
export interface LastRefuelState {
  fillupId: string;
  at: number;
  /** Level after that fill, when it is known. */
  level: number | null;
  endState: FillEvent["endState"];
  confirmed: boolean;
}

export interface TankEstimate {
  modelVersion: number;
  /** Changes whenever the inputs do. Used as a cache key. */
  inputSignature: string;
  /** False when the vehicle or the data cannot support a tank view at all. */
  available: boolean;

  capacityLiters: number | null;
  capacityTrusted: boolean;

  current: CurrentEstimate;
  lastRefuel: LastRefuelState | null;
  /** Newest level the user actually reported, even without a capacity. */
  lastLevelReport: BalanceResult["lastLevelReport"];
  /** Newest odometer reading of any kind, for the "last seen" line. */
  lastOdometer: BalanceResult["lastOdometer"];

  habit: HabitProfile;
  consumption: ConsumptionEstimate;
  mobility: MobilityEstimate;

  /** When this person is likely to WANT to refuel. */
  expectedRefuel: PassageResult;
  /** When they SHOULD refuel to keep the reserve and cover planned trips. */
  recommendedRefuel: PassageResult;
  reserveLevel: number;
  belowReserve: boolean;
  rangeToReserveKm: number | null;
  tripPullsForward: boolean;

  reasons: ReasonCode[];
  primaryReason: ReasonCode | null;
  nextUpdate: NextUpdate;
  notes: ReconciliationNote[];
}

export interface ProjectionInput {
  fit: TankModelFit;
  vehicle: Vehicle | null | undefined;
  preferences: TankPreferences;
  plans: readonly TankPlan[];
  now: number;
  dismissedPrompts?: Partial<Record<NextUpdateKind, number>>;
  inputSignature: string;
}

/** The cheap half: project the fitted model to `now`. */
export function projectTank(input: ProjectionInput): TankEstimate {
  const { fit, preferences, plans, now } = input;
  const fuelType = input.vehicle?.fuelType ?? "95";

  const result: ForecastResult =
    fuelType === "other"
      ? {
          current: {
            level: null,
            rawLevel: null,
            liters: null,
            sd: null,
            asOf: now,
            anchorAgeDays: null,
            stale: false,
            forecastKmSinceOdometer: null,
          },
          expectedRefuel: { ...UNKNOWN, targetLevel: 0 },
          recommendedRefuel: { ...UNKNOWN, targetLevel: 0 },
          tripPullsForward: false,
          belowReserve: false,
          rangeToReserveKm: null,
        }
      : forecast({
          balance: fit.balance,
          consumption: fit.consumption,
          mobility: fit.mobility,
          habit: fit.habit,
          preferences,
          plans,
          capacityLiters: fit.capacityLiters,
          now,
          timeZone: fit.timeZone,
        });

  const qualityInput = {
    balance: fit.balance,
    consumption: fit.consumption,
    mobility: fit.mobility,
    habit: fit.habit,
    forecast: result,
    capacityTrusted: fit.capacityTrusted,
    fuelType,
    now,
  };

  const reasons = buildReasonCodes(qualityInput);

  return {
    modelVersion: TANK_MODEL_VERSION,
    inputSignature: input.inputSignature,
    // An electric or unclassified vehicle is not a petrol tank with missing
    // data. The whole surface is gated rather than filled with plausible
    // numbers about a tank that may not exist.
    available: fuelType !== "other",
    capacityLiters: fit.capacityLiters,
    capacityTrusted: fit.capacityTrusted,
    current: result.current,
    lastRefuel: lastRefuelOf(fit),
    lastLevelReport: fit.balance.lastLevelReport,
    lastOdometer: fit.balance.lastOdometer,
    habit: fit.habit,
    consumption: fit.consumption,
    mobility: fit.mobility,
    expectedRefuel: result.expectedRefuel,
    recommendedRefuel: result.recommendedRefuel,
    reserveLevel: preferences.reserveFraction,
    belowReserve: result.belowReserve,
    rangeToReserveKm: result.rangeToReserveKm,
    tripPullsForward: result.tripPullsForward,
    reasons,
    primaryReason: primaryReason(reasons),
    nextUpdate: chooseNextUpdate(qualityInput, input.dismissedPrompts),
    notes: fit.balance.notes,
  };
}

const UNKNOWN = {
  status: "unknown" as const,
  days: null,
  daysLow: null,
  daysHigh: null,
  km: null,
};

function lastRefuelOf(fit: TankModelFit): LastRefuelState | null {
  for (let i = fit.events.length - 1; i >= 0; i -= 1) {
    const event = fit.events[i];
    if (event.kind !== "fillup") continue;
    return {
      fillupId: event.id,
      at: event.at,
      level:
        event.postFill?.level ??
        (event.endState === "full" && event.endStateSource === "user-confirmed" ? 1 : null),
      endState: event.endState,
      confirmed:
        event.endStateSource === "user-confirmed" || Boolean(event.postFill?.confirmed),
    };
  }
  return null;
}

/**
 * A stable signature of everything the model reads.
 *
 * Cheap to compute and cheap to compare, so a cached fit is invalidated by an
 * edit, a delete, an import rollback, a capacity change or a preference change
 * without anybody having to remember to invalidate it by hand.
 */
export function tankInputSignature(input: {
  uid: string | null;
  vehicle: Vehicle | null | undefined;
  fillups: readonly Fillup[];
  observations: readonly TankObservation[];
  plans: readonly TankPlan[];
  preferences: TankPreferences;
}): string {
  const parts: string[] = [
    `v${TANK_MODEL_VERSION}`,
    input.uid ?? "-",
    input.vehicle?.id ?? "-",
    String(input.vehicle?.tankLiters ?? "-"),
    String(input.vehicle?.tankLitersSource ?? "-"),
    String(input.vehicle?.fuelType ?? "-"),
    String(input.vehicle?.declaredKmPerLiter ?? "-"),
    `p${input.preferences.reserveFraction}:${input.preferences.refuelLevelOverride ?? "-"}:${input.preferences.usualRefuelLevel ?? "-"}:${input.preferences.habitResetAt ?? "-"}`,
    `f${input.fillups.length}`,
    `o${input.observations.length}`,
    `t${input.plans.length}`,
  ];

  // Only the fields the model actually reads; a notes edit must not refit.
  let fold = 0;
  const mix = (text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      fold = (fold * 31 + text.charCodeAt(i)) | 0;
    }
  };
  for (const fillup of input.fillups) {
    mix(
      `${fillup.id}|${fillup.date}|${fillup.odometer}|${fillup.liters}|${fillup.isFullTank}|${fillup.fillEndState ?? ""}|${fillup.fillEndStateSource ?? ""}|${fillup.preFillLevel ?? ""}|${fillup.postFillLevel ?? ""}|${fillup.refuelReason ?? ""}|${fillup.continuityBreakBefore === true}|${fillup.tankSchemaVersion ?? ""}`,
    );
  }
  for (const observation of input.observations) {
    mix(
      `${observation.id}|${observation.observedAt}|${observation.odometer ?? ""}|${observation.level ?? ""}|${observation.confirmed}`,
    );
  }
  for (const plan of input.plans) {
    mix(`${plan.id}|${plan.date}|${plan.distanceKm}|${plan.mode}|${plan.bufferKm ?? ""}`);
  }

  return `${parts.join("/")}#${(fold >>> 0).toString(36)}`;
}

/** One-shot convenience: fit and project together. Used by tests and backtests. */
export function estimateTank(
  input: TankModelInput & {
    plans?: readonly TankPlan[];
    uid?: string | null;
    dismissedPrompts?: Partial<Record<NextUpdateKind, number>>;
  },
): TankEstimate {
  const preferences = input.preferences ?? DEFAULT_TANK_PREFERENCES;
  const plans = input.plans ?? [];
  const fit = fitTankModel({ ...input, preferences });
  return projectTank({
    fit,
    vehicle: input.vehicle,
    preferences,
    plans,
    now: input.now,
    dismissedPrompts: input.dismissedPrompts,
    inputSignature: tankInputSignature({
      uid: input.uid ?? null,
      vehicle: input.vehicle,
      fillups: input.fillups,
      observations: input.observations,
      plans,
      preferences,
    }),
  });
}

export * from "./types";
export { projectAfterFill, derivePreFillLevel, primaryNote } from "./balance";
export { closesInterval, resolveEndState } from "./observations";
export type { HabitProfile } from "./habits";
export { claimsFillsToFull, claimsPartialTopUps } from "./habits";
