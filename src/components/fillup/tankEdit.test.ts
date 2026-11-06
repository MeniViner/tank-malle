import { describe, expect, it } from "vitest";
import { evaluateDraft, type Fillup } from "../../lib/stats";
import type { ResolvedCapacity } from "../../lib/tank/capacity";
import { draftFromFields, EMPTY_TANK_DRAFT, resolveTankOutcome, withEndChoice, type TankStateDraft } from "../../lib/tank/draft";
import { toFillEvent } from "../../lib/tank/observations";
import type { FillupTankFields } from "../../lib/tank/types";
import { resolveEditedTank, selectTankDraft, selectTankOriginal } from "./tankEdit";

const capacity: ResolvedCapacity = { liters: 50, source: "user", trusted: true, suggestion: null };
const imported: Required<FillupTankFields> = {
  preFillLevel: .2, preFillLevelSource: "imported-legacy", preFillLevelUncertainty: .17,
  postFillLevel: .8, postFillLevelSource: "imported-legacy", postFillLevelUncertainty: .19,
  fillEndState: "unknown", fillEndStateSource: "legacy-assumption", refuelReason: "routine",
  capacityLitersAtEntry: 45, tankSchemaVersion: 2,
};
function fillup(fields: Partial<Fillup> = {}): Fillup {
  return { id: "original", date: 1_000, odometer: 100_000, liters: 40,
    pricePerLiter: 7.185, totalCost: 287.4001234567, isFullTank: false,
    fullTankSource: "legacy-assumption", ...imported, ...fields };
}

describe("restoring a pre-upgrade tank draft", () => {
  it.each([undefined, 1])("keeps a legacy reason and exact tank evidence through a note-only save (schema %s)", tankSchemaVersion => {
    const original = fillup({ tankSchemaVersion, refuelReason: "before-trip", notes: "הערה מקורית" });
    for (const reason of [null, undefined]) {
      // 1.7.2 initialized old-schema edit drafts with EMPTY_TANK_DRAFT.
      // Serialize the missing-key variant just as persisted drafts travel.
      const restored = JSON.parse(JSON.stringify({ ...EMPTY_TANK_DRAFT, reason })) as TankStateDraft;
      const selected = selectTankDraft(original, restored);
      expect(selected).toEqual({ ...EMPTY_TANK_DRAFT, reason: "before-trip" });
      const edited = resolveEditedTank({ original, draft: selected, litersAdded: 40, capacity });
      expect(edited.preserved).toBe(true);
      expect({ ...original, ...edited.fields, notes: "הערה חדשה" }).toEqual({ ...original, notes: "הערה חדשה" });
      expect(restored.reason).toBe(reason);
      expect(original.refuelReason).toBe("before-trip");
    }
  });

  it("keeps explicit physical edits from the old draft while restoring only its missing reason", () => {
    const original = fillup({ tankSchemaVersion: 1, refuelReason: "before-trip" });
    const restored = withEndChoice({ ...EMPTY_TANK_DRAFT, beforeLevel: .1 }, "partial");
    const selected = selectTankDraft(original, restored);
    expect(selected).toEqual({ ...restored, reason: "before-trip" });
    const edited = resolveEditedTank({ original, draft: selected, litersAdded: 40, capacity });
    expect(edited.preserved).toBe(false);
    expect(edited.fields).toMatchObject({ preFillLevel: .1, preFillLevelSource: "direct-gauge",
      postFillLevel: .9, postFillLevelSource: "derived-after-partial", refuelReason: "before-trip" });
    expect(restored.reason).toBeNull();
    expect(original.preFillLevelSource).toBe("imported-legacy");
  });

  it("preserves a non-null restored reason and current-schema reason removal", () => {
    const legacy = fillup({ tankSchemaVersion: 1, refuelReason: "before-trip" });
    const deliberate = { ...EMPTY_TANK_DRAFT, reason: "good-price" as const };
    expect(selectTankDraft(legacy, deliberate)).toBe(deliberate);
    expect(resolveEditedTank({ original: legacy, draft: deliberate, litersAdded: 40, capacity }).fields.refuelReason).toBe("good-price");
    const current = fillup({ refuelReason: "before-trip" });
    const cleared = { ...draftFromFields(current), reason: null };
    expect(selectTankDraft(current, cleared)).toBe(cleared);
    expect(resolveEditedTank({ original: current, draft: cleared, litersAdded: 40, capacity }).fields.refuelReason).toBeNull();
  });

  it("keeps normal opening and new-transaction drafts unchanged", () => {
    const original = fillup({ tankSchemaVersion: 1, refuelReason: "before-trip" });
    expect(selectTankDraft(original, null)).toEqual(draftFromFields(original));
    expect(selectTankDraft(null, undefined)).toBe(EMPTY_TANK_DRAFT);
    const restored = { ...EMPTY_TANK_DRAFT, beforeLevel: .2 };
    expect(selectTankDraft(null, restored)).toBe(restored);
  });
});

describe("editing existing tank evidence", () => {
  it("opening imported v2 gauges does not change their values, provenance, uncertainty or endpoint", () => {
    const original = fillup();
    const edited = resolveEditedTank({ original, draft: draftFromFields(original), litersAdded: 40, capacity });
    expect(edited.fields).toEqual(imported);
    expect(edited.isFullTank).toBe(false);
    expect(edited.endState).toBe("unknown");
    expect(edited.outcome.displayBeforeLevel).toBe(.2);
    expect(edited.outcome.displayAfterLevel).toBe(.8);
    expect(edited.preserved).toBe(true);
    expect(evaluateDraft({ ...original, fillEndState: edited.endState }, []).outcome).toBe("unknownRetained");
    expect(original).toEqual(fillup());
  });

  it("a current-schema full record keeps all saved fields even when its old post reading contradicts the full anchor", () => {
    const original = fillup({ isFullTank: true, fillEndState: "full", fillEndStateSource: "user-confirmed" });
    const edited = resolveEditedTank({ original, draft: draftFromFields(original), litersAdded: 40, capacity });
    expect(edited.fields).toEqual({ ...imported, fillEndState: "full", fillEndStateSource: "user-confirmed" });
    expect(edited.isFullTank).toBe(true);
    expect(edited.outcome.displayAfterLevel).toBe(1);
  });

  it("uses the legacy boolean for evaluation while preserving conflicting old optional endpoint fields", () => {
    const original = fillup({ tankSchemaVersion: 1, isFullTank: true });
    const edited = resolveEditedTank({ original, draft: draftFromFields(original), litersAdded: 40, capacity });
    expect(edited.fields).toEqual({ ...imported, tankSchemaVersion: 1 });
    expect(edited.endState).toBe("full");
    expect(edited.outcome.endStateSource).toBe("legacy-assumption");
    expect(evaluateDraft({ ...original, fillEndState: edited.endState }, []).outcome).toBe("baseline");
  });

  it.each([1, 2])("changing only the reason preserves every independent field on schema %s", tankSchemaVersion => {
    const original = fillup({ tankSchemaVersion });
    const edited = resolveEditedTank({ original, draft: { ...draftFromFields(original), reason: "good-price" }, litersAdded: 40, capacity });
    expect(edited.fields).toEqual({ ...imported, tankSchemaVersion, refuelReason: "good-price" });
    expect(edited.isFullTank).toBe(false);
  });

  it.each([undefined, 1])("an old-schema reason survives a gauge edit and reset without adopting old measurements (schema %s)", tankSchemaVersion => {
    const original = fillup({ tankSchemaVersion, refuelReason: "before-trip" });
    const opening = draftFromFields(original);
    expect(opening).toEqual({ ...EMPTY_TANK_DRAFT, reason: "before-trip" });
    const changed = { ...opening, beforeLevel: .1 };
    const edited = resolveEditedTank({ original, draft: changed, litersAdded: 40, capacity });
    expect(edited.fields).toMatchObject({ refuelReason: "before-trip", preFillLevel: .1, preFillLevelSource: "direct-gauge" });
    const reset = { ...EMPTY_TANK_DRAFT, reason: changed.reason };
    const restored = resolveEditedTank({ original, draft: reset, litersAdded: 40, capacity });
    expect(restored.preserved).toBe(true);
    expect(restored.fields).toEqual({ ...imported, tankSchemaVersion, refuelReason: "before-trip" });
    expect(original).toEqual(fillup({ tankSchemaVersion, refuelReason: "before-trip" }));
  });

  it("returning physical answers to the opening values after a local draft reload restores exact preservation", () => {
    const original = fillup();
    const opening = draftFromFields(original);
    const changed = { ...withEndChoice(opening, "full"), beforeLevel: .05 };
    expect(resolveEditedTank({ original, draft: changed, litersAdded: 40, capacity }).preserved).toBe(false);
    const restored = JSON.parse(JSON.stringify({ base: original, tankOriginal: original,
      tankDraft: { ...withEndChoice(changed, null), beforeLevel: .2 } }));
    const snapshot = selectTankOriginal({ initial: fillup({ postFillLevel: .9 }), restored, correctingOperation: false });
    const edited = resolveEditedTank({ original: snapshot, draft: restored.tankDraft, litersAdded: 40, capacity });
    expect(edited.fields).toEqual(imported);
    expect(edited.preserved).toBe(true);
  });

  it("an actual before-gauge change remains a new answer after reload and uses the protected resolver", () => {
    const original = fillup();
    const restored = JSON.parse(JSON.stringify({ base: original, tankOriginal: original,
      tankDraft: { ...draftFromFields(original), beforeLevel: .1 } }));
    const snapshot = selectTankOriginal({ initial: original, restored, correctingOperation: false });
    const edited = resolveEditedTank({ original: snapshot, draft: restored.tankDraft, litersAdded: 40, capacity });
    expect(edited.fields).toEqual(resolveTankOutcome({ draft: restored.tankDraft, litersAdded: 40, capacity }).fields);
    expect(edited.fields).toMatchObject({ preFillLevel: .1, preFillLevelSource: "direct-gauge",
      postFillLevel: .9, postFillLevelSource: "derived-after-partial", fillEndState: "partial" });
    expect(edited.preserved).toBe(false);
  });

  it("changing only litres does not recast independent imported readings as user measurements", () => {
    const original = fillup();
    const edited = resolveEditedTank({ original, draft: draftFromFields(original), litersAdded: 35, capacity });
    expect(edited.fields).toEqual(imported);
    expect(edited.outcome.displayAfterLevel).toBe(.8);
    expect(edited.endState).toBe("unknown");
  });

  it.each(["direct-gauge", "imported-legacy"] as const)("changing litres recalculates only derived-after using the recorded capacity, preserving the %s before reading", preFillLevelSource => {
    const original = fillup({ liters: 20, preFillLevelSource, preFillLevelUncertainty: .12,
      postFillLevel: .7, postFillLevelSource: "derived-after-partial", postFillLevelUncertainty: .18,
      fillEndState: "partial", fillEndStateSource: "user-confirmed", capacityLitersAtEntry: 40 });
    const edited = resolveEditedTank({ original, draft: draftFromFields(original), litersAdded: 24, capacity });
    expect(edited.fields).toEqual({ ...imported, preFillLevelSource, preFillLevelUncertainty: .12,
      postFillLevel: .8, postFillLevelSource: "derived-after-partial", postFillLevelUncertainty: .18,
      fillEndState: "partial", fillEndStateSource: "user-confirmed", capacityLitersAtEntry: 40 });
    expect(edited.isFullTank).toBe(false);
    expect(edited.outcome.displayAfterLevel).toBe(.8);
  });

  it("changing litres clears a stale derived-before copy and lets the canonical full anchor derive the new before level", () => {
    const original = fillup({ liters: 20, isFullTank: true, fillEndState: "full", fillEndStateSource: "user-confirmed",
      preFillLevel: .6, preFillLevelSource: "derived-from-full-and-liters", preFillLevelUncertainty: .11,
      postFillLevel: .95, postFillLevelSource: "user-correction", postFillLevelUncertainty: .08,
      capacityLitersAtEntry: 50 });
    const edited = resolveEditedTank({ original, draft: draftFromFields(original), litersAdded: 30,
      capacity: { ...capacity, liters: 60 } });
    expect(edited.fields).toMatchObject({ preFillLevel: null, preFillLevelSource: null, preFillLevelUncertainty: null,
      postFillLevel: .95, postFillLevelSource: "user-correction", postFillLevelUncertainty: .08,
      capacityLitersAtEntry: 50, fillEndState: "full", fillEndStateSource: "user-confirmed" });
    expect(edited.outcome.displayBeforeLevel).toBe(.4);
    expect(edited.outcome.beforeIsDerived).toBe(true);
    expect(toFillEvent({ ...original, ...edited.fields, liters: 30 }, 60).preFill).toMatchObject({
      level: .4, source: "derived-from-full-and-liters", confirmed: false,
    });
    expect(resolveEditedTank({ original, draft: draftFromFields(original), litersAdded: 20, capacity }).fields.preFillLevel).toBe(.6);
  });

  it("increasing litres widens a formerly low derived uncertainty using the original gauge uncertainty and unverified historical capacity", () => {
    const original = fillup({ liters: 20, preFillLevelSource: "direct-gauge", preFillLevelUncertainty: .12,
      postFillLevel: .7, postFillLevelSource: "derived-after-partial", postFillLevelUncertainty: .01,
      fillEndState: "partial", fillEndStateSource: "user-confirmed", capacityLitersAtEntry: 40 });
    const edited = resolveEditedTank({ original, draft: draftFromFields(original), litersAdded: 30, capacity });
    expect(edited.fields.postFillLevel).toBe(.95);
    expect(edited.fields.postFillLevelUncertainty).toBeCloseTo(.15, 12);
    expect(edited.fields).toMatchObject({ preFillLevel: .2, preFillLevelSource: "direct-gauge",
      preFillLevelUncertainty: .12, postFillLevelSource: "derived-after-partial", capacityLitersAtEntry: 40 });
    expect(resolveEditedTank({ original, draft: draftFromFields(original), litersAdded: 20, capacity }).fields.postFillLevelUncertainty).toBe(.01);
  });

  it("does not label a different historical capacity revision as today's trusted capacity", () => {
    const original = fillup({ liters: 20, postFillLevel: .7, postFillLevelSource: "derived-after-partial",
      fillEndState: "partial", fillEndStateSource: "user-confirmed", capacityLitersAtEntry: 40 });
    const edited = resolveEditedTank({ original, draft: draftFromFields(original), litersAdded: 48, capacity });
    expect(edited.outcome.state).toBe("capacitySuspect");
    expect(edited.fields.capacityLitersAtEntry).toBe(40);
  });

  it("does not persist a fabricated full gauge when an edited quantity exceeds the tank", () => {
    const original = fillup({ liters: 20, postFillLevel: .7, postFillLevelSource: "derived-after-partial",
      fillEndState: "partial", fillEndStateSource: "gauge-estimate", capacityLitersAtEntry: 40 });
    const edited = resolveEditedTank({ original, draft: draftFromFields(original), litersAdded: 40, capacity });
    expect(edited.fields).toMatchObject({ postFillLevel: null, postFillLevelSource: null, postFillLevelUncertainty: null,
      preFillLevel: .2, preFillLevelSource: "imported-legacy", preFillLevelUncertainty: .17,
      fillEndState: "partial", fillEndStateSource: "gauge-estimate" });
    expect(edited.isFullTank).toBe(false);
  });

  it("normal new forms retain the protected resolver's unknown and explicit-full behavior", () => {
    for (const draft of [EMPTY_TANK_DRAFT, withEndChoice(EMPTY_TANK_DRAFT, "full")]) {
      const edited = resolveEditedTank({ original: null, draft, litersAdded: 30, capacity });
      const expected = resolveTankOutcome({ draft, litersAdded: 30, capacity });
      expect(edited.fields).toEqual(expected.fields);
      expect(edited.outcome).toEqual(expected);
      expect(edited.isFullTank).toBe(expected.endState === "full");
    }
  });
});

describe("tank opening snapshot versus an update's concurrency base", () => {
  it("restores a corrected update's displayed tank snapshot separately from its older CAS base", () => {
    const base = fillup({ postFillLevel: .6 });
    const displayed = fillup({ postFillLevel: .8 });
    const first = selectTankOriginal({ initial: displayed, restored: { base }, correctingOperation: true });
    expect(first?.postFillLevel).toBe(.8);
    const restored = JSON.parse(JSON.stringify({ base, tankOriginal: first }));
    const next = selectTankOriginal({ initial: fillup({ postFillLevel: .9 }), restored, correctingOperation: true });
    expect(next?.postFillLevel).toBe(.8);
    expect(restored.base.postFillLevel).toBe(.6);
    expect(resolveEditedTank({ original: next, draft: draftFromFields(displayed), litersAdded: 40, capacity }).fields.postFillLevel).toBe(.8);
  });

  it("an older ordinary edit draft keeps its original base when the listener has advanced", () => {
    const base = fillup({ postFillLevel: .6 });
    const original = selectTankOriginal({ initial: fillup({ postFillLevel: .9 }), restored: { base }, correctingOperation: false });
    expect(original?.postFillLevel).toBe(.6);
  });
});
