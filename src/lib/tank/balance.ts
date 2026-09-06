/**
 * Canonical tank-balance engine.
 *
 *   remaining = anchored quantity + fuel added − fuel consumed
 *   fuel consumed ≈ kilometres travelled × litres per kilometre
 *
 * Events are replayed chronologically. Nothing here repairs data: an impossible
 * decrease, an over-capacity result or an observation that contradicts the model
 * produces a reconciliation note, and the note travels with the result all the
 * way to the screen. Visual clamping happens at the bar, never here.
 *
 * Pure. No React, no Firebase, no clock.
 */

import {
  CAPACITY_RELATIVE_SD,
  FULL_TANK_TOLERANCE_FRACTION,
  RECONCILE_TOLERANCE_FRACTION,
} from "./config";
import type { FillEvent, LevelReading, TankEvent } from "./observations";
import { clamp } from "./numeric";
import type { LevelSource, ReconciliationNote, ReconciliationState } from "./types";

/** How much an anchor can be trusted, strongest first. */
export type AnchorQuality =
  /** The user explicitly confirmed a full tank and the capacity is trusted. */
  | "confirmed-full"
  /** The user set or corrected the gauge directly. */
  | "direct-gauge"
  /** Arithmetic from a previous anchor plus purchases. */
  | "derived";

export interface Anchor {
  /** Litres in the tank at `odometer`. */
  liters: number;
  /** Standard deviation of `liters`. Never zero — a gauge is not an instrument. */
  sd: number;
  odometer: number;
  at: number;
  quality: AnchorQuality;
  /** Fill-up or observation id this anchor came from. */
  sourceId: string;
}

export interface BalanceResult {
  /** The most recent absolute anchor, or null when none survives a break. */
  anchor: Anchor | null;
  /**
   * Litres at the most recent trustworthy odometer, after replaying travel
   * from the anchor. Null when there is no anchor, no capacity or no
   * consumption estimate to travel with.
   */
  measured: { liters: number; sd: number; odometer: number; at: number } | null;
  /** Newest odometer reading of any kind. */
  lastOdometer: { value: number; at: number } | null;
  /**
   * Newest level the user actually reported, in fraction terms. Survives a
   * missing capacity, which is what lets a percentage still be shown when
   * litres cannot be.
   */
  lastLevelReport: { level: number; at: number; source: LevelSource } | null;
  notes: ReconciliationNote[];
  /** Continuity breaks encountered while replaying. */
  breaksCrossed: number;
  /** True when a consumption figure was available to replay travel with. */
  consumptionAvailable: boolean;
}

export interface BalanceInput {
  events: readonly TankEvent[];
  /** Usable capacity in litres, or null when it is not trusted. */
  capacityLiters: number | null;
  /** Litres per kilometre. Null suppresses every travel-dependent figure. */
  consumptionLitersPerKm: number | null;
  /** Standard deviation of the consumption figure, same units. */
  consumptionSd: number | null;
}

const EMPTY: BalanceResult = {
  anchor: null,
  measured: null,
  lastOdometer: null,
  lastLevelReport: null,
  notes: [],
  breaksCrossed: 0,
  consumptionAvailable: false,
};

function note(
  state: ReconciliationState,
  sourceId: string | null,
  at: number,
  residualLiters: number | null,
  message: string,
): ReconciliationNote {
  return { state, sourceId, at, residualLiters, message };
}

/**
 * The odometer an anchor sits at.
 *
 * A one-line helper with an explicit return type, because reading
 * `anchor?.odometer` while computing the value that will BECOME the next anchor
 * is a circular reference the compiler cannot resolve on its own.
 */
function anchorOdometer(anchor: Anchor | null): number | undefined {
  return anchor === null ? undefined : anchor.odometer;
}

/**
 * Carry an anchor forward over travelled distance.
 *
 * Returns null when the model cannot answer — no consumption figure, or an
 * odometer that moved backwards. Uncertainty grows with distance, because the
 * consumption rate is itself uncertain.
 */
function advance(
  anchor: Anchor,
  odometer: number,
  consumption: number,
  consumptionSd: number,
): { liters: number; sd: number } | null {
  const km = odometer - anchor.odometer;
  if (km < 0) return null;
  const burnt = km * consumption;
  const burntSd = km * consumptionSd;
  return {
    liters: anchor.liters - burnt,
    sd: Math.sqrt(anchor.sd * anchor.sd + burntSd * burntSd),
  };
}

/**
 * Replay every event and report the resulting state.
 *
 * The order of operations inside one fill-up is explicit and fixed:
 * break → travel → pre-fill observation → add litres → end state.
 */
export function replayBalance(input: BalanceInput): BalanceResult {
  const { events, capacityLiters, consumptionLitersPerKm } = input;
  if (events.length === 0) return EMPTY;

  const hasCapacity = typeof capacityLiters === "number" && capacityLiters > 0;
  const capacity = hasCapacity ? capacityLiters : 0;
  const capacitySd = capacity * CAPACITY_RELATIVE_SD;
  const consumption = consumptionLitersPerKm;
  const consumptionSd = input.consumptionSd ?? 0;
  const tolerance = capacity * RECONCILE_TOLERANCE_FRACTION;

  const notes: ReconciliationNote[] = [];
  let anchor: Anchor | null = null;
  let lastOdometer: BalanceResult["lastOdometer"] = null;
  let lastLevelReport: BalanceResult["lastLevelReport"] = null;
  let breaksCrossed = 0;

  /** Litres implied by a level reading, with the reading's own uncertainty. */
  const litersFor = (reading: LevelReading) => ({
    liters: reading.level * capacity,
    sd: Math.sqrt(
      (reading.sd * capacity) ** 2 + (reading.level * capacitySd) ** 2,
    ),
  });

  for (const event of events) {
    if (event.kind === "observation") {
      if (event.odometer !== null) {
        if (lastOdometer && event.odometer < lastOdometer.value) {
          notes.push(
            note(
              "conflict",
              event.id,
              event.at,
              null,
              "קילומטראז׳ נמוך מהרשומה הקודמת",
            ),
          );
        } else {
          lastOdometer = { value: event.odometer, at: event.at };
        }
      }

      if (event.level) {
        lastLevelReport = {
          level: event.level.level,
          at: event.at,
          source: event.level.source,
        };

        // A standalone gauge update corrects the state. It never invents a
        // purchase, and the odometer it re-anchors at is the newest known one.
        if (hasCapacity) {
          const previous: Anchor | null = anchor;
          const odometer: number | undefined =
            event.odometer ?? lastOdometer?.value ?? anchorOdometer(previous);
          if (typeof odometer === "number") {
            const implied = litersFor(event.level);

            // A trusted reading that contradicts the model is a reason to
            // re-anchor and say so, not to average the disagreement away.
            if (previous && consumption !== null) {
              const predicted = advance(previous, odometer, consumption, consumptionSd);
              if (predicted && Math.abs(predicted.liters - implied.liters) > tolerance) {
                notes.push(
                  note(
                    "conflict",
                    event.id,
                    event.at,
                    implied.liters - predicted.liters,
                    "מד הדלק שדווח שונה מהותית מהחישוב — החישוב אופס לפי הדיווח",
                  ),
                );
              }
            }

            anchor = {
              liters: implied.liters,
              sd: implied.sd,
              odometer,
              at: event.at,
              quality: "direct-gauge",
              sourceId: event.id,
            };
          }
        }
      }
      continue;
    }

    /* ---------- fill-up ---------- */

    if (event.continuityBreakBefore) {
      breaksCrossed += 1;
      if (anchor) {
        notes.push(
          note(
            "noAnchor",
            event.id,
            event.at,
            null,
            "הוצהר על תדלוקים שלא תועדו — המעקב מתחיל מחדש מכאן",
          ),
        );
      }
      anchor = null;
      lastOdometer = null;
    }

    if (lastOdometer && event.odometer < lastOdometer.value) {
      notes.push(
        note("conflict", event.id, event.at, null, "סדר הקילומטראז׳ אינו עקבי"),
      );
    }

    // 1. Travel since the anchor.
    let preLiters: number | null = null;
    let preSd = 0;
    if (anchor && consumption !== null && hasCapacity) {
      const carried = advance(anchor, event.odometer, consumption, consumptionSd);
      if (carried) {
        preLiters = carried.liters;
        preSd = carried.sd;
      }
    }

    // 2. A directly stated pre-fill level is an anchor, not a vote.
    if (hasCapacity && event.preFill) {
      const observed = litersFor(event.preFill);
      const direct = event.preFill.confirmed;

      if (direct) {
        if (preLiters !== null && Math.abs(observed.liters - preLiters) > tolerance) {
          notes.push(
            note(
              "conflict",
              event.id,
              event.at,
              observed.liters - preLiters,
              "המצב שדווח לפני התדלוק שונה מהחישוב",
            ),
          );
        }
        preLiters = observed.liters;
        preSd = observed.sd;
      } else if (preLiters === null) {
        // Derived (capacity − purchased). Good enough to seed a balance that
        // has nothing else, and labelled as such by the wider uncertainty.
        preLiters = observed.liters;
        preSd = observed.sd;
      }
    }

    if (preLiters !== null && preLiters < -tolerance) {
      notes.push(
        note(
          "negative",
          event.id,
          event.at,
          preLiters,
          "החישוב הגיע לכמות שלילית — כנראה חסר תדלוק או שהצריכה השתנתה",
        ),
      );
    }

    // 3. Purchased litres, added exactly once.
    const postLiters = preLiters !== null ? preLiters + event.liters : null;
    const postSd =
      preLiters !== null
        ? Math.sqrt(preSd * preSd + (event.liters * 0.01) ** 2)
        : 0;

    // 4. End state decides the new anchor.
    const confirmedFull =
      event.endState === "full" && event.endStateSource === "user-confirmed";

    if (confirmedFull && hasCapacity) {
      if (postLiters !== null && postLiters > capacity * (1 + FULL_TANK_TOLERANCE_FRACTION)) {
        notes.push(
          note(
            "overCapacity",
            event.id,
            event.at,
            postLiters - capacity,
            "הנתונים לא לגמרי מסתדרים עם נפח המיכל",
          ),
        );
      }
      anchor = {
        liters: capacity,
        sd: capacitySd,
        odometer: event.odometer,
        at: event.at,
        quality: "confirmed-full",
        sourceId: event.id,
      };
    } else if (hasCapacity && event.postFill?.confirmed) {
      // 5. An after-fill reading describes the state AFTER the litres went in.
      //    They are not added again.
      const observed = litersFor(event.postFill);
      if (postLiters !== null && Math.abs(observed.liters - postLiters) > tolerance) {
        notes.push(
          note(
            "conflict",
            event.id,
            event.at,
            observed.liters - postLiters,
            "המצב שדווח אחרי התדלוק שונה מהחישוב",
          ),
        );
      }
      anchor = {
        liters: observed.liters,
        sd: observed.sd,
        odometer: event.odometer,
        at: event.at,
        quality: "direct-gauge",
        sourceId: event.id,
      };
    } else if (postLiters !== null && hasCapacity) {
      // A partial fill adds its litres. It does not reset the tank to full.
      if (postLiters > capacity * (1 + RECONCILE_TOLERANCE_FRACTION)) {
        notes.push(
          note(
            "overCapacity",
            event.id,
            event.at,
            postLiters - capacity,
            "הנתונים לא לגמרי מסתדרים עם נפח המיכל",
          ),
        );
      }
      anchor = {
        liters: postLiters,
        sd: postSd,
        odometer: event.odometer,
        at: event.at,
        quality: "derived",
        sourceId: event.id,
      };
    } else {
      // Nothing absolute is known any more. A legacy "full" record lands here
      // on purpose: it was never confirmed by anybody, so it cannot anchor.
      anchor = null;
    }

    if (event.preFill) {
      lastLevelReport = {
        level: event.preFill.level,
        at: event.at,
        source: event.preFill.source,
      };
    }
    if (event.postFill) {
      lastLevelReport = {
        level: event.postFill.level,
        at: event.at,
        source: event.postFill.source,
      };
    } else if (confirmedFull) {
      lastLevelReport = { level: 1, at: event.at, source: "direct-gauge" };
    }

    if (!lastOdometer || event.odometer >= lastOdometer.value) {
      lastOdometer = { value: event.odometer, at: event.at };
    }
  }

  let measured: BalanceResult["measured"] = null;
  if (anchor && lastOdometer && consumption !== null && hasCapacity) {
    const carried = advance(anchor, lastOdometer.value, consumption, consumptionSd);
    if (carried) {
      measured = {
        liters: carried.liters,
        sd: carried.sd,
        odometer: lastOdometer.value,
        at: Math.max(anchor.at, lastOdometer.at),
      };
    }
  }

  if (!hasCapacity) {
    notes.push(
      note(
        "noCapacity",
        null,
        events[events.length - 1].at,
        null,
        "נפח המיכל לא אושר — אי אפשר להציג ליטרים או טווח",
      ),
    );
  } else if (!anchor) {
    notes.push(
      note(
        "noAnchor",
        null,
        events[events.length - 1].at,
        null,
        "אין נקודת עיגון — עדכנו את מד הדלק או אשרו תדלוק עד מלא",
      ),
    );
  }

  return {
    anchor,
    measured,
    lastOdometer,
    lastLevelReport,
    notes,
    breaksCrossed,
    consumptionAvailable: consumption !== null,
  };
}

/* ------------------------------------------------------------------ *
 * The projection the fill-up form draws
 * ------------------------------------------------------------------ */

export type AfterFillState = "ok" | "overCapacity" | "noCapacity" | "unknownBefore";

export interface AfterFillProjection {
  /** Fraction of capacity after the fill, or null when unsupported. */
  level: number | null;
  liters: number | null;
  /** The unclamped implied level. Kept so the UI can explain a bad input. */
  impliedLevel: number | null;
  source: LevelSource;
  state: AfterFillState;
}

/**
 * What the tank will hold after this fill-up.
 *
 * The interactive gauge calls this rather than doing the arithmetic itself:
 * a second copy of `before × capacity + litres` living inside a React component
 * is exactly how two parts of an app start disagreeing about the same tank.
 *
 * Over-capacity is REPORTED, not clamped away. `level` is clamped for drawing;
 * `impliedLevel` keeps the truth.
 */
export function projectAfterFill(input: {
  beforeLevel: number | null;
  litersAdded: number;
  capacityLiters: number | null;
  confirmedFull: boolean;
}): AfterFillProjection {
  const { beforeLevel, litersAdded, capacityLiters, confirmedFull } = input;

  if (confirmedFull) {
    return {
      level: 1,
      liters: capacityLiters && capacityLiters > 0 ? capacityLiters : null,
      impliedLevel: 1,
      source: "user-correction",
      state: "ok",
    };
  }

  if (!(typeof capacityLiters === "number" && capacityLiters > 0)) {
    return {
      level: null,
      liters: null,
      impliedLevel: null,
      source: "unknown",
      state: "noCapacity",
    };
  }

  if (beforeLevel === null || !Number.isFinite(beforeLevel)) {
    return {
      level: null,
      liters: null,
      impliedLevel: null,
      source: "unknown",
      state: "unknownBefore",
    };
  }

  const added = Number.isFinite(litersAdded) && litersAdded > 0 ? litersAdded : 0;
  const liters = beforeLevel * capacityLiters + added;
  const impliedLevel = liters / capacityLiters;

  return {
    level: clamp(impliedLevel, 0, 1),
    liters: Math.min(liters, capacityLiters),
    impliedLevel,
    source: "derived-after-partial",
    state:
      impliedLevel > 1 + FULL_TANK_TOLERANCE_FRACTION ? "overCapacity" : "ok",
  };
}

/**
 * Pre-fill level implied by a confirmed full tank, for the form's own use.
 * Same derivation the event stream makes, exposed so the UI can show it.
 */
export function derivePreFillLevel(
  litersAdded: number,
  capacityLiters: number | null,
): number | null {
  if (!(typeof capacityLiters === "number" && capacityLiters > 0)) return null;
  if (!Number.isFinite(litersAdded) || litersAdded <= 0) return null;
  const level = (capacityLiters - litersAdded) / capacityLiters;
  if (level < -0.2 || level > 1) return null;
  return clamp(level, 0, 1);
}

/** Highest-severity note, for the one line the UI has room for. */
export function primaryNote(notes: readonly ReconciliationNote[]): ReconciliationNote | null {
  const order: ReconciliationState[] = [
    "conflict",
    "overCapacity",
    "negative",
    "noCapacity",
    "noAnchor",
    "ok",
  ];
  for (const state of order) {
    const found = notes.find((entry) => entry.state === state);
    if (found) return found;
  }
  return null;
}

/** Fold a fill-up event's own evidence into a display fraction, 0–1. */
export function levelAfter(event: FillEvent, capacityLiters: number | null): number | null {
  if (event.postFill) return event.postFill.level;
  if (event.endState === "full") return 1;
  if (event.preFill && capacityLiters && capacityLiters > 0) {
    return clamp(event.preFill.level + event.liters / capacityLiters, 0, 1);
  }
  return null;
}
