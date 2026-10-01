/**
 * The tank-outcome contract, end to end.
 *
 * Every scenario runs the same loop: draft → `resolveTankOutcome` → `fields`
 * → a stored `Fillup` → `toFillEvent` → `replayBalance` / `estimateTank`, and
 * asserts that what the gauge displayed, what was persisted and what the
 * replay anchored on are the same fact. That agreement is the whole point of
 * having one function decide.
 */

import { describe, expect, it } from "vitest";
import { parseFillupDocument, serializeFillup } from "../fillupSerializer";
import { sortFillups, type Fillup, type Vehicle } from "../stats";
import { levelAfter, projectAfterFill, replayBalance } from "./balance";
import { litersVsCapacity, UNTRUSTED_CAPACITY_HEADROOM } from "./capacityChecks";
import { resolveCapacity, type ResolvedCapacity } from "./capacity";
import {
  CAPACITY_RELATIVE_SD,
  FULL_TANK_TOLERANCE_FRACTION,
  GAUGE_SD_BY_SOURCE,
  TANK_SCHEMA_VERSION,
  UNTRUSTED_CAPACITY_SD_FACTOR,
} from "./config";
import {
  draftFromFields,
  EMPTY_TANK_DRAFT,
  hasTankAnswer,
  impliedAfterSd,
  overCapacityThreshold,
  resolveTankOutcome,
  withEndChoice,
  type PersistedTankFields,
  type TankStateDraft,
} from "./draft";
import { estimateTank, tankInputSignature } from "./index";
import { buildEventStream, toFillEvent } from "./observations";
import { DEFAULT_TANK_PREFERENCES, type TankObservation, type TankPreferences } from "./types";

const DAY = 86_400_000;
const T0 = Date.parse("2026-01-04T08:00:00+02:00");

const TRUSTED_45: Vehicle = {
  id: "v1",
  make: "Test",
  model: "Car",
  fuelType: "95",
  tankLiters: 45,
  tankLitersSource: "user",
  priceAdjustment: 0,
  archived: false,
};
const ESTIMATED_45: Vehicle = { ...TRUSTED_45, tankLitersSource: "estimate" };
const NO_CAPACITY: Vehicle = { ...TRUSTED_45, tankLiters: null, tankLitersSource: null };

const trusted = resolveCapacity(TRUSTED_45);
const estimated = resolveCapacity(ESTIMATED_45);
const none = resolveCapacity(NO_CAPACITY);

function draft(partial: Partial<TankStateDraft>): TankStateDraft {
  return { ...EMPTY_TANK_DRAFT, ...partial };
}

/** A stored record built from EXACTLY the fields the outcome says to persist. */
function stored(
  id: string,
  input: { date?: number; odometer: number; liters: number },
  fields: PersistedTankFields,
): Fillup {
  return {
    id,
    date: input.date ?? T0,
    odometer: input.odometer,
    liters: input.liters,
    pricePerLiter: 7,
    totalCost: input.liters * 7,
    isFullTank: fields.fillEndState === "full",
    ...fields,
  };
}

function replay(
  fillups: Fillup[],
  capacity: ResolvedCapacity,
  options: { litersPerKm?: number | null; observations?: TankObservation[] } = {},
) {
  return replayBalance({
    events: buildEventStream(sortFillups(fillups), options.observations ?? [], capacity.liters),
    capacityLiters: capacity.liters,
    consumptionLitersPerKm: options.litersPerKm === undefined ? 0.08 : options.litersPerKm,
    consumptionSd: 0,
    capacityRelativeSd:
      CAPACITY_RELATIVE_SD * (capacity.trusted ? 1 : UNTRUSTED_CAPACITY_SD_FACTOR),
    capacityTrusted: capacity.trusted,
  });
}

/* ------------------------------------------------------------------ *
 * The draft
 * ------------------------------------------------------------------ */

describe("tank draft", () => {
  it("keeps confirmedFull equal to endChoice === 'full'", () => {
    const full = withEndChoice(draft({ afterLevelOverride: 0.6 }), "full");
    expect(full.confirmedFull).toBe(true);
    expect(full.endChoice).toBe("full");
    // Choosing full clears a correction: a full IS the after value.
    expect(full.afterLevelOverride).toBeNull();

    const partial = withEndChoice(full, "partial");
    expect(partial.confirmedFull).toBe(false);
    expect(partial.endChoice).toBe("partial");

    const cleared = withEndChoice(partial, null);
    expect(cleared.endChoice).toBeNull();
    expect(cleared.confirmedFull).toBe(false);
  });

  it("treats an older draft's boolean as the choice", () => {
    const outcome = resolveTankOutcome({
      draft: { beforeLevel: null, afterLevelOverride: null, confirmedFull: true, reason: null },
      litersAdded: 30,
      capacity: trusted,
    });
    expect(outcome.endState).toBe("full");
    expect(outcome.endStateSource).toBe("user-confirmed");
  });

  it("an explicit 'unknown' is an answer; nothing at all is not", () => {
    expect(hasTankAnswer(EMPTY_TANK_DRAFT)).toBe(false);
    expect(hasTankAnswer(withEndChoice(EMPTY_TANK_DRAFT, "unknown"))).toBe(true);
  });

  it("opens a stored record as the draft that wrote it", () => {
    const outcome = resolveTankOutcome({
      draft: draft({ beforeLevel: 0.25, endChoice: "full", confirmedFull: true, reason: "routine" }),
      litersAdded: 30,
      capacity: trusted,
    });
    const reopened = draftFromFields(outcome.fields);
    expect(reopened).toEqual({
      beforeLevel: 0.25,
      afterLevelOverride: null,
      confirmedFull: true,
      endChoice: "full",
      reason: "routine",
    });
    // A legacy record seeds nothing: its "full" is an assumption nobody made.
    expect(draftFromFields({ fillEndState: "full", fillEndStateSource: "user-confirmed" })).toEqual(
      EMPTY_TANK_DRAFT,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Round trips: preview = payload = replay
 * ------------------------------------------------------------------ */

describe("tank outcome round trip", () => {
  it("full only: the confirmation is the after evidence, and the before is derived", () => {
    const outcome = resolveTankOutcome({
      draft: withEndChoice(EMPTY_TANK_DRAFT, "full"),
      litersAdded: 30,
      capacity: trusted,
    });

    expect(outcome.state).toBe("ok");
    expect(outcome.displayAfterLevel).toBe(1);
    expect(outcome.displayBeforeLevel).toBeCloseTo(1 / 3, 6);
    expect(outcome.beforeIsDerived).toBe(true);
    expect(outcome.fields).toMatchObject({
      fillEndState: "full",
      fillEndStateSource: "user-confirmed",
      preFillLevel: null,
      postFillLevel: null,
      postFillLevelSource: null,
      capacityLitersAtEntry: 45,
      tankSchemaVersion: TANK_SCHEMA_VERSION,
    });

    const fillup = stored("a", { odometer: 1000, liters: 30 }, outcome.fields);
    const event = toFillEvent(fillup, trusted.liters);
    expect(event.preFill?.source).toBe("derived-from-full-and-liters");
    expect(event.preFill?.level).toBeCloseTo(outcome.displayBeforeLevel!, 6);
    expect(event.postFill).toBeNull();

    const balance = replay([fillup], trusted);
    expect(balance.anchor?.quality).toBe("confirmed-full");
    expect(balance.anchor?.liters).toBe(45);
    expect(balance.notes.filter((n) => n.state !== "ok")).toHaveLength(0);
    expect(levelAfter(event, 45)).toBe(1);
  });

  it("before only: a partial fill is derived, persisted as derived and replayed as derived", () => {
    const outcome = resolveTankOutcome({
      draft: draft({ beforeLevel: 0.25 }),
      litersAdded: 20,
      capacity: trusted,
    });
    const expected = 0.25 + 20 / 45;

    expect(outcome.state).toBe("ok");
    expect(outcome.endState).toBe("partial");
    expect(outcome.endStateSource).toBe("gauge-estimate");
    expect(outcome.displayAfterLevel).toBeCloseTo(expected, 9);
    expect(outcome.fields).toMatchObject({
      preFillLevel: 0.25,
      preFillLevelSource: "direct-gauge",
      preFillLevelUncertainty: GAUGE_SD_BY_SOURCE["direct-gauge"],
      postFillLevelSource: "derived-after-partial",
    });
    expect(outcome.fields.postFillLevel).toBeCloseTo(expected, 9);

    const fillup = stored("a", { odometer: 1000, liters: 20 }, outcome.fields);
    const balance = replay([fillup], trusted);
    expect(balance.anchor?.quality).toBe("derived");
    expect(balance.anchor!.liters / 45).toBeCloseTo(outcome.displayAfterLevel!, 9);

    const estimate = estimateTank({
      fillups: [fillup],
      observations: [],
      vehicle: TRUSTED_45,
      preferences: DEFAULT_TANK_PREFERENCES,
      now: T0 + DAY,
    });
    expect(estimate.lastRefuel?.level).toBeCloseTo(outcome.displayAfterLevel!, 9);
    expect(estimate.activeNotes).toHaveLength(0);
  });

  it("after-override only: the correction is the after level and the anchor", () => {
    const outcome = resolveTankOutcome({
      draft: draft({ afterLevelOverride: 0.8 }),
      litersAdded: 20,
      capacity: trusted,
    });

    expect(outcome.state).toBe("ok");
    expect(outcome.endState).toBe("partial");
    expect(outcome.endStateSource).toBe("user-confirmed");
    expect(outcome.displayAfterLevel).toBe(0.8);
    expect(outcome.fields).toMatchObject({
      preFillLevel: null,
      postFillLevel: 0.8,
      postFillLevelSource: "user-correction",
      postFillLevelUncertainty: GAUGE_SD_BY_SOURCE["user-correction"],
    });

    const fillup = stored("a", { odometer: 1000, liters: 20 }, outcome.fields);
    const balance = replay([fillup], trusted);
    expect(balance.anchor?.quality).toBe("direct-gauge");
    expect(balance.anchor?.liters).toBeCloseTo(36, 9);
    expect(levelAfter(toFillEvent(fillup, 45), 45)).toBe(0.8);
  });

  it("TANK-01: full + before consistent — preview, payload and replay all say full", () => {
    // capacity 45, before 25%, +20 L, confirmed full. The old form stored
    // postFillLevel 0.694 "derived-after-partial" beside the confirmed full.
    const outcome = resolveTankOutcome({
      draft: withEndChoice(draft({ beforeLevel: 0.25 }), "full"),
      litersAdded: 20,
      capacity: trusted,
    });

    expect(outcome.state).toBe("ok");
    expect(outcome.displayAfterLevel).toBe(1);
    expect(outcome.impliedAfterLevel).toBeCloseTo(0.694, 3);
    expect(outcome.fields).toMatchObject({
      fillEndState: "full",
      fillEndStateSource: "user-confirmed",
      preFillLevel: 0.25,
      preFillLevelSource: "direct-gauge",
      postFillLevel: null,
      postFillLevelSource: null,
      postFillLevelUncertainty: null,
    });

    const fillup = stored("a", { odometer: 1000, liters: 20 }, outcome.fields);
    const event = toFillEvent(fillup, 45);
    expect(event.preFill?.confirmed).toBe(true);
    expect(event.postFill).toBeNull();
    expect(levelAfter(event, 45)).toBe(1);

    const balance = replay([fillup], trusted);
    expect(balance.anchor?.quality).toBe("confirmed-full");
    expect(balance.anchor?.liters).toBe(45);
    expect(balance.lastLevelReport?.level).toBe(1);

    const estimate = estimateTank({
      fillups: [fillup],
      observations: [],
      vehicle: TRUSTED_45,
      preferences: DEFAULT_TANK_PREFERENCES,
      now: T0 + DAY,
    });
    expect(estimate.lastRefuel).toMatchObject({ level: 1, endState: "full", confirmed: true });
  });

  it("a confirmed full outranks an after-level an older record stored beside it", () => {
    // A record the OLD form wrote: confirmed full and a derived 0.694 together.
    const legacyShape: Fillup = {
      id: "old",
      date: T0,
      odometer: 1000,
      liters: 20,
      pricePerLiter: 7,
      totalCost: 140,
      isFullTank: true,
      fillEndState: "full",
      fillEndStateSource: "user-confirmed",
      preFillLevel: 0.25,
      preFillLevelSource: "direct-gauge",
      postFillLevel: 0.694,
      postFillLevelSource: "derived-after-partial",
      tankSchemaVersion: TANK_SCHEMA_VERSION,
    };
    const event = toFillEvent(legacyShape, 45);
    expect(levelAfter(event, 45)).toBe(1);

    const estimate = estimateTank({
      fillups: [legacyShape],
      observations: [],
      vehicle: TRUSTED_45,
      preferences: DEFAULT_TANK_PREFERENCES,
      now: T0 + DAY,
    });
    expect(estimate.lastRefuel?.level).toBe(1);
    // Nothing was rewritten to get there.
    expect(legacyShape.postFillLevel).toBe(0.694);
  });

  it("full + before conflicting with a TRUSTED capacity: raw before persisted, state conflict", () => {
    const outcome = resolveTankOutcome({
      draft: withEndChoice(draft({ beforeLevel: 0.5 }), "full"),
      litersAdded: 38,
      capacity: trusted,
    });

    expect(outcome.state).toBe("conflict");
    expect(outcome.message).not.toBeNull();
    expect(outcome.displayAfterLevel).toBe(1);
    expect(outcome.impliedAfterLevel).toBeCloseTo(0.5 + 38 / 45, 9);
    // The evidence is kept as given. Nobody's before level is rewritten.
    expect(outcome.fields).toMatchObject({
      fillEndState: "full",
      fillEndStateSource: "user-confirmed",
      preFillLevel: 0.5,
      preFillLevelSource: "direct-gauge",
      postFillLevel: null,
    });

    const fillup = stored("a", { odometer: 1000, liters: 38 }, outcome.fields);
    const balance = replay([fillup], trusted);
    expect(balance.anchor?.quality).toBe("confirmed-full");
    expect(balance.anchor?.liters).toBe(45);
    const note = balance.notes.find((n) => n.state === "overCapacity");
    expect(note?.sourceId).toBe("a");

    const estimate = estimateTank({
      fillups: [fillup],
      observations: [],
      vehicle: TRUSTED_45,
      preferences: DEFAULT_TANK_PREFERENCES,
      now: T0 + DAY,
    });
    // Attached to the anchor, so it is a capacity/measurement finding about
    // that fill — not a problem with the state now, which is "full".
    expect(estimate.activeNotes.some((n) => n.state === "overCapacity")).toBe(false);
    expect(estimate.capacityNotes.some((n) => n.state === "overCapacity")).toBe(true);
    expect(estimate.lastRefuel?.level).toBe(1);
  });

  it("full + before conflicting with an ESTIMATED capacity: the capacity is the suspect", () => {
    const outcome = resolveTankOutcome({
      draft: withEndChoice(draft({ beforeLevel: 0.5 }), "full"),
      litersAdded: 38,
      capacity: estimated,
    });

    expect(outcome.state).toBe("capacitySuspect");
    expect(outcome.fields.preFillLevel).toBe(0.5);
    expect(outcome.fields.postFillLevel).toBeNull();

    const fillup = stored("a", { odometer: 1000, liters: 38 }, outcome.fields);
    const balance = replay([fillup], estimated);
    expect(balance.anchor?.quality).toBe("confirmed-full");
    expect(balance.notes.some((n) => n.state === "capacitySuspect")).toBe(true);
    expect(balance.notes.some((n) => n.state === "overCapacity")).toBe(false);

    const estimate = estimateTank({
      fillups: [fillup],
      observations: [],
      vehicle: ESTIMATED_45,
      preferences: DEFAULT_TANK_PREFERENCES,
      now: T0 + DAY,
    });
    expect(estimate.activeNotes).toHaveLength(0);
    expect(estimate.capacityNotes.map((n) => n.state)).toEqual(["capacitySuspect"]);
    expect(estimate.reasons).toContain("capacitySuspect");
    expect(estimate.primaryReason).toBe("capacitySuspect");
    expect(estimate.lastRefuel?.level).toBe(1);
  });

  it("TANK-02: before + litres over a TRUSTED capacity is reported, not clamped to 1", () => {
    const outcome = resolveTankOutcome({
      draft: draft({ beforeLevel: 0.5 }),
      litersAdded: 38,
      capacity: trusted,
    });

    expect(outcome.state).toBe("overCapacity");
    expect(outcome.displayAfterLevel).toBe(1);
    expect(outcome.impliedAfterLevel).toBeCloseTo(1.344, 3);
    expect(outcome.fields).toMatchObject({
      fillEndState: "partial",
      fillEndStateSource: "gauge-estimate",
      preFillLevel: 0.5,
      postFillLevel: null,
      postFillLevelSource: null,
    });

    const fillup = stored("a", { odometer: 1000, liters: 38 }, outcome.fields);
    const balance = replay([fillup], trusted);
    expect(balance.notes.some((n) => n.state === "overCapacity")).toBe(true);
    // The replay does the arithmetic itself; the anchor is not a clamped 1.
    expect(balance.anchor?.liters).toBeCloseTo(0.5 * 45 + 38, 9);

    const estimate = estimateTank({
      fillups: [fillup],
      observations: [],
      vehicle: TRUSTED_45,
      preferences: DEFAULT_TANK_PREFERENCES,
      now: T0 + DAY,
    });
    // A derived (not confirmed-full) anchor over a trusted tank IS a
    // current-state problem: something the user entered is off.
    expect(estimate.activeNotes.some((n) => n.state === "overCapacity")).toBe(true);
  });

  it("before + litres over an ESTIMATED capacity points at the capacity", () => {
    const outcome = resolveTankOutcome({
      draft: draft({ beforeLevel: 0.5 }),
      litersAdded: 38,
      capacity: estimated,
    });
    expect(outcome.state).toBe("capacitySuspect");
    expect(outcome.fields.postFillLevel).toBeNull();
    expect(outcome.message).toContain("נפח המיכל");

    const fillup = stored("a", { odometer: 1000, liters: 38 }, outcome.fields);
    const estimate = estimateTank({
      fillups: [fillup],
      observations: [],
      vehicle: ESTIMATED_45,
      preferences: DEFAULT_TANK_PREFERENCES,
      now: T0 + DAY,
    });
    expect(estimate.activeNotes).toHaveLength(0);
    expect(estimate.capacityNotes.some((n) => n.state === "capacitySuspect")).toBe(true);
  });

  it("unknown litres: nothing is derived and the after gauge is empty", () => {
    const outcome = resolveTankOutcome({
      draft: draft({ beforeLevel: 0.25 }),
      litersAdded: null,
      capacity: trusted,
    });
    expect(outcome.state).toBe("unknownLiters");
    // NOT equal to the before level.
    expect(outcome.displayAfterLevel).toBeNull();
    expect(outcome.impliedAfterLevel).toBeNull();
    expect(outcome.fields.preFillLevel).toBe(0.25);
    expect(outcome.fields.postFillLevel).toBeNull();

    // Zero litres is "not a fill-up", not "add nothing".
    expect(
      resolveTankOutcome({ draft: draft({ beforeLevel: 0.25 }), litersAdded: 0, capacity: trusted })
        .state,
    ).toBe("unknownLiters");
  });

  it("no choice and no gauge evidence is an unknown end state", () => {
    const outcome = resolveTankOutcome({
      draft: draft({ reason: "routine" }),
      litersAdded: 30,
      capacity: trusted,
    });
    expect(outcome.endState).toBe("unknown");
    expect(outcome.endStateSource).toBe("unknown");
    expect(outcome.state).toBe("unknownBefore");
    expect(outcome.fields).toMatchObject({
      fillEndState: "unknown",
      fillEndStateSource: "unknown",
      preFillLevel: null,
      postFillLevel: null,
      refuelReason: "routine",
      capacityLitersAtEntry: 45,
    });

    const fillup = stored("a", { odometer: 1000, liters: 30 }, outcome.fields);
    const balance = replay([fillup], trusted);
    expect(balance.anchor).toBeNull();
  });

  it("an explicit 'unknown' endpoint preserves independently entered before evidence", () => {
    const outcome = resolveTankOutcome({
      draft: withEndChoice(draft({ beforeLevel: 0.25 }), "unknown"),
      litersAdded: 30,
      capacity: trusted,
    });
    expect(outcome.state).toBe("ok");
    expect(outcome.message).toBeNull();
    expect(outcome.fields).toMatchObject({
      fillEndState: "unknown",
      fillEndStateSource: "unknown",
      preFillLevel: 0.25,
      preFillLevelSource: "direct-gauge",
      postFillLevel: null,
    });
    expect(outcome.displayAfterLevel).toBeNull();
  });

  it("an explicit 'partial' with nothing else is user-confirmed and level-less", () => {
    const outcome = resolveTankOutcome({
      draft: withEndChoice(EMPTY_TANK_DRAFT, "partial"),
      litersAdded: 20,
      capacity: trusted,
    });
    expect(outcome.endState).toBe("partial");
    expect(outcome.endStateSource).toBe("user-confirmed");
    expect(outcome.state).toBe("unknownBefore");
    expect(outcome.fields.postFillLevel).toBeNull();
  });

  it("no capacity: percentages are stored, litres are not derived", () => {
    const outcome = resolveTankOutcome({
      draft: draft({ beforeLevel: 0.25 }),
      litersAdded: 20,
      capacity: none,
    });
    expect(outcome.state).toBe("noCapacity");
    expect(outcome.displayAfterLevel).toBeNull();
    expect(outcome.fields).toMatchObject({
      fillEndState: "partial",
      preFillLevel: 0.25,
      postFillLevel: null,
      capacityLitersAtEntry: null,
      tankSchemaVersion: TANK_SCHEMA_VERSION,
    });

    const fillup = stored("a", { odometer: 1000, liters: 20 }, outcome.fields);
    const balance = replay([fillup], none);
    expect(balance.anchor).toBeNull();
    expect(balance.lastLevelReport?.level).toBe(0.25);
  });

  it("full-to-partial across two records replays both anchors correctly", () => {
    const first = resolveTankOutcome({
      draft: withEndChoice(EMPTY_TANK_DRAFT, "full"),
      litersAdded: 30,
      capacity: trusted,
    });
    const second = resolveTankOutcome({
      draft: draft({ beforeLevel: 0.25 }),
      litersAdded: 20,
      capacity: trusted,
    });
    const fillups = [
      stored("a", { date: T0, odometer: 1000, liters: 30 }, first.fields),
      stored("b", { date: T0 + 10 * DAY, odometer: 1500, liters: 20 }, second.fields),
    ];

    // 45 L, 500 km at 0.06 L/km → 15 L; the stated 11.25 L is within noise.
    const balance = replay(fillups, trusted, { litersPerKm: 0.06 });
    expect(balance.notes.some((n) => n.state === "conflict")).toBe(false);
    expect(balance.anchor?.sourceId).toBe("b");
    expect(balance.anchor?.quality).toBe("derived");
    expect(balance.anchor!.liters / 45).toBeCloseTo(second.displayAfterLevel!, 9);

    const events = buildEventStream(fillups, [], 45).flatMap((event) =>
      event.kind === "fillup" ? [event] : [],
    );
    expect(levelAfter(events[0], 45)).toBe(1);
    expect(levelAfter(events[1], 45)).toBeCloseTo(second.displayAfterLevel!, 9);
  });

  it("a later capacity confirmation does not rewrite what an old record derived", () => {
    const outcome = resolveTankOutcome({
      draft: withEndChoice(EMPTY_TANK_DRAFT, "full"),
      litersAdded: 30,
      capacity: estimated,
    });
    expect(outcome.fields.capacityLitersAtEntry).toBe(45);
    const fillup = stored("a", { odometer: 1000, liters: 30 }, outcome.fields);

    // The user later confirms the tank is 50 L. The record is untouched, and
    // its derived before level still uses the 45 it was entered against.
    const event = toFillEvent(fillup, 50);
    expect(event.capacityAtEntry).toBe(45);
    expect(event.preFill?.level).toBeCloseTo((45 - 30) / 45, 9);
    expect(fillup.capacityLitersAtEntry).toBe(45);

    // The CURRENT balance anchors at the confirmed capacity, as it should.
    const balance = replay([fillup], resolveCapacity({ ...TRUSTED_45, tankLiters: 50 }));
    expect(balance.anchor?.liters).toBe(50);
  });
});

/* ------------------------------------------------------------------ *
 * Tolerance: the audit's reproduction
 * ------------------------------------------------------------------ */

describe("over-capacity tolerance", () => {
  it("TANK-03: estimated 45 L, before 25%, +38 L is within the uncertainty", () => {
    const added = 38 / 45; // 0.844
    const untrustedSd = impliedAfterSd(added, estimated);
    const trustedSd = impliedAfterSd(added, trusted);

    // sd = sqrt(0.05² + (0.844 × 0.04 × 3)²) = sqrt(0.0025 + 0.01027) ≈ 0.113
    expect(untrustedSd).toBeCloseTo(0.113, 3);
    // sd = sqrt(0.05² + (0.844 × 0.04)²) = sqrt(0.0025 + 0.00114) ≈ 0.0603
    expect(trustedSd).toBeCloseTo(0.0603, 3);
    // Thresholds: 1 + 2σ = 1.226 (estimate) and 1.121 (trusted). Both above
    // the implied 1.094, so neither is flagged — the flat 5% rule was.
    expect(overCapacityThreshold(untrustedSd)).toBeCloseTo(1.226, 3);
    expect(overCapacityThreshold(trustedSd)).toBeCloseTo(1.121, 3);
    expect(0.25 + added).toBeCloseTo(1.094, 3);
    expect(0.25 + added).toBeGreaterThan(1 + FULL_TANK_TOLERANCE_FRACTION);

    const withEstimate = resolveTankOutcome({
      draft: draft({ beforeLevel: 0.25 }),
      litersAdded: 38,
      capacity: estimated,
    });
    expect(withEstimate.state).toBe("ok");
    expect(withEstimate.toleranceSd).toBeCloseTo(untrustedSd, 9);
    expect(withEstimate.displayAfterLevel).toBe(1);
    // Effectively full within noise, but the user did not SAY full: nothing
    // is stored as a measured 100%.
    expect(withEstimate.fields.postFillLevel).toBeNull();

    const withTrusted = resolveTankOutcome({
      draft: draft({ beforeLevel: 0.25 }),
      litersAdded: 38,
      capacity: trusted,
    });
    expect(withTrusted.state).toBe("ok");
  });

  it("before 50% + 38 L is flagged, and attributed by capacity provenance", () => {
    expect(
      resolveTankOutcome({ draft: draft({ beforeLevel: 0.5 }), litersAdded: 38, capacity: trusted })
        .state,
    ).toBe("overCapacity");
    expect(
      resolveTankOutcome({ draft: draft({ beforeLevel: 0.5 }), litersAdded: 38, capacity: estimated })
        .state,
    ).toBe("capacitySuspect");
  });

  it("the audit's five-fill history plus a quarter-tank full does not flag the state", () => {
    // Estimate 45 L, five ~40 L confirmed fulls every 500 km, then before ¼
    // + 38 L confirmed full — what a normal driver with a slightly bigger
    // tank than our guess looks like.
    const history: Fillup[] = [];
    for (let i = 0; i < 5; i += 1) {
      const outcome = resolveTankOutcome({
        draft: withEndChoice(EMPTY_TANK_DRAFT, "full"),
        litersAdded: 40,
        capacity: estimated,
      });
      history.push(
        stored(`h${i}`, { date: T0 + i * 7 * DAY, odometer: 1000 + i * 500, liters: 40 }, outcome.fields),
      );
    }
    const last = resolveTankOutcome({
      draft: withEndChoice(draft({ beforeLevel: 0.25 }), "full"),
      litersAdded: 38,
      capacity: estimated,
    });
    expect(last.state).toBe("ok");
    history.push(
      stored("last", { date: T0 + 35 * DAY, odometer: 3500, liters: 38 }, last.fields),
    );

    const estimate = estimateTank({
      fillups: history,
      observations: [],
      vehicle: ESTIMATED_45,
      preferences: DEFAULT_TANK_PREFERENCES,
      now: T0 + 36 * DAY,
    });

    expect(estimate.activeNotes.some((n) => n.state === "conflict")).toBe(false);
    expect(estimate.activeNotes.some((n) => n.state === "overCapacity")).toBe(false);
    for (const note of estimate.capacityNotes) expect(note.state).toBe("capacitySuspect");
    expect(estimate.lastRefuel?.level).toBe(1);
    expect(estimate.current.level).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The compatibility adapter
 * ------------------------------------------------------------------ */

describe("projectAfterFill adapter", () => {
  it("is a view of the outcome, including unknown litres", () => {
    const empty = projectAfterFill({
      beforeLevel: 0.25,
      litersAdded: null,
      capacityLiters: 45,
      confirmedFull: false,
    });
    expect(empty.state).toBe("unknownLiters");
    expect(empty.level).toBeNull();

    const projected = projectAfterFill({
      beforeLevel: 0.25,
      litersAdded: 20,
      capacityLiters: 45,
      confirmedFull: false,
    });
    const outcome = resolveTankOutcome({
      draft: draft({ beforeLevel: 0.25 }),
      litersAdded: 20,
      capacity: trusted,
    });
    expect(projected.level).toBe(outcome.displayAfterLevel);
    expect(projected.liters).toBeCloseTo(outcome.displayAfterLevel! * 45, 9);
    expect(projected.source).toBe("derived-after-partial");
  });

  it("uses the capacity's provenance when it is passed", () => {
    const asTrusted = projectAfterFill({
      beforeLevel: 0.5,
      litersAdded: 38,
      capacityLiters: 45,
      confirmedFull: false,
    });
    expect(asTrusted.state).toBe("overCapacity");

    const asEstimate = projectAfterFill({
      beforeLevel: 0.5,
      litersAdded: 38,
      capacityLiters: 45,
      confirmedFull: false,
      capacity: estimated,
    });
    expect(asEstimate.state).toBe("capacitySuspect");
    expect(asEstimate.level).toBe(1);
    expect(asEstimate.impliedLevel).toBeCloseTo(1.344, 3);
  });
});

/* ------------------------------------------------------------------ *
 * Litres vs capacity, for the form's soft warnings
 * ------------------------------------------------------------------ */

describe("litersVsCapacity", () => {
  it("calls an overfill of a confirmed tank an overfill", () => {
    expect(litersVsCapacity(47, trusted).state).toBe("ok"); // within 5%
    const result = litersVsCapacity(50, trusted);
    expect(result.state).toBe("overfill");
    expect(result.message).toContain("שאישרת");
  });

  it("calls an overfill of an estimated tank a capacity finding, not a bad record", () => {
    // Headroom is two widened standard deviations: 2 × 0.04 × 3 = 24%.
    expect(UNTRUSTED_CAPACITY_HEADROOM).toBeCloseTo(0.24, 9);
    expect(litersVsCapacity(50, estimated).state).toBe("ok");
    const result = litersVsCapacity(57, estimated);
    expect(result.state).toBe("suspectCapacity");
    expect(result.message).not.toContain("חריג");
    expect(result.detail).toContain("נפח המיכל");
  });

  it("has nothing to say without a capacity", () => {
    expect(litersVsCapacity(80, none)).toEqual({ state: "ok", message: null, detail: null });
  });
});

/* ------------------------------------------------------------------ *
 * TANK-04: the cache key covers every field the model reads
 * ------------------------------------------------------------------ */

describe("tankInputSignature", () => {
  const baseFillup: Fillup = {
    id: "f",
    date: T0,
    odometer: 1000,
    liters: 30,
    pricePerLiter: 7,
    totalCost: 210,
    isFullTank: true,
    station: null,
    notes: "",
    fillEndState: "full",
    fillEndStateSource: "user-confirmed",
    preFillLevel: 0.25,
    preFillLevelSource: "direct-gauge",
    preFillLevelUncertainty: 0.05,
    postFillLevel: 0.9,
    postFillLevelSource: "user-correction",
    postFillLevelUncertainty: 0.05,
    refuelReason: "routine",
    continuityBreakBefore: false,
    capacityLitersAtEntry: 45,
    tankSchemaVersion: TANK_SCHEMA_VERSION,
  };
  const baseObservation: TankObservation = {
    id: "o",
    vehicleId: "v1",
    observedAt: T0 + DAY,
    recordedAt: T0 + DAY,
    kind: "both",
    odometer: 1100,
    level: 0.5,
    levelUncertainty: 0.05,
    levelSource: "direct-gauge",
    confirmed: true,
    fillupId: null,
    phase: "standalone",
  };
  const basePreferences: TankPreferences = {
    reserveFraction: 0.25,
    refuelLevelOverride: null,
    usualFillStyle: "full",
    usualRefuelLevel: 0.3,
    habitResetAt: null,
  };
  const baseVehicle: Vehicle = {
    ...TRUSTED_45,
    declaredKmPerLiter: 15,
    declaredSource: "exact-year",
  };

  const signatureOf = (over: {
    fillup?: Partial<Fillup>;
    observation?: Partial<TankObservation>;
    vehicle?: Partial<Vehicle>;
    preferences?: Partial<TankPreferences>;
  }) =>
    tankInputSignature({
      uid: "u",
      vehicle: { ...baseVehicle, ...over.vehicle },
      fillups: [{ ...baseFillup, ...over.fillup }],
      observations: [{ ...baseObservation, ...over.observation }],
      plans: [],
      preferences: { ...basePreferences, ...over.preferences },
    });
  const base = signatureOf({});

  it("changes when any field the model reads changes", () => {
    const fillupMutations: Partial<Fillup> = {
      date: T0 + 1,
      odometer: 1001,
      liters: 31,
      isFullTank: false,
      fillEndState: "partial",
      fillEndStateSource: "gauge-estimate",
      preFillLevel: 0.3,
      preFillLevelSource: "derived-after-partial",
      preFillLevelUncertainty: 0.08,
      postFillLevel: 0.8,
      postFillLevelSource: "derived-after-partial",
      postFillLevelUncertainty: 0.08,
      refuelReason: "low-fuel",
      continuityBreakBefore: true,
      capacityLitersAtEntry: 50,
      tankSchemaVersion: 1,
    };
    for (const [key, value] of Object.entries(fillupMutations)) {
      expect(signatureOf({ fillup: { [key]: value } }), `fillup.${key}`).not.toBe(base);
    }

    const observationMutations: Partial<TankObservation> = {
      observedAt: T0 + DAY + 1,
      odometer: 1101,
      level: 0.6,
      levelUncertainty: 0.08,
      levelSource: "user-correction",
      confirmed: false,
      fillupId: "f",
      phase: "after_refuel",
    };
    for (const [key, value] of Object.entries(observationMutations)) {
      expect(signatureOf({ observation: { [key]: value } }), `observation.${key}`).not.toBe(base);
    }

    const vehicleMutations: Partial<Vehicle> = {
      tankLiters: 50,
      tankLitersSource: "estimate",
      fuelType: "98",
      declaredKmPerLiter: 16,
      declaredSource: "other-year",
    };
    for (const [key, value] of Object.entries(vehicleMutations)) {
      expect(signatureOf({ vehicle: { [key]: value } }), `vehicle.${key}`).not.toBe(base);
    }

    const preferenceMutations: Partial<TankPreferences> = {
      reserveFraction: 0.3,
      refuelLevelOverride: 0.4,
      usualFillStyle: "partial",
      usualRefuelLevel: 0.35,
      habitResetAt: T0,
    };
    for (const [key, value] of Object.entries(preferenceMutations)) {
      expect(signatureOf({ preferences: { [key]: value } }), `preferences.${key}`).not.toBe(base);
    }
  });

  it("does not change for fields the model never reads", () => {
    expect(signatureOf({ fillup: { notes: "washed the car" } })).toBe(base);
    expect(
      signatureOf({ fillup: { station: { stationId: "s", name: "Paz", brand: "paz" } as never } }),
    ).toBe(base);
    expect(signatureOf({ fillup: { totalCost: 999 } })).toBe(base);
    expect(signatureOf({ fillup: { pricePerLiter: 9 } })).toBe(base);
  });

  it("a provenance-only edit changes both the signature and the reading's standing", () => {
    const direct = { ...baseFillup, postFillLevel: null, postFillLevelSource: null };
    const derived: Fillup = { ...direct, preFillLevelSource: "derived-after-partial" };

    expect(toFillEvent(direct, 45).preFill?.confirmed).toBe(true);
    expect(toFillEvent(derived, 45).preFill?.confirmed).toBe(false);
    expect(toFillEvent(direct, 45).preFill?.level).toBe(toFillEvent(derived, 45).preFill?.level);

    const signature = (fillup: Fillup) =>
      tankInputSignature({
        uid: "u",
        vehicle: baseVehicle,
        fillups: [fillup],
        observations: [],
        plans: [],
        preferences: basePreferences,
      });
    expect(signature(direct)).not.toBe(signature(derived));
  });
});


describe("tank measurement serializer/read/model round trips", () => {
  for (const capacity of [none, estimated, trusted]) {
    it(`keeps unknown before evidence for ${capacity.liters ?? "missing"} capacity, trusted=${capacity.trusted}`, () => {
      const outcome = resolveTankOutcome({ draft: withEndChoice(draft({ beforeLevel: 0.25 }), "unknown"), litersAdded: 12, capacity });
      const payload = serializeFillup(stored("unknown", { odometer: 1000, liters: 12 }, outcome.fields));
      const read = parseFillupDocument("unknown", { ...payload, createdAt: T0 });
      expect(read.ok).toBe(true);
      if (!read.ok) throw new Error(read.reason);
      expect(toFillEvent(read.fillup, capacity.liters).preFill?.level).toBe(0.25);
      const reopened = resolveTankOutcome({ draft: draftFromFields(read.fillup), litersAdded: read.fillup.liters, capacity });
      expect(reopened.fields).toEqual(outcome.fields);
      expect(reopened.displayAfterLevel).toBeNull();
    });

    it(`keeps after-only without inventing before for ${capacity.liters ?? "missing"} capacity, trusted=${capacity.trusted}`, () => {
      const outcome = resolveTankOutcome({ draft: draft({ afterLevelOverride: 0.6 }), litersAdded: 12, capacity });
      const payload = serializeFillup(stored("after", { odometer: 1000, liters: 12 }, outcome.fields));
      const read = parseFillupDocument("after", { ...payload, createdAt: T0 });
      expect(read.ok).toBe(true);
      if (!read.ok) throw new Error(read.reason);
      expect(toFillEvent(read.fillup, capacity.liters).postFill?.level).toBe(0.6);
      expect(read.fillup.preFillLevel).toBeNull();
      const reopened = resolveTankOutcome({ draft: draftFromFields(read.fillup), litersAdded: read.fillup.liters, capacity });
      expect(reopened.fields).toEqual(outcome.fields);
      expect(reopened.displayAfterLevel).toBe(0.6);
      expect(reopened.displayBeforeLevel).toBeNull();
    });
  }
});
