/**
 * Personalised refuelling behaviour.
 *
 * The differentiator: two people with the same car, the same fuel and the same
 * consumption get different predicted refuelling windows, because one of them
 * fills at half a tank and the other runs it to a quarter.
 *
 * Three rules shape everything here:
 *
 *  1. One refuelling event contributes ONE behavioural sample, however many
 *     measurements surround it.
 *  2. The model never learns from its own predictions. A missing pre-fill level
 *     is missing evidence, not zero fuel.
 *  3. A default is a default. It is blended in explicitly and it is never
 *     described to the user as their habit.
 */

import {
  DEFAULT_HABIT_LEVEL,
  DEFAULT_HABIT_SPREAD,
  FILL_STYLE_MAJORITY,
  HABIT_CLAIM_THRESHOLD,
  HABIT_HALF_LIFE_DAYS,
  HABIT_HYSTERESIS,
  HABIT_MIN_QUALITY_MASS,
  HABIT_MIN_SPAN_DAYS,
  HABIT_MIXED_IQR,
  HABIT_PRIOR_STRENGTH,
  LEVEL_DISPLAY_STEP,
} from "./config";
import { elapsedDays } from "./calendar";
import type { FillEvent, TankEvent } from "./observations";
import {
  blendDistributions,
  clamp,
  distributionFromSamples,
  effectiveSampleSize,
  priorDistribution,
  quantileOf,
  recencyWeight,
  roundToStep,
  weightedMedian,
  type Weighted,
} from "./numeric";
import type { RefuelReason, TankPreferences } from "./types";

/** How a refuel is treated when learning the routine threshold. */
export type BehaviorClass = "routine" | "exceptional" | "unknown";

export interface BehaviorSample {
  fillupId: string;
  at: number;
  ageDays: number;
  /** Fuel remaining before filling, as a fraction of capacity. */
  preLevel: number;
  preLevelSd: number;
  /** Evidence quality, from provenance. */
  quality: number;
  weight: number;
  reason: RefuelReason | null;
  classification: BehaviorClass;
  postLevel: number | null;
  endedFull: boolean;
  /** Litres bought as a fraction of capacity. */
  purchaseFraction: number | null;
  /** Days of driving the remaining fuel represented, when estimable. */
  bufferDays: number | null;
}

export interface HabitProfile {
  /** Typical pre-refuel level from the blended distribution, 0–1. */
  typicalLevel: number;
  /** Rounded and hysteresis-damped, for the headline. */
  displayLevel: number;
  /** 25th/75th of the blended distribution. */
  low: number;
  high: number;
  source: "prior" | "blended" | "observed";
  /** λ in the cold-start blend. */
  learningWeight: number;
  nEffective: number;
  /** Σ(quality × recency), unnormalised. The gate that nEffective cannot be. */
  qualityMass: number;
  spanDays: number;
  sampleCount: number;
  routineCount: number;
  exceptionalCount: number;
  /** True when the routine band is too wide to name a single level. */
  mixed: boolean;
  /** Share of refuels that ended at a confirmed full tank. */
  fillsToFullShare: number | null;
  typicalPurchaseFraction: number | null;
  typicalPostLevel: number | null;
  typicalBufferDays: number | null;
  /** True when there is enough evidence to say "you usually…" in words. */
  canClaim: boolean;
  /** Set when the user pinned a level instead of letting it be learned. */
  overridden: boolean;
}

function classify(reason: RefuelReason | null): BehaviorClass {
  if (reason === "before-trip" || reason === "good-price") return "exceptional";
  if (reason === "routine" || reason === "low-fuel") return "routine";
  // "unsure" and no answer both stay unknown. An untagged high-level refill is
  // not evidence of anything in particular, and reclassifying it as exceptional
  // just because it does not fit a low-fuel story would be fitting the data to
  // the narrative.
  return "unknown";
}

/**
 * Evidence quality of a pre-fill level, by how it was obtained.
 *
 * The model's own prediction is absent from this table on purpose: learning a
 * threshold from a number the model produced would be the model teaching
 * itself, and it would converge on whatever it already believed.
 */
function qualityOf(source: string): number {
  switch (source) {
    case "direct-gauge":
    case "user-correction":
      return 1;
    case "derived-from-full-and-liters":
      return 0.7;
    case "derived-after-partial":
      return 0.6;
    default:
      return 0;
  }
}

export interface BehaviorSampleInput {
  events: readonly TankEvent[];
  capacityLiters: number | null;
  now: number;
  /** Enables the remaining-days buffer, when both are independently known. */
  litersPerKm?: number | null;
  kmPerDay?: number | null;
}

/**
 * One sample per refuelling event, from the strongest evidence available.
 *
 * Several readings around one refill are still one behavioural decision, so
 * they are folded into a single sample rather than inflating the evidence
 * count three-fold.
 */
export function buildBehaviorSamples(input: BehaviorSampleInput): BehaviorSample[] {
  const { events, capacityLiters, now } = input;
  const hasCapacity = typeof capacityLiters === "number" && capacityLiters > 0;
  const samples: BehaviorSample[] = [];

  for (const event of events) {
    if (event.kind !== "fillup") continue;
    if (!event.newSchema) continue; // legacy records prove nothing about intent

    const fill = event as FillEvent;
    let preLevel: number | null = null;
    let preSd = 0;
    let quality = 0;

    if (fill.preFill && qualityOf(fill.preFill.source) > 0) {
      preLevel = fill.preFill.level;
      preSd = fill.preFill.sd;
      quality = qualityOf(fill.preFill.source);
    } else if (fill.postFill?.confirmed && hasCapacity) {
      // A confirmed post-fill reading minus what was bought. Weaker than a
      // direct pre-fill reading, and it keeps the gauge's uncertainty.
      const derived = fill.postFill.level - fill.liters / capacityLiters;
      if (derived >= -0.2 && derived <= 1) {
        preLevel = clamp(derived, 0, 1);
        preSd = fill.postFill.sd * 1.3;
        quality = 0.6;
      }
    }

    if (preLevel === null || quality <= 0) continue;

    const ageDays = Math.max(0, elapsedDays(fill.at, now));
    const purchaseFraction = hasCapacity ? fill.liters / capacityLiters : null;

    let bufferDays: number | null = null;
    if (
      hasCapacity &&
      input.litersPerKm &&
      input.kmPerDay &&
      input.litersPerKm > 0 &&
      input.kmPerDay > 0
    ) {
      bufferDays = (preLevel * capacityLiters) / input.litersPerKm / input.kmPerDay;
    }

    samples.push({
      fillupId: fill.id,
      at: fill.at,
      ageDays,
      preLevel,
      preLevelSd: preSd,
      quality,
      weight: quality * recencyWeight(ageDays, HABIT_HALF_LIFE_DAYS),
      reason: fill.reason,
      classification: classify(fill.reason),
      postLevel: fill.postFill?.level ?? (fill.endState === "full" ? 1 : null),
      endedFull: fill.endState === "full" && fill.endStateSource === "user-confirmed",
      purchaseFraction,
      bufferDays,
    });
  }

  return samples;
}

function toWeighted(values: (number | null)[], weights: number[]): Weighted[] {
  const items: Weighted[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value !== null && Number.isFinite(value) && weights[i] > 0) {
      items.push({ value, weight: weights[i] });
    }
  }
  return items;
}

/**
 * Learn the profile.
 *
 * The cold-start transition is an explicit distributional blend:
 *
 *   F_personal = (1 − λ)·F_prior + λ·F_observed
 *   λ = nEff/(nEff + priorStrength) × qualityGate × coverageGate
 *
 * `qualityGate` is the part that `nEffective` cannot express. Five derived
 * samples weighted 0.3 have the same effective sample size as five direct ones
 * — the weights are equal RELATIVE to each other — and must not buy the same
 * confidence. It is computed from the unnormalised quality mass.
 *
 * The typical level and the band are then read off the BLEND, not by averaging
 * the prior's median with the observations' median.
 */
export function learnHabitProfile(
  samples: readonly BehaviorSample[],
  preferences: TankPreferences,
  previousDisplayLevel: number | null = null,
): HabitProfile {
  const priorCentre =
    preferences.usualRefuelLevel ?? DEFAULT_HABIT_LEVEL;
  const prior = priorDistribution(priorCentre, DEFAULT_HABIT_SPREAD);

  // Routine and untagged events build the threshold. Explicit pre-trip and
  // convenience top-ups are held out — one tank filled at 70% before a long
  // drive must not drag "usually refuels around a quarter" up to half.
  const routine = samples.filter((sample) => sample.classification !== "exceptional");
  const exceptional = samples.filter((sample) => sample.classification === "exceptional");

  const weights = routine.map((sample) => sample.weight);
  const levelSamples: Weighted[] = routine.map((sample) => ({
    value: sample.preLevel,
    weight: sample.weight,
  }));

  const nEffective = effectiveSampleSize(levelSamples);
  const qualityMass = routine.reduce(
    (sum, sample) => sum + sample.quality * recencyWeight(sample.ageDays, HABIT_HALF_LIFE_DAYS),
    0,
  );
  const spanDays =
    routine.length > 1
      ? Math.max(...routine.map((s) => s.at)) / 86_400_000 -
        Math.min(...routine.map((s) => s.at)) / 86_400_000
      : 0;

  const qualityGate = clamp(qualityMass / HABIT_MIN_QUALITY_MASS, 0, 1);
  const coverageGate = clamp(spanDays / HABIT_MIN_SPAN_DAYS, 0, 1);
  const observed = distributionFromSamples(levelSamples);

  const learningWeight =
    observed === null
      ? 0
      : clamp(
          (nEffective / (nEffective + HABIT_PRIOR_STRENGTH)) * qualityGate * coverageGate,
          0,
          1,
        );

  const blended = observed ? blendDistributions(prior, observed, learningWeight) : prior;

  const typicalLevel = clamp(quantileOf(blended, 0.5) ?? priorCentre, 0, 1);
  const low = clamp(quantileOf(blended, 0.25) ?? typicalLevel, 0, 1);
  const high = clamp(quantileOf(blended, 0.75) ?? typicalLevel, 0, 1);

  // Stabilised for display: rounded to a step, and only moved once the estimate
  // has moved further than the step's own noise. Material new evidence still
  // moves it, because the damping applies to the headline and not the learning.
  const rounded = clamp(roundToStep(typicalLevel, LEVEL_DISPLAY_STEP), 0, 1);
  const displayLevel =
    previousDisplayLevel !== null &&
    Math.abs(rounded - previousDisplayLevel) < HABIT_HYSTERESIS
      ? previousDisplayLevel
      : rounded;

  const fullCount = samples.filter((sample) => sample.endedFull).length;
  const overridden =
    typeof preferences.refuelLevelOverride === "number" &&
    Number.isFinite(preferences.refuelLevelOverride);

  const canClaim = learningWeight >= HABIT_CLAIM_THRESHOLD && routine.length >= 3;

  return {
    typicalLevel: overridden ? preferences.refuelLevelOverride! : typicalLevel,
    displayLevel: overridden
      ? clamp(roundToStep(preferences.refuelLevelOverride!, LEVEL_DISPLAY_STEP), 0, 1)
      : displayLevel,
    low: overridden ? preferences.refuelLevelOverride! : low,
    high: overridden ? preferences.refuelLevelOverride! : high,
    source: learningWeight >= HABIT_CLAIM_THRESHOLD ? (learningWeight > 0.85 ? "observed" : "blended") : "prior",
    learningWeight,
    nEffective,
    qualityMass,
    spanDays,
    sampleCount: samples.length,
    routineCount: routine.length,
    exceptionalCount: exceptional.length,
    // A genuinely mixed routine stays mixed. Averaging two distinct habits into
    // a midpoint nobody practises would be worse than showing a range.
    mixed: canClaim && high - low > HABIT_MIXED_IQR,
    fillsToFullShare: samples.length > 0 ? fullCount / samples.length : null,
    typicalPurchaseFraction: weightedMedian(
      toWeighted(
        routine.map((sample) => sample.purchaseFraction),
        weights,
      ),
    ),
    typicalPostLevel: weightedMedian(
      toWeighted(
        routine.map((sample) => sample.postLevel),
        weights,
      ),
    ),
    typicalBufferDays: weightedMedian(
      toWeighted(
        routine.map((sample) => sample.bufferDays),
        weights,
      ),
    ),
    canClaim,
    overridden,
  };
}

/** True when there is enough evidence to say "you usually fill up completely". */
export function claimsFillsToFull(profile: HabitProfile): boolean {
  return (
    profile.canClaim &&
    profile.fillsToFullShare !== null &&
    profile.fillsToFullShare >= FILL_STYLE_MAJORITY
  );
}

/** True when there is enough evidence to say "you usually add about half". */
export function claimsPartialTopUps(profile: HabitProfile): boolean {
  return (
    profile.canClaim &&
    profile.fillsToFullShare !== null &&
    profile.fillsToFullShare <= 1 - FILL_STYLE_MAJORITY &&
    profile.typicalPurchaseFraction !== null
  );
}
