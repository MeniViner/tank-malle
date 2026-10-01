/**
 * The fill-up form's tank-state draft, and the ONE function that turns it
 * into an outcome.
 *
 * Preview, payload and replay used to be three separate computations: the
 * gauge drew `projectAfterFill`, the form persisted its own `buildTankFields`,
 * and the engine re-derived the level from whatever was stored. They agreed
 * most of the time. When they did not — a confirmed full with a before-level
 * set showed 100% on screen and stored 69% — the record contradicted itself.
 *
 * `resolveTankOutcome` is now the only place that decides. The preview reads
 * `displayAfterLevel`, the form spreads `fields` into the payload, and the
 * replay reads those same fields back. There is nothing left to disagree.
 *
 * Pure. No React, no Firebase, no clock.
 */

import type { ResolvedCapacity } from "./capacity";
import {
  CAPACITY_RELATIVE_SD,
  FULL_TANK_TOLERANCE_FRACTION,
  GAUGE_SD_BY_SOURCE,
  TANK_SCHEMA_VERSION,
  UNTRUSTED_CAPACITY_SD_FACTOR,
} from "./config";
import { clamp, isFiniteNumber } from "./numeric";
import type {
  FillEndState,
  FillEndStateSource,
  FillupTankFields,
  RefuelReason,
} from "./types";

/** What the user said about the END of the fill-up. */
export type TankEndChoice = "full" | "partial" | "unknown";

export interface TankStateDraft {
  /** Fuel remaining BEFORE filling, as set by the user. Null = not stated. */
  beforeLevel: number | null;
  /**
   * A user correction of the calculated after-level. Null = accept the maths.
   *
   * The CONTRACT: this is set only when the user actually changed or confirmed
   * the after value. Opening the correction editor is not a correction, and
   * copying the computed value in here on open would turn every cancelled
   * edit into `user-correction` provenance.
   */
  afterLevelOverride: number | null;
  /**
   * Compatibility alias: equals `endChoice === "full"`. Read `endChoice`
   * where it is set; this flag is consulted only for a draft that predates it.
   */
  confirmedFull: boolean;
  /**
   * The explicit end-state choice. Null (or absent, on an older draft) means
   * the user has not chosen — which is different from choosing "unknown".
   */
  endChoice?: TankEndChoice | null;
  reason: RefuelReason | null;
}

/** Nothing stated. The state a fill-up nobody interacted with must stay in. */
export const EMPTY_TANK_DRAFT: TankStateDraft = {
  beforeLevel: null,
  afterLevelOverride: null,
  confirmedFull: false,
  endChoice: null,
  reason: null,
};

/** True when the user told us something. Drives whether anything is stored. */
export function hasTankAnswer(draft: TankStateDraft): boolean {
  return (
    draft.beforeLevel !== null ||
    draft.afterLevelOverride !== null ||
    effectiveEndChoice(draft) !== null ||
    draft.reason !== null
  );
}

/**
 * The end choice a draft actually carries.
 *
 * `endChoice` is authoritative when set. A draft written before the field
 * existed only has the boolean, and a true one still means "full".
 */
export function effectiveEndChoice(draft: TankStateDraft): TankEndChoice | null {
  if (draft.endChoice !== undefined && draft.endChoice !== null) return draft.endChoice;
  return draft.confirmedFull ? "full" : null;
}

/**
 * Choose an end state, keeping `confirmedFull` and `endChoice` consistent.
 *
 * Choosing "full" clears a correction: a confirmed full IS the after value,
 * and keeping a stale override beside it is how two answers end up stored.
 */
export function withEndChoice(
  draft: TankStateDraft,
  choice: TankEndChoice | null,
): TankStateDraft {
  return {
    ...draft,
    endChoice: choice,
    confirmedFull: choice === "full",
    afterLevelOverride: choice === "full" ? null : draft.afterLevelOverride,
  };
}

/**
 * The draft a stored record opens as, for editing.
 *
 * Only a record written by the explicit tank-state UI can seed anything: a
 * legacy document's `isFullTank` is an assumption nobody made, and
 * pre-selecting "full" from it would turn that assumption into a confirmation
 * the moment the record was opened.
 */
export function draftFromFields(fields: FillupTankFields): TankStateDraft {
  if (fields.tankSchemaVersion !== TANK_SCHEMA_VERSION) return EMPTY_TANK_DRAFT;

  const confirmedFull =
    fields.fillEndState === "full" && fields.fillEndStateSource === "user-confirmed";
  const endChoice: TankEndChoice | null = confirmedFull
    ? "full"
    : fields.fillEndState === "unknown" && fields.fillEndStateSource === "unknown"
      ? "unknown"
      : fields.fillEndState === "partial" && fields.fillEndStateSource === "user-confirmed"
        ? "partial"
        : null;

  return {
    beforeLevel: isFiniteNumber(fields.preFillLevel) ? fields.preFillLevel : null,
    afterLevelOverride:
      fields.postFillLevelSource === "user-correction" && isFiniteNumber(fields.postFillLevel)
        ? fields.postFillLevel
        : null,
    confirmedFull,
    endChoice,
    reason: fields.refuelReason ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * The outcome
 * ------------------------------------------------------------------ */

export type TankOutcomeState =
  /** Consistent. */
  | "ok"
  /** Litres not typed yet; nothing derived. */
  | "unknownLiters"
  /** No capacity; percentages only. */
  | "noCapacity"
  /** No before level and not confirmed full; nothing derived. */
  | "unknownBefore"
  /**
   * The arithmetic exceeds the capacity beyond its uncertainty and the
   * capacity is NOT trusted: the capacity is probably larger than estimated.
   */
  | "capacitySuspect"
  /**
   * The arithmetic exceeds a TRUSTED capacity beyond its uncertainty: the
   * before level or the litres are suspect.
   */
  | "overCapacity"
  /**
   * A confirmed full contradicted by before-level + litres beyond the
   * uncertainty. The raw evidence is persisted unchanged.
   */
  | "conflict";

/** Every tank field, with every key present. Exactly what goes to Firestore. */
export type PersistedTankFields = Required<{
  [K in keyof FillupTankFields]: FillupTankFields[K] | null;
}>;

export interface TankOutcome {
  endState: FillEndState;
  endStateSource: FillEndStateSource;
  /** What the after gauge should DISPLAY (0–1, clamped), or null. */
  displayAfterLevel: number | null;
  /** Unclamped implied after level for the explanation, or null. */
  impliedAfterLevel: number | null;
  /**
   * The stated before level, or the one a confirmed full implies
   * (capacity − litres) when it is derivable.
   */
  displayBeforeLevel: number | null;
  beforeIsDerived: boolean;
  state: TankOutcomeState;
  /** Standard deviation (fraction of capacity) behind the tolerance. */
  toleranceSd: number | null;
  /** The fields to persist. The integrator spreads this into the payload. */
  fields: PersistedTankFields;
  /** Short Hebrew explanation when `state !== "ok"`. */
  message: string | null;
}

export interface TankOutcomeInput {
  draft: TankStateDraft;
  /** Null = not typed or not parseable. NEVER zero for "empty field". */
  litersAdded: number | null;
  /** From `resolveCapacity(vehicle, fillups)`. */
  capacity: ResolvedCapacity;
}

const EMPTY_FIELDS: Omit<PersistedTankFields, "capacityLitersAtEntry" | "tankSchemaVersion"> = {
  fillEndState: null,
  fillEndStateSource: null,
  preFillLevel: null,
  preFillLevelSource: null,
  preFillLevelUncertainty: null,
  postFillLevel: null,
  postFillLevelSource: null,
  postFillLevelUncertainty: null,
  refuelReason: null,
};

/**
 * Relative sd of the capacity, by provenance.
 *
 * An approximation is usable and must not be presented as if it were
 * measured; a wider band is how that honesty reaches the tolerance.
 */
export function capacityRelativeSd(capacity: Pick<ResolvedCapacity, "trusted">): number {
  return CAPACITY_RELATIVE_SD * (capacity.trusted ? 1 : UNTRUSTED_CAPACITY_SD_FACTOR);
}

/**
 * Standard deviation of `before + litres / capacity`, as a fraction.
 *
 * Two sources of error: the gauge the before level was read from (a slider
 * dragged to "about a quarter"), and the capacity the litres are divided by.
 * The pump reading itself is precise enough to ignore beside those two.
 */
export function impliedAfterSd(
  litersOverCapacity: number,
  capacity: Pick<ResolvedCapacity, "trusted">,
  gaugeSd: number = GAUGE_SD_BY_SOURCE["direct-gauge"],
): number {
  const capacityTerm = litersOverCapacity * capacityRelativeSd(capacity);
  return Math.sqrt(gaugeSd * gaugeSd + capacityTerm * capacityTerm);
}

/** The implied level above which the arithmetic no longer fits the tank. */
export function overCapacityThreshold(sd: number): number {
  return 1 + Math.max(FULL_TANK_TOLERANCE_FRACTION, 2 * sd);
}

function percent(level: number): string {
  return `${Math.round(level * 100)}%`;
}

function litersText(liters: number): string {
  return `${Math.round(liters)} ליטר`;
}

/**
 * Decide the tank outcome of a fill-up draft.
 *
 * One computation for the preview, the persisted fields and — because the
 * replay reads those fields — the estimate on Home. See the module comment.
 */
export function resolveTankOutcome(input: TankOutcomeInput): TankOutcome {
  const { draft, capacity } = input;
  const capacityLiters =
    isFiniteNumber(capacity.liters) && capacity.liters > 0 ? capacity.liters : null;
  const hasCapacity = capacityLiters !== null;

  const before = isFiniteNumber(draft.beforeLevel) ? clamp(draft.beforeLevel, 0, 1) : null;
  const override = isFiniteNumber(draft.afterLevelOverride)
    ? clamp(draft.afterLevelOverride, 0, 1)
    : null;
  // Zero litres is not a fill-up; it is treated as "not known" rather than
  // computed with, because the after gauge would otherwise equal the before.
  const liters =
    isFiniteNumber(input.litersAdded) && input.litersAdded > 0 ? input.litersAdded : null;
  const choice = effectiveEndChoice(draft);

  const gaugeSd = GAUGE_SD_BY_SOURCE["direct-gauge"];
  const base: PersistedTankFields = {
    ...EMPTY_FIELDS,
    refuelReason: draft.reason,
    // The revision every derivation on this record was made against, so a
    // later capacity change cannot retroactively rewrite what was measured.
    capacityLitersAtEntry: capacityLiters,
    tankSchemaVersion: TANK_SCHEMA_VERSION,
  };
  const statedBefore: Partial<PersistedTankFields> =
    before !== null
      ? {
          preFillLevel: before,
          preFillLevelSource: "direct-gauge",
          preFillLevelUncertainty: gaugeSd,
        }
      : {};

  // The arithmetic, when there is enough to do it.
  let implied: number | null = null;
  let toleranceSd: number | null = null;
  let exceeds = false;
  if (before !== null && liters !== null && capacityLiters !== null) {
    const added = liters / capacityLiters;
    implied = before + added;
    toleranceSd = impliedAfterSd(added, capacity);
    exceeds = implied > overCapacityThreshold(toleranceSd);
  }

  /* ---------- full ---------- */

  if (choice === "full") {
    // A confirmed full IS the after evidence. The replay anchors at capacity;
    // persisting a contradictory derived percentage beside it is the bug.
    const fields: PersistedTankFields = {
      ...base,
      ...statedBefore,
      fillEndState: "full",
      fillEndStateSource: "user-confirmed",
    };

    let derivedBefore: number | null = null;
    if (before === null && liters !== null && capacityLiters !== null) {
      const level = (capacityLiters - liters) / capacityLiters;
      // Same bounds as the read-time derivation in `toFillEvent`.
      if (level >= -0.2 && level <= 1) derivedBefore = clamp(level, 0, 1);
    }

    let state: TankOutcomeState = "ok";
    let message: string | null = null;
    if (exceeds && implied !== null && liters !== null && before !== null) {
      state = capacity.trusted ? "conflict" : "capacitySuspect";
      message = capacity.trusted
        ? `${percent(before)} לפני ועוד ${litersText(liters)} יוצא ${percent(implied)} — יותר ממיכל מלא. כדאי לבדוק את המצב לפני או את הכמות.`
        : `${percent(before)} לפני ועוד ${litersText(liters)} יוצא ${percent(implied)} — כנראה שהמיכל גדול מ־${litersText(capacityLiters!)} שהוערכו. כדאי לאשר את נפח המיכל.`;
    }

    return {
      endState: "full",
      endStateSource: "user-confirmed",
      displayAfterLevel: 1,
      impliedAfterLevel: implied,
      displayBeforeLevel: before ?? derivedBefore,
      beforeIsDerived: before === null && derivedBefore !== null,
      state,
      toleranceSd,
      fields,
      message,
    };
  }

  /* ---------- unknown ---------- */

  const hasGaugeEvidence = before !== null || override !== null;
  if (choice === "unknown" || (choice === null && !hasGaugeEvidence)) {
    return {
      endState: "unknown",
      endStateSource: "unknown",
      displayAfterLevel: null,
      impliedAfterLevel: implied,
      displayBeforeLevel: before,
      beforeIsDerived: false,
      state: choice === "unknown" ? "ok" : "unknownBefore",
      toleranceSd,
      fields: { ...base, ...statedBefore, fillEndState: "unknown", fillEndStateSource: "unknown" },
      message:
        choice === "unknown"
          ? null
          : "כדי לחשב את המצב אחרי התדלוק, סמנו כמה היה במיכל לפני.",
    };
  }

  /* ---------- partial ---------- */

  const endStateSource: FillEndStateSource =
    choice === "partial" || override !== null ? "user-confirmed" : "gauge-estimate";
  const partial = (
    extra: Partial<PersistedTankFields>,
    rest: Omit<
      TankOutcome,
      "endState" | "endStateSource" | "fields" | "displayBeforeLevel" | "beforeIsDerived"
    >,
  ): TankOutcome => ({
    endState: "partial",
    endStateSource,
    displayBeforeLevel: before,
    beforeIsDerived: false,
    fields: {
      ...base,
      ...statedBefore,
      fillEndState: "partial",
      fillEndStateSource: endStateSource,
      ...extra,
    },
    ...rest,
  });

  if (override !== null) {
    // A correction the user made outranks the calculated value and replaces
    // it — the calculated number is reproducible from the inputs, so keeping
    // a second copy would only be a way to disagree with itself later.
    return partial(
      {
        postFillLevel: override,
        postFillLevelSource: "user-correction",
        postFillLevelUncertainty: GAUGE_SD_BY_SOURCE["user-correction"],
      },
      {
        displayAfterLevel: override,
        impliedAfterLevel: implied,
        state: "ok",
        toleranceSd,
        message: null,
      },
    );
  }

  if (before === null) {
    return partial(
      {},
      {
        displayAfterLevel: null,
        impliedAfterLevel: null,
        state: "unknownBefore",
        toleranceSd: null,
        message: "כדי לחשב את המצב אחרי התדלוק, סמנו כמה היה במיכל לפני.",
      },
    );
  }

  if (liters === null) {
    // Not "before + 0": the after gauge stays empty until the litres exist.
    return partial(
      {},
      {
        displayAfterLevel: null,
        impliedAfterLevel: null,
        state: "unknownLiters",
        toleranceSd: null,
        message: "המצב אחרי התדלוק יחושב ברגע שתוזן הכמות שמילאת.",
      },
    );
  }

  if (!hasCapacity) {
    return partial(
      {},
      {
        displayAfterLevel: null,
        impliedAfterLevel: null,
        state: "noCapacity",
        toleranceSd: null,
        message: "בלי נפח מיכל המצב נשמר באחוזים בלבד, בלי ליטרים או טווח.",
      },
    );
  }

  // From here `implied` and `toleranceSd` are set: before, litres and capacity
  // all exist.
  const level = implied!;

  if (exceeds) {
    // Not persisted as 1. A derived value above the tank is reported, and the
    // raw before level stays on the record for whoever reviews it.
    return partial(
      {},
      {
        displayAfterLevel: 1,
        impliedAfterLevel: level,
        state: capacity.trusted ? "overCapacity" : "capacitySuspect",
        toleranceSd,
        message: capacity.trusted
          ? `לפי המצב שסימנת והכמות שמילאת יוצא ${percent(level)} — יותר ממיכל מלא. כדאי לבדוק את המצב לפני או את הכמות.`
          : `לפי המצב שסימנת והכמות שמילאת יוצא ${percent(level)} — כנראה שהמיכל גדול מ־${litersText(capacityLiters!)} שהוערכו. כדאי לאשר את נפח המיכל.`,
      },
    );
  }

  if (level > 1) {
    // Within the tolerance but past the top: effectively full, and the user
    // did not say so. Displayed as full, not stored as a measured 100%.
    return partial(
      {},
      {
        displayAfterLevel: 1,
        impliedAfterLevel: level,
        state: "ok",
        toleranceSd,
        message: null,
      },
    );
  }

  return partial(
    {
      postFillLevel: level,
      postFillLevelSource: "derived-after-partial",
      postFillLevelUncertainty: GAUGE_SD_BY_SOURCE["derived-after-partial"],
    },
    {
      displayAfterLevel: level,
      impliedAfterLevel: level,
      state: "ok",
      toleranceSd,
      message: null,
    },
  );
}
