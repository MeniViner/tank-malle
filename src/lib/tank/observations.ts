/**
 * Normalisation, provenance and ordering.
 *
 * Two stores feed the tank model: measurements taken AT a fill-up, which live
 * on the fill-up document, and standalone gauge/odometer updates, which live in
 * their own collection. This module turns both into one ordered event stream
 * with a single canonical representation per physical event, so nothing is
 * counted twice.
 *
 * Pure. No React, no Firebase, no clock.
 */

import type { Fillup } from "../stats";
import { GAUGE_SD_BY_SOURCE, TANK_SCHEMA_VERSION } from "./config";
import { clamp, isFiniteNumber } from "./numeric";
import type {
  FillEndState,
  FillEndStateSource,
  LevelSource,
  RefuelReason,
  TankObservation,
} from "./types";

/** A fuel-level reading with the uncertainty its source actually warrants. */
export interface LevelReading {
  /** Fraction of usable capacity, 0–1. */
  level: number;
  /** Standard deviation, also as a fraction of capacity. Never zero. */
  sd: number;
  source: LevelSource;
  /** True only when the user stated it, not when they accepted a suggestion. */
  confirmed: boolean;
}

export interface FillEvent {
  kind: "fillup";
  id: string;
  at: number;
  odometer: number;
  liters: number;
  totalCost: number;
  endState: FillEndState;
  endStateSource: FillEndStateSource;
  /** Level before adding fuel, when observed or derivable. */
  preFill: LevelReading | null;
  /** Level after adding fuel, when directly observed or corrected. */
  postFill: LevelReading | null;
  reason: RefuelReason | null;
  continuityBreakBefore: boolean;
  /** Capacity revision used for derivations made at entry time. */
  capacityAtEntry: number | null;
  /** True when the record was written by the explicit tank-state UI. */
  newSchema: boolean;
}

export interface ObservationEvent {
  kind: "observation";
  id: string;
  at: number;
  odometer: number | null;
  level: LevelReading | null;
}

export type TankEvent = FillEvent | ObservationEvent;

/**
 * The end state a record actually supports.
 *
 * A record written by the new UI states it. Anything older is a legacy
 * ASSUMPTION: the old form set `isFullTank = true` without asking and stamped
 * `fullTankSource: "user"` on the way past, and DataContext still reads a
 * missing source as `"user"`. So `fullTankSource` is deliberately not consulted
 * here — only the schema version can distinguish a statement from an
 * assumption.
 */
export function resolveEndState(fillup: Fillup): {
  state: FillEndState;
  source: FillEndStateSource;
} {
  const newSchema = fillup.tankSchemaVersion === TANK_SCHEMA_VERSION;

  if (newSchema && fillup.fillEndState) {
    return {
      state: fillup.fillEndState,
      source: fillup.fillEndStateSource ?? "unknown",
    };
  }

  // Pre-upgrade record. Its boolean is preserved exactly, so every existing
  // consumption figure is unchanged — but it is labelled for what it is.
  return {
    state: fillup.isFullTank ? "full" : "partial",
    source: "legacy-assumption",
  };
}

/**
 * Whether this record closes a measured consumption interval.
 *
 * Legacy records answer from `isFullTank`, so nothing about the existing
 * numbers moves. A new record with an `unknown` endpoint does NOT close one —
 * its litres roll into the next genuinely closed interval instead of producing
 * a consumption figure derived from a tank whose level nobody knows.
 */
export function closesInterval(
  fillup: Pick<Fillup, "isFullTank" | "fillEndState" | "tankSchemaVersion">,
): boolean {
  if (fillup.tankSchemaVersion === TANK_SCHEMA_VERSION && fillup.fillEndState) {
    return fillup.fillEndState === "full";
  }
  return fillup.isFullTank;
}

function sdFor(source: LevelSource, stated: number | null | undefined): number {
  if (isFiniteNumber(stated) && stated > 0) return stated;
  return GAUGE_SD_BY_SOURCE[source] ?? GAUGE_SD_BY_SOURCE.unknown;
}

function readLevel(
  level: number | null | undefined,
  source: LevelSource | null | undefined,
  uncertainty: number | null | undefined,
): LevelReading | null {
  if (!isFiniteNumber(level)) return null;
  const resolvedSource = source ?? "unknown";
  return {
    level: clamp(level, 0, 1),
    sd: sdFor(resolvedSource, uncertainty),
    source: resolvedSource,
    // A derived value is a calculation, not something the user asserted.
    confirmed: resolvedSource === "direct-gauge" || resolvedSource === "user-correction",
  };
}

/**
 * Pre-fill level implied by a confirmed full tank and the litres bought.
 *
 * `preFillLitres ≈ capacity − purchased`. Genuinely useful — it lets the model
 * learn a refuelling habit from someone who never drags the gauge — but it is
 * a derivation, so it is labelled and given a wider uncertainty than a reading
 * the user actually gave.
 */
export function derivePreFillFromFull(
  liters: number,
  capacityLiters: number,
): LevelReading | null {
  if (!(capacityLiters > 0) || !isFiniteNumber(liters) || liters <= 0) return null;
  const level = (capacityLiters - liters) / capacityLiters;
  // A fill larger than the tank says something is wrong with the capacity or
  // the litres, not that the tank was at minus 10%.
  if (level < -0.2 || level > 1) return null;
  return {
    level: clamp(level, 0, 1),
    sd: GAUGE_SD_BY_SOURCE["derived-from-full-and-liters"],
    source: "derived-from-full-and-liters",
    confirmed: false,
  };
}

/**
 * Turn one stored fill-up into an event.
 *
 * `capacityLiters` is the CURRENT trusted capacity, used only when the record
 * did not store the revision it was entered against. Changing today's capacity
 * must not manufacture new trusted levels in old data, so a record that stored
 * its own revision keeps it.
 */
export function toFillEvent(
  fillup: Fillup,
  capacityLiters: number | null,
): FillEvent {
  const { state, source } = resolveEndState(fillup);
  const newSchema = fillup.tankSchemaVersion === TANK_SCHEMA_VERSION;
  const capacityAtEntry = isFiniteNumber(fillup.capacityLitersAtEntry)
    ? fillup.capacityLitersAtEntry
    : null;
  const capacityForDerivation = capacityAtEntry ?? capacityLiters;

  let preFill = newSchema
    ? readLevel(
        fillup.preFillLevel,
        fillup.preFillLevelSource,
        fillup.preFillLevelUncertainty,
      )
    : null;

  // Case C: an explicit full confirmation with a trusted capacity tells us what
  // was in the tank beforehand even though the user never touched the gauge.
  if (
    preFill === null &&
    newSchema &&
    state === "full" &&
    source === "user-confirmed" &&
    capacityForDerivation !== null
  ) {
    preFill = derivePreFillFromFull(fillup.liters, capacityForDerivation);
  }

  return {
    kind: "fillup",
    id: fillup.id,
    at: fillup.date,
    odometer: fillup.odometer,
    liters: fillup.liters,
    totalCost: fillup.totalCost,
    endState: state,
    endStateSource: source,
    preFill,
    postFill: newSchema
      ? readLevel(
          fillup.postFillLevel,
          fillup.postFillLevelSource,
          fillup.postFillLevelUncertainty,
        )
      : null,
    reason: newSchema ? (fillup.refuelReason ?? null) : null,
    continuityBreakBefore: fillup.continuityBreakBefore === true,
    capacityAtEntry,
    newSchema,
  };
}

export function toObservationEvent(observation: TankObservation): ObservationEvent {
  return {
    kind: "observation",
    id: observation.id,
    at: observation.observedAt,
    odometer: isFiniteNumber(observation.odometer) ? observation.odometer : null,
    level: observation.confirmed
      ? readLevel(
          observation.level,
          observation.levelSource ?? "direct-gauge",
          observation.levelUncertainty,
        )
      : null,
  };
}

/**
 * Deterministic ordering.
 *
 * Time first, then odometer, then a stable id tie-break. A fill-up sorts before
 * a standalone observation at the same instant, because the before/add/after
 * ordering inside a fill-up is resolved within the fill-up's own replay step
 * and an observation recorded at the same moment describes the state after it.
 */
function compareEvents(a: TankEvent, b: TankEvent): number {
  if (a.at !== b.at) return a.at - b.at;
  const rank = (event: TankEvent) => (event.kind === "fillup" ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const odoA = a.kind === "fillup" ? a.odometer : (a.odometer ?? Number.POSITIVE_INFINITY);
  const odoB = b.kind === "fillup" ? b.odometer : (b.odometer ?? Number.POSITIVE_INFINITY);
  if (odoA !== odoB) return odoA - odoB;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * One ordered stream from both stores.
 *
 * Observations carrying a `fillupId` are dropped: that measurement is already
 * represented on the fill-up itself, and keeping both is how a tank ends up
 * being credited with the same twenty litres twice.
 */
export function buildEventStream(
  fillups: readonly Fillup[],
  observations: readonly TankObservation[],
  capacityLiters: number | null,
): TankEvent[] {
  const events: TankEvent[] = [];

  for (const fillup of fillups) {
    if (!isFiniteNumber(fillup.date) || !isFiniteNumber(fillup.odometer)) continue;
    events.push(toFillEvent(fillup, capacityLiters));
  }

  for (const observation of observations) {
    if (observation.fillupId) continue;
    if (!isFiniteNumber(observation.observedAt)) continue;
    const event = toObservationEvent(observation);
    // An observation that carries neither an odometer nor a usable level says
    // nothing; keeping it would only add a step to the replay.
    if (event.odometer === null && event.level === null) continue;
    events.push(event);
  }

  return events.sort(compareEvents);
}
