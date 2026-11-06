import type { FillupDraft } from "../../lib/fillupDraft";
import type { Fillup } from "../../lib/stats";
import type { ResolvedCapacity } from "../../lib/tank/capacity";
import { GAUGE_SD_BY_SOURCE, TANK_SCHEMA_VERSION } from "../../lib/tank/config";
import { draftFromFields, effectiveEndChoice, EMPTY_TANK_DRAFT, impliedAfterSd, resolveTankOutcome, type PersistedTankFields, type TankOutcome, type TankStateDraft } from "../../lib/tank/draft";
import { resolveEndState } from "../../lib/tank/observations";
import type { FillEndState, FillupTankFields, LevelSource } from "../../lib/tank/types";

const TANK_FIELDS = [
  "fillEndState", "fillEndStateSource", "preFillLevel", "preFillLevelSource",
  "preFillLevelUncertainty", "postFillLevel", "postFillLevelSource",
  "postFillLevelUncertainty", "refuelReason", "capacityLitersAtEntry", "tankSchemaVersion",
] as const satisfies readonly (keyof FillupTankFields)[];

function storedFields(original: Fillup): FillupTankFields {
  return Object.fromEntries(TANK_FIELDS.map(key => [key, original[key]]));
}

function isDerived(source: LevelSource | null | undefined): boolean {
  return source === "derived-from-full-and-liters" || source === "derived-after-partial";
}

function finiteLevel(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readingSd(source: LevelSource | null | undefined, stated: number | null | undefined): number {
  return typeof stated === "number" && Number.isFinite(stated) && stated > 0
    ? stated : GAUGE_SD_BY_SOURCE[source ?? "unknown"];
}

/**
 * The displayed record and an update's concurrency base can be different.
 * Persist the former separately, so restoring a rejected edit cannot turn its
 * existing tank measurements into newly stated answers against the latter.
 */
export function selectTankOriginal({ initial, restored, correctingOperation }: {
  initial: Fillup | null;
  restored: Pick<FillupDraft, "base" | "tankOriginal"> | null;
  correctingOperation: boolean;
}): Fillup | null {
  const original = restored && Object.hasOwn(restored, "tankOriginal")
    ? restored.tankOriginal ?? null
    : correctingOperation ? initial : restored?.base ?? initial;
  return original ? { ...original } : null;
}

/** Restore old edit drafts without treating their absent reason as a new deletion. */
export function selectTankDraft(original: Fillup | null, restored: TankStateDraft | null | undefined): TankStateDraft {
  if (!restored) return original ? draftFromFields(original) : EMPTY_TANK_DRAFT;
  // Before 1.7.3, legacy records opened with an empty tank draft even when a
  // historical reason existed. Only recover that metadata; the restored
  // physical answers and their provenance must remain the user's own inputs.
  const legacy = original && (original.tankSchemaVersion == null || original.tankSchemaVersion < TANK_SCHEMA_VERSION);
  if (legacy && restored.reason == null && original.refuelReason != null) {
    return { ...restored, reason: original.refuelReason };
  }
  return restored;
}

export interface EditedTank {
  /** Exact stored fields, or the protected resolver's fields for a new answer. */
  fields: FillupTankFields;
  isFullTank: boolean;
  /** The authoritative endpoint used by the consumption preview. */
  endState: FillEndState;
  outcome: TankOutcome;
  preserved: boolean;
}

/**
 * Editing is not a new measurement. draftFromFields intentionally cannot
 * reproduce every imported source, uncertainty or old endpoint. Compare its
 * semantic inputs to the opening snapshot instead of treating its presence
 * (or a schema version) as evidence that the user changed the tank.
 */
export function resolveEditedTank({ original, draft, litersAdded, capacity }: {
  original: Fillup | null;
  draft: TankStateDraft;
  litersAdded: number | null;
  capacity: ResolvedCapacity;
}): EditedTank {
  const opening = original ? draftFromFields(original) : null;
  const physicalChange = opening !== null && (
    (draft.beforeLevel ?? null) !== opening.beforeLevel ||
    (draft.afterLevelOverride ?? null) !== opening.afterLevelOverride ||
    effectiveEndChoice(draft) !== effectiveEndChoice(opening)
  );

  if (!original || physicalChange) {
    const outcome = resolveTankOutcome({ draft, litersAdded, capacity });
    return { fields: outcome.fields, isFullTank: outcome.endState === "full", endState: outcome.endState, outcome, preserved: false };
  }

  const endpoint = resolveEndState(original);
  const fields = storedFields(original);
  if ((draft.reason ?? null) !== opening!.reason) fields.refuelReason = draft.reason ?? null;
  const quantityChanged = litersAdded !== null && Number.isFinite(litersAdded) && litersAdded > 0 && litersAdded !== original.liters;
  const beforeDerived = isDerived(original.preFillLevelSource);
  const afterDerived = isDerived(original.postFillLevelSource);
  const recomputingDerived = quantityChanged && (beforeDerived || afterDerived);
  const entryCapacity = original.capacityLitersAtEntry;
  const calculationCapacity: ResolvedCapacity = typeof entryCapacity === "number" && Number.isFinite(entryCapacity) && entryCapacity > 0 && entryCapacity !== capacity.liters
    // Today's confirmation applies to today's number. An older recorded
    // revision has no stored trust flag and cannot inherit that confirmation.
    ? { liters: entryCapacity, source: "estimate", trusted: false, suggestion: entryCapacity } : capacity;

  // A stored derivation must never be fed back as a new gauge observation.
  // Resolve using the original capacity revision and known endpoint, then
  // select only the dependent evidence; all independent measurements survive.
  const calculated = resolveTankOutcome({
    draft: {
      beforeLevel: beforeDerived ? null : finiteLevel(original.preFillLevel),
      afterLevelOverride: null,
      endChoice: endpoint.state,
      confirmedFull: endpoint.state === "full",
      reason: draft.reason ?? null,
    },
    litersAdded,
    capacity: calculationCapacity,
  });

  if (recomputingDerived && beforeDerived) {
    // A full tank's before level is derived at read time from the new litres.
    // Canonical full outcomes persist no before reading: clear the old derived
    // copy instead of retaining a stale value or promoting it to direct-gauge.
    fields.preFillLevel = null;
    fields.preFillLevelSource = null;
    fields.preFillLevelUncertainty = null;
  }
  if (recomputingDerived && afterDerived) {
    let after = original.postFillLevelSource === "derived-after-partial" && endpoint.state === "partial"
      ? calculated.fields.postFillLevel : null;
    let uncertainty: number | null = null;
    if (after !== null && calculationCapacity.liters !== null && calculationCapacity.liters > 0 && litersAdded !== null) {
      uncertainty = Math.max(
        readingSd(original.postFillLevelSource, original.postFillLevelUncertainty),
        impliedAfterSd(litersAdded / calculationCapacity.liters, calculationCapacity,
          readingSd(original.preFillLevelSource, original.preFillLevelUncertainty)),
      );
      // A derived reading with uncertainty wider than the whole gauge cannot
      // be represented by a valid stored level. Keep the underlying inputs.
      if (uncertainty > 1) { after = null; uncertainty = null; }
    }
    fields.postFillLevel = after;
    fields.postFillLevelSource = after === null ? null : original.postFillLevelSource;
    fields.postFillLevelUncertainty = uncertainty;
  }

  // Display stored observations as stored. Only a genuine current-schema full
  // confirmation can supply a missing before level or override the after
  // gauge with the full anchor; legacy booleans remain assumptions.
  const confirmedFull = original.tankSchemaVersion === TANK_SCHEMA_VERSION && endpoint.state === "full" && endpoint.source === "user-confirmed";
  const storedBefore = finiteLevel(fields.preFillLevel);
  const displayBefore = storedBefore ?? (confirmedFull && calculated.beforeIsDerived ? calculated.displayBeforeLevel : null);
  const outcome: TankOutcome = {
    ...calculated,
    endState: endpoint.state,
    endStateSource: endpoint.source,
    displayBeforeLevel: displayBefore,
    beforeIsDerived: displayBefore !== null && (isDerived(fields.preFillLevelSource) || storedBefore === null),
    displayAfterLevel: confirmedFull ? 1 : finiteLevel(fields.postFillLevel),
    // This normalization is only for presentation. `fields` above retains
    // absence/null exactly and is the object sent to the serializer.
    fields: Object.fromEntries(TANK_FIELDS.map(key => [key, fields[key] ?? null])) as PersistedTankFields,
  };
  return { fields, isFullTank: original.isFullTank, endState: endpoint.state, outcome, preserved: !recomputingDerived };
}
