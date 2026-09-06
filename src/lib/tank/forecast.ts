/**
 * Trajectory and recommendation.
 *
 * Three crossings are computed independently — the personal preference, the
 * configured reserve, and what an explicitly planned journey requires — and the
 * earliest relevant one becomes the action. They are never merged: a learned
 * habit of running the tank low must not lower the reserve policy, and a
 * conservative recommendation must not be presented as a prediction of what
 * this person will actually do.
 *
 * Every first-passage answer carries an explicit status. There are no negative
 * day counts, no infinities and no false zeros in the output.
 */

import type { BalanceResult } from "./balance";
import { addLocalDays, elapsedDays, localWeekday, startOfLocalDay } from "./calendar";
import {
  BAND_HIGH_QUANTILE,
  BAND_LOW_QUANTILE,
  FORECAST_HORIZON_DAYS,
  LATTICE_OFFSETS,
  LATTICE_WEIGHTS,
  MAX_ANCHOR_AGE_DAYS,
  MAX_USEFUL_BAND_DAYS,
  STALE_WIDENING_PER_DAY,
} from "./config";
import type { ConsumptionEstimate } from "./consumption";
import type { HabitProfile } from "./habits";
import { expectedKmOnWeekday, type MobilityEstimate } from "./mobility";
import { clamp, weightedQuantile } from "./numeric";
import {
  UNKNOWN_PASSAGE,
  type PassageResult,
  type TankPlan,
  type TankPreferences,
} from "./types";

export interface CurrentEstimate {
  /** Fraction of capacity, clamped to 0–1 for drawing. Null when unknown. */
  level: number | null;
  /** The same figure before clamping. A negative value is a diagnosis. */
  rawLevel: number | null;
  liters: number | null;
  /** Standard deviation of `liters`. */
  sd: number | null;
  /** The moment the estimate describes. */
  asOf: number;
  /** Age of the anchor the estimate rests on. */
  anchorAgeDays: number | null;
  /** True when the anchor is too old to date a forecast from. */
  stale: boolean;
  /** Distance forecast since the last measured odometer, in km. */
  forecastKmSinceOdometer: number | null;
}

export interface ForecastResult {
  current: CurrentEstimate;
  /** When this person is likely to WANT to refuel. */
  expectedRefuel: PassageResult;
  /** When they SHOULD refuel to keep the reserve and cover known trips. */
  recommendedRefuel: PassageResult;
  /** True when a planned trip pulled the recommendation earlier. */
  tripPullsForward: boolean;
  /** Whether the reserve level has already been crossed. */
  belowReserve: boolean;
  /** Distance still available before the reserve, when supported. */
  rangeToReserveKm: number | null;
}

const UNKNOWN_CURRENT: CurrentEstimate = {
  level: null,
  rawLevel: null,
  liters: null,
  sd: null,
  asOf: 0,
  anchorAgeDays: null,
  stale: false,
  forecastKmSinceOdometer: null,
};

/**
 * Expected distance for each of the next `days` local calendar days.
 *
 * Split into the routine part and the planned part, because only the routine
 * part scales with the travel-rate uncertainty: a 400 km trip the user typed in
 * is 400 km in every scenario.
 */
export interface DaySchedule {
  /** Start instant of each local day. */
  starts: number[];
  routineKm: number[];
  planKm: number[];
}

export function buildSchedule(
  from: number,
  days: number,
  mobility: MobilityEstimate,
  plans: readonly TankPlan[],
  timeZone: string,
): DaySchedule {
  const starts: number[] = [];
  const routineKm: number[] = [];
  const planKm: number[] = [];

  // Plans are keyed by the local day they fall on, so a trip entered as
  // "next Tuesday" lands on Tuesday regardless of the hour it was saved at.
  const byDay = new Map<number, TankPlan[]>();
  for (const plan of plans) {
    const key = startOfLocalDay(plan.date, timeZone);
    const list = byDay.get(key);
    if (list) list.push(plan);
    else byDay.set(key, [plan]);
  }

  let dayStart = startOfLocalDay(from, timeZone);
  for (let index = 0; index < days; index += 1) {
    const weekday = localWeekday(dayStart, timeZone);
    const routine = expectedKmOnWeekday(mobility, weekday) ?? 0;
    const today = byDay.get(dayStart) ?? [];

    // A trip that REPLACES the day's routine must not be added on top of the
    // commute it replaces. One "replaces" plan is enough to zero the routine.
    const replaces = today.some((plan) => plan.mode === "replaces");
    const planned = today.reduce(
      (sum, plan) => sum + Math.max(0, plan.distanceKm) + Math.max(0, plan.bufferKm ?? 0),
      0,
    );

    starts.push(dayStart);
    routineKm.push(replaces ? 0 : routine);
    planKm.push(planned);

    dayStart = addLocalDays(dayStart, 1, timeZone);
  }

  return { starts, routineKm, planKm };
}

/** Distance covered between two instants inside a schedule, pro-rated. */
function kmBetween(
  schedule: DaySchedule,
  from: number,
  to: number,
  routineScale: number,
): number {
  if (!(to > from)) return 0;
  let total = 0;
  for (let i = 0; i < schedule.starts.length; i += 1) {
    const dayStart = schedule.starts[i];
    const dayEnd =
      i + 1 < schedule.starts.length ? schedule.starts[i + 1] : dayStart + 86_400_000;
    const overlapStart = Math.max(from, dayStart);
    const overlapEnd = Math.min(to, dayEnd);
    if (overlapEnd <= overlapStart) continue;
    const share = (overlapEnd - overlapStart) / (dayEnd - dayStart);
    total += share * (schedule.routineKm[i] * routineScale + schedule.planKm[i]);
  }
  return total;
}

/**
 * Days until the tank falls to `targetLiters`, walking one local calendar day
 * at a time. Returns null when the target is not reached inside the schedule.
 */
function firstPassageDays(
  startLiters: number,
  targetLiters: number,
  litersPerKm: number,
  schedule: DaySchedule,
  routineScale: number,
  startOffsetDays: number,
): number | null {
  if (startLiters <= targetLiters) return 0;
  if (!(litersPerKm > 0)) return null;

  let liters = startLiters;
  for (let i = 0; i < schedule.starts.length; i += 1) {
    const km = schedule.routineKm[i] * routineScale + schedule.planKm[i];
    const burnt = km * litersPerKm;
    if (burnt <= 0) continue;

    if (liters - burnt <= targetLiters) {
      // Interpolate inside the day rather than rounding to whole days.
      const fraction = (liters - targetLiters) / burnt;
      return Math.max(0, i + clamp(fraction, 0, 1) - startOffsetDays);
    }
    liters -= burnt;
  }
  return null;
}

interface Scenario {
  weight: number;
  litersOffset: number;
  consumptionOffset: number;
  travelOffset: number;
}

/**
 * A deterministic three-point quantile lattice.
 *
 * 27 scenarios, fixed weights, no RNG and no sampling library — so the same
 * inputs always produce the same band and the UI never jitters between renders.
 * Current fuel is RECOMPUTED inside each scenario from the anchor rather than
 * perturbed independently, because a higher consumption rate both empties the
 * tank faster and means less was left at the last odometer. Treating those as
 * independent would report a band narrower than the evidence supports.
 */
function lattice(): Scenario[] {
  const scenarios: Scenario[] = [];
  for (let a = 0; a < LATTICE_OFFSETS.length; a += 1) {
    for (let b = 0; b < LATTICE_OFFSETS.length; b += 1) {
      for (let c = 0; c < LATTICE_OFFSETS.length; c += 1) {
        scenarios.push({
          weight: LATTICE_WEIGHTS[a] * LATTICE_WEIGHTS[b] * LATTICE_WEIGHTS[c],
          litersOffset: LATTICE_OFFSETS[a],
          consumptionOffset: LATTICE_OFFSETS[b],
          travelOffset: LATTICE_OFFSETS[c],
        });
      }
    }
  }
  return scenarios;
}

const SCENARIOS = lattice();

export interface ForecastInput {
  balance: BalanceResult;
  consumption: ConsumptionEstimate;
  mobility: MobilityEstimate;
  habit: HabitProfile;
  preferences: TankPreferences;
  plans: readonly TankPlan[];
  capacityLiters: number | null;
  now: number;
  timeZone: string;
}

export function forecast(input: ForecastInput): ForecastResult {
  const {
    balance,
    consumption,
    mobility,
    habit,
    preferences,
    plans,
    capacityLiters,
    now,
    timeZone,
  } = input;

  const capacity = typeof capacityLiters === "number" && capacityLiters > 0 ? capacityLiters : null;
  const anchor = balance.anchor;
  const litersPerKm = consumption.litersPerKm;

  const empty: ForecastResult = {
    current: UNKNOWN_CURRENT,
    expectedRefuel: UNKNOWN_PASSAGE,
    recommendedRefuel: UNKNOWN_PASSAGE,
    tripPullsForward: false,
    belowReserve: false,
    rangeToReserveKm: null,
  };

  if (!anchor || capacity === null || litersPerKm === null || !(litersPerKm > 0)) {
    return empty;
  }

  const anchorAgeDays = Math.max(0, elapsedDays(anchor.at, now));
  const stale = anchorAgeDays > MAX_ANCHOR_AGE_DAYS;

  // Measured distance is used through the latest odometer; only the stretch
  // AFTER it is forecast. Modelled travel is never laid over days a real
  // odometer change already accounts for.
  const lastOdometer = balance.lastOdometer;
  const measuredKm = lastOdometer ? Math.max(0, lastOdometer.value - anchor.odometer) : 0;
  const forecastFrom = lastOdometer ? Math.max(lastOdometer.at, anchor.at) : anchor.at;

  const upcoming = plans.filter((plan) => plan.date >= startOfLocalDay(forecastFrom, timeZone));
  const elapsedSinceOdometer = Math.max(0, elapsedDays(forecastFrom, now));
  const horizon = Math.ceil(elapsedSinceOdometer) + FORECAST_HORIZON_DAYS + 2;

  const withPlans = buildSchedule(forecastFrom, horizon, mobility, upcoming, timeZone);
  const withoutPlans = buildSchedule(forecastFrom, horizon, mobility, [], timeZone);

  const consumptionSd = consumption.sd ?? 0;
  const travelSd = mobility.sd ?? 0;
  const baseKmPerDay = mobility.kmPerDay;

  const evaluate = (schedule: DaySchedule, targetLevel: number) => {
    const targetLiters = targetLevel * capacity;
    const days: { value: number; weight: number }[] = [];
    let central: number | null = null;
    let centralCurrent = 0;
    let reachedAlready = false;

    for (const scenario of SCENARIOS) {
      const scenarioConsumption = Math.max(
        litersPerKm * 0.2,
        litersPerKm + scenario.consumptionOffset * consumptionSd,
      );
      const routineScale =
        baseKmPerDay && baseKmPerDay > 0
          ? Math.max(0.1, (baseKmPerDay + scenario.travelOffset * travelSd) / baseKmPerDay)
          : 1;

      const anchorLiters = anchor.liters + scenario.litersOffset * anchor.sd;
      const forecastKm = kmBetween(schedule, forecastFrom, now, routineScale);
      const currentLiters =
        anchorLiters - (measuredKm + forecastKm) * scenarioConsumption;

      const isCentral =
        scenario.litersOffset === 0 &&
        scenario.consumptionOffset === 0 &&
        scenario.travelOffset === 0;

      if (isCentral) {
        centralCurrent = currentLiters;
        reachedAlready = currentLiters <= targetLiters;
      }

      const value = firstPassageDays(
        currentLiters,
        targetLiters,
        scenarioConsumption,
        schedule,
        routineScale,
        elapsedSinceOdometer,
      );
      if (value !== null) days.push({ value, weight: scenario.weight });
      if (isCentral) central = value;
    }

    return { days, central, centralCurrent, reachedAlready, targetLiters };
  };

  const reserveLevel = clamp(preferences.reserveFraction, 0, 0.9);
  // The learned habit may sit later than the reserve; honouring an EARLY habit
  // is safe, and honouring a late one is not, so the preference used for the
  // behaviour forecast is the habit itself and the reserve stays separate.
  const habitLevel = clamp(habit.typicalLevel, 0, 0.95);

  const reserveRun = evaluate(withPlans, reserveLevel);
  const habitRun = evaluate(withPlans, habitLevel);
  const reserveNoPlans = evaluate(withoutPlans, reserveLevel);

  const currentLiters = reserveRun.centralCurrent;
  const rawLevel = currentLiters / capacity;
  const currentSd = Math.sqrt(
    anchor.sd ** 2 + ((measuredKm + kmBetween(withPlans, forecastFrom, now, 1)) * consumptionSd) ** 2,
  );

  // A stale projection that ran below zero is unknown, not "0%". The tank is
  // not known to be empty; the model is known to be out of date.
  const levelIsUsable = rawLevel > -0.1 && !(stale && rawLevel < 0.05);

  const current: CurrentEstimate = {
    level: levelIsUsable ? clamp(rawLevel, 0, 1) : null,
    rawLevel,
    liters: levelIsUsable ? clamp(currentLiters, 0, capacity) : null,
    sd: currentSd,
    asOf: now,
    anchorAgeDays,
    stale,
    forecastKmSinceOdometer: kmBetween(withPlans, forecastFrom, now, 1),
  };

  const toPassage = (
    run: ReturnType<typeof evaluate>,
    targetLevel: number,
  ): PassageResult => {
    if (!levelIsUsable || stale) return { ...UNKNOWN_PASSAGE, targetLevel };
    if (run.reachedAlready) {
      return { status: "reached", days: 0, daysLow: null, daysHigh: null, km: 0, targetLevel };
    }
    if (run.central === null || run.central > FORECAST_HORIZON_DAYS) {
      return {
        status: "beyondHorizon",
        days: null,
        daysLow: null,
        daysHigh: null,
        km: (run.centralCurrent - run.targetLiters) / litersPerKm,
        targetLevel,
      };
    }

    const low = weightedQuantile(run.days, BAND_LOW_QUANTILE);
    const high = weightedQuantile(run.days, BAND_HIGH_QUANTILE);
    // Time passing without fresh information widens the band. It never narrows
    // it — an old anchor does not become more reliable by ageing.
    const widening = 1 + STALE_WIDENING_PER_DAY * anchorAgeDays;
    const centre = run.central;
    const widenedLow = low !== null ? centre - (centre - low) * widening : null;
    const widenedHigh = high !== null ? centre + (high - centre) * widening : null;

    if (
      widenedLow !== null &&
      widenedHigh !== null &&
      widenedHigh - widenedLow > MAX_USEFUL_BAND_DAYS
    ) {
      return { ...UNKNOWN_PASSAGE, targetLevel };
    }

    return {
      status: "withinHorizon",
      days: centre,
      daysLow: widenedLow !== null ? Math.max(0, widenedLow) : null,
      daysHigh: widenedHigh,
      km: (run.centralCurrent - run.targetLiters) / litersPerKm,
      targetLevel,
    };
  };

  const recommended = toPassage(reserveRun, reserveLevel);
  const withoutPlansPassage = toPassage(reserveNoPlans, reserveLevel);

  return {
    current,
    expectedRefuel: toPassage(habitRun, habitLevel),
    recommendedRefuel: recommended,
    tripPullsForward:
      upcoming.length > 0 &&
      recommended.status === "withinHorizon" &&
      withoutPlansPassage.status === "withinHorizon" &&
      (withoutPlansPassage.days ?? 0) - (recommended.days ?? 0) > 0.5,
    belowReserve: reserveRun.reachedAlready && levelIsUsable,
    rangeToReserveKm:
      levelIsUsable && currentLiters > reserveRun.targetLiters
        ? (currentLiters - reserveRun.targetLiters) / litersPerKm
        : levelIsUsable
          ? 0
          : null,
  };
}
