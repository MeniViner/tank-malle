/**
 * The fill-up form's tank-state draft.
 *
 * Separate from the component so the shape and its empty value can be imported
 * by the form, the section and the tests without dragging a React component
 * along — and so the section file exports only components.
 */

import type { RefuelReason } from "./types";

export interface TankStateDraft {
  /** Fuel remaining BEFORE filling, as set by the user. Null = not stated. */
  beforeLevel: number | null;
  /** A user correction of the calculated after-level. Null = accept the maths. */
  afterLevelOverride: number | null;
  /** Explicit "I filled it up". Never selected automatically. */
  confirmedFull: boolean;
  reason: RefuelReason | null;
}

/** Nothing stated. The state a fill-up nobody interacted with must stay in. */
export const EMPTY_TANK_DRAFT: TankStateDraft = {
  beforeLevel: null,
  afterLevelOverride: null,
  confirmedFull: false,
  reason: null,
};

/** True when the user told us something. Drives whether anything is stored. */
export function hasTankAnswer(draft: TankStateDraft): boolean {
  return (
    draft.beforeLevel !== null ||
    draft.afterLevelOverride !== null ||
    draft.confirmedFull ||
    draft.reason !== null
  );
}
