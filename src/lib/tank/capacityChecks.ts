/**
 * Litres against capacity, aware of where the capacity came from.
 *
 * Fifty litres into a tank the user CONFIRMED holds forty-five is a record to
 * look at. Fifty litres into a tank we GUESSED holds forty-five is the guess
 * being corrected by reality — the largest fill is a hard lower bound on the
 * tank, so the finding is about the estimate, never about the record.
 *
 * Pure. No React, no Firebase, no clock.
 */

import type { ResolvedCapacity } from "./capacity";
import {
  CAPACITY_RELATIVE_SD,
  FULL_TANK_TOLERANCE_FRACTION,
  UNTRUSTED_CAPACITY_SD_FACTOR,
} from "./config";
import { isFiniteNumber } from "./numeric";

export type LitersVsCapacityState = "ok" | "suspectCapacity" | "overfill";

export interface LitersVsCapacity {
  state: LitersVsCapacityState;
  /** Short Hebrew headline, or null when there is nothing to say. */
  message: string | null;
  /** One more sentence with the numbers, or null. */
  detail: string | null;
}

const OK: LitersVsCapacity = { state: "ok", message: null, detail: null };

/**
 * Relative headroom an approximate capacity gets before the litres say it
 * is wrong: two standard deviations of the widened capacity band.
 */
export const UNTRUSTED_CAPACITY_HEADROOM =
  2 * CAPACITY_RELATIVE_SD * UNTRUSTED_CAPACITY_SD_FACTOR;

/**
 * Whether the litres bought fit the tank, and what that says.
 *
 *   trusted   litres > capacity × (1 + FULL_TANK_TOLERANCE_FRACTION) → overfill
 *   estimate  litres > capacity × (1 + 2·σ_untrusted)               → suspectCapacity
 *   observed  same as estimate
 *   none      ok — nothing to compare against
 */
export function litersVsCapacity(liters: number, capacity: ResolvedCapacity): LitersVsCapacity {
  if (!isFiniteNumber(liters) || liters <= 0) return OK;
  if (!isFiniteNumber(capacity.liters) || capacity.liters <= 0) return OK;
  if (capacity.source === "none") return OK;

  const size = capacity.liters;
  const shown = Math.round(liters);

  if (capacity.trusted) {
    if (liters <= size * (1 + FULL_TANK_TOLERANCE_FRACTION)) return OK;
    return {
      state: "overfill",
      message: "הכמות גדולה מנפח המיכל שאישרת",
      detail: `${shown} ליטר לעומת ${Math.round(size)} ליטר נפח. כדאי לבדוק את הכמות או את נפח המיכל בהגדרות הרכב.`,
    };
  }

  if (liters <= size * (1 + UNTRUSTED_CAPACITY_HEADROOM)) return OK;
  return {
    state: "suspectCapacity",
    message: "נפח המיכל המשוער כנראה נמוך מדי",
    detail: `נכנסו ${shown} ליטר, יותר מ־${Math.round(size)} ליטר שהוערכו. אפשר לאשר או לתקן את נפח המיכל בהגדרות הרכב.`,
  };
}
