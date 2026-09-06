/**
 * Bounded local replay evaluation.
 *
 * The point is not to prove the arithmetic works — the unit tests do that — but
 * to check whether the extra machinery actually predicts better than something
 * simpler. A simpler model winning for a particular user is a correct result and
 * is reported as one.
 *
 * Rules that make the number mean anything:
 *
 *  * at each origin, only information available THEN may influence a prediction;
 *  * a prediction is scored against the next independent qualifying measurement
 *    BEFORE that measurement is allowed to update the model;
 *  * ground truth is `capacity − purchased` at a confirmed full fill with a
 *    trusted capacity — never a value the model itself produced.
 */

import { buildSegments, sortFillups, type Fillup, type Vehicle } from "../stats";
import { replayBalance } from "./balance";
import {
  DEFAULT_TIME_ZONE,
  RESERVE_FRACTION,
  TANK_SCHEMA_VERSION,
} from "./config";
import { elapsedDays } from "./calendar";
import { estimateConsumption } from "./consumption";
import { buildBehaviorSamples, learnHabitProfile } from "./habits";
import { estimateMobility } from "./mobility";
import { buildEventStream } from "./observations";
import { DEFAULT_TANK_PREFERENCES, type TankObservation, type TankPreferences } from "./types";

/** How many origins a single run may evaluate. Bounded on purpose. */
const MAX_ORIGINS = 40;

export type BacktestModelName = "lifetime" | "recencyAdaptive" | "personalised";

export interface BacktestModelResult {
  name: BacktestModelName;
  /** Number of scored pre-fill litre comparisons. */
  levelSamples: number;
  /** Mean absolute error in litres, or null when nothing was scorable. */
  meanAbsoluteLiterError: number | null;
  /** Number of scored next-refuel timing comparisons. */
  timingSamples: number;
  meanAbsoluteTimingDays: number | null;
  /**
   * Times the model would have let the user reach the actual refuel moment
   * without having recommended action. Counted for the recommendation only.
   */
  missedEarlyActions: number;
}

export interface BacktestReport {
  /**
   * `out-of-time` only when every record used could be shown to have existed
   * before the moment it informed. Legacy records cannot prove that, so a run
   * containing them is honestly labelled retrospective.
   */
  kind: "out-of-time" | "retrospective";
  originCount: number;
  models: BacktestModelResult[];
  notes: string[];
}

interface Scored {
  literError: number[];
  timingError: number[];
  missed: number;
}

function emptyScored(): Scored {
  return { literError: [], timingError: [], missed: 0 };
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Fill-ups that carry ground truth: a confirmed full tank whose purchased
 * litres, against a trusted capacity, say what was in the tank beforehand.
 */
function scoringEvents(fillups: readonly Fillup[], capacity: number): Fillup[] {
  return fillups.filter(
    (fillup) =>
      fillup.tankSchemaVersion === TANK_SCHEMA_VERSION &&
      fillup.fillEndState === "full" &&
      fillup.fillEndStateSource === "user-confirmed" &&
      fillup.liters > 0 &&
      fillup.liters <= capacity * 1.05,
  );
}

export interface BacktestInput {
  fillups: readonly Fillup[];
  observations: readonly TankObservation[];
  vehicle: Vehicle | null | undefined;
  preferences?: TankPreferences;
  timeZone?: string;
}

/**
 * Run the evaluation.
 *
 * Three models are compared so that exactly one thing changes between the last
 * two: the personalised run differs from the recency-adaptive one ONLY in the
 * refuelling threshold, which is what isolates whether personalisation improves
 * timing rather than changing several things at once.
 */
export function backtest(input: BacktestInput): BacktestReport {
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const preferences = input.preferences ?? DEFAULT_TANK_PREFERENCES;
  const vehicle = input.vehicle ?? null;
  const notes: string[] = [];

  const capacity =
    vehicle?.tankLiters &&
    (vehicle.tankLitersSource === "user" || vehicle.tankLitersSource === "trusted")
      ? vehicle.tankLiters
      : null;

  const empty: BacktestReport = {
    kind: "retrospective",
    originCount: 0,
    models: [],
    notes,
  };

  if (capacity === null) {
    notes.push("אין נפח מיכל מאושר — אי אפשר להשוות מול מדידה אמיתית");
    return empty;
  }

  const sorted = sortFillups([...input.fillups]);
  const targets = scoringEvents(sorted, capacity);
  if (targets.length < 2) {
    notes.push("אין מספיק תדלוקים מאושרים עד מלא כדי להעריך את המודל");
    return empty;
  }

  // A record that reached the app after the date it claims cannot be shown to
  // have been available at that moment, and neither can a legacy record, whose
  // edits were never versioned.
  const allAvailable = sorted.every(
    (fillup) =>
      fillup.tankSchemaVersion === TANK_SCHEMA_VERSION &&
      (fillup.createdAt === undefined || fillup.createdAt <= fillup.date + 86_400_000),
  );
  if (!allAvailable) {
    notes.push(
      "חלק מהרשומות אינן מאפשרות לשחזר מה היה ידוע באותו רגע — ההערכה רטרוספקטיבית",
    );
  }

  const scores: Record<BacktestModelName, Scored> = {
    lifetime: emptyScored(),
    recencyAdaptive: emptyScored(),
    personalised: emptyScored(),
  };

  const chosen = targets.slice(-MAX_ORIGINS);
  let originCount = 0;

  for (let index = 1; index < chosen.length; index += 1) {
    const target = chosen[index];
    const origin = target.date;

    // Strictly BEFORE the target. The measurement being scored may not inform
    // the prediction that is about to be scored against it.
    const history = sorted.filter((fillup) => fillup.date < origin);
    const priorObservations = input.observations.filter(
      (observation) => observation.observedAt < origin,
    );
    if (history.length < 3) continue;

    const previousTarget = chosen[index - 1];
    if (previousTarget.date >= origin) continue;

    const actualPreFillLiters = capacity - target.liters;
    originCount += 1;

    /* --- model 1: lifetime rate, unweighted --- */
    const lifetimeConsumption = lifetimeRate(history);

    /* --- models 2 and 3: the real estimators --- */
    const consumption = estimateConsumption(history, vehicle, origin);
    const mobility = estimateMobility(history, priorObservations, origin, timeZone);
    const events = buildEventStream(history, priorObservations, capacity);

    const predictFor = (litersPerKm: number | null): number | null => {
      if (litersPerKm === null || !(litersPerKm > 0)) return null;
      const balance = replayBalance({
        events,
        capacityLiters: capacity,
        consumptionLitersPerKm: litersPerKm,
        consumptionSd: 0,
      });
      if (!balance.anchor) return null;
      const km = target.odometer - balance.anchor.odometer;
      if (km < 0) return null;
      return balance.anchor.liters - km * litersPerKm;
    };

    const predictions: Record<BacktestModelName, number | null> = {
      lifetime: predictFor(lifetimeConsumption),
      recencyAdaptive: predictFor(consumption.litersPerKm),
      personalised: predictFor(consumption.litersPerKm),
    };

    // Timing: how long until the tank reaches each model's threshold, against
    // how long it actually was until this refuel happened.
    const actualDays = Math.max(0, elapsedDays(previousTarget.date, origin));
    const samples = buildBehaviorSamples({
      events,
      capacityLiters: capacity,
      now: origin,
      litersPerKm: consumption.litersPerKm,
      kmPerDay: mobility.kmPerDay,
    });
    const habit = learnHabitProfile(samples, preferences, null);

    const thresholds: Record<BacktestModelName, number> = {
      lifetime: RESERVE_FRACTION,
      recencyAdaptive: RESERVE_FRACTION,
      // The ONE thing that differs in the third model.
      personalised: habit.typicalLevel,
    };

    for (const name of ["lifetime", "recencyAdaptive", "personalised"] as const) {
      const predicted = predictions[name];
      if (predicted !== null) {
        scores[name].literError.push(Math.abs(predicted - actualPreFillLiters));
      }

      const startLiters = name === "lifetime" ? predictFor(lifetimeConsumption) : predicted;
      const rate = name === "lifetime" ? lifetimeConsumption : consumption.litersPerKm;
      const kmPerDay = mobility.kmPerDay;
      if (
        startLiters === null ||
        rate === null ||
        kmPerDay === null ||
        !(rate > 0) ||
        !(kmPerDay > 0)
      ) {
        continue;
      }

      // Days from the previous confirmed full to the model's threshold, using
      // only what was known at the previous origin's anchor.
      const anchorLiters = capacity;
      const targetLiters = thresholds[name] * capacity;
      const predictedDays = (anchorLiters - targetLiters) / rate / kmPerDay;
      scores[name].timingError.push(Math.abs(predictedDays - actualDays));

      // "Missed early action" is a property of the RECOMMENDATION, not of the
      // behaviour forecast, so it is always measured against the reserve. A
      // model that predicts someone will refuel late has not failed when they
      // do; a model that stayed silent while the tank went under the reserve
      // has. Scoring the personalised threshold here would penalise it for
      // being an accurate description of a habit.
      const reserveLiters = RESERVE_FRACTION * capacity;
      const reserveDays = (anchorLiters - reserveLiters) / rate / kmPerDay;
      if (reserveDays > actualDays && actualPreFillLiters < reserveLiters) {
        scores[name].missed += 1;
      }
    }
  }

  if (originCount === 0) {
    notes.push("לא נמצאו נקודות מדידה מתאימות להערכה");
  }

  return {
    kind: allAvailable ? "out-of-time" : "retrospective",
    originCount,
    notes,
    models: (["lifetime", "recencyAdaptive", "personalised"] as const).map((name) => ({
      name,
      levelSamples: scores[name].literError.length,
      meanAbsoluteLiterError: mean(scores[name].literError),
      timingSamples: scores[name].timingError.length,
      meanAbsoluteTimingDays: mean(scores[name].timingError),
      missedEarlyActions: scores[name].missed,
    })),
  };
}

/**
 * Baseline 1: every closed segment, equally weighted.
 *
 * Uses the canonical segment engine so the comparison is fair — a baseline
 * built from a different definition of "a segment" would be a straw man.
 */
function lifetimeRate(fillups: readonly Fillup[]): number | null {
  const segments = buildSegments(sortFillups([...fillups]));
  let km = 0;
  let liters = 0;
  for (const segment of segments) {
    km += segment.km;
    liters += segment.liters;
  }
  return km > 0 && liters > 0 ? liters / km : null;
}
