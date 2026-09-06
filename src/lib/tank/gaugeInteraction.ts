/**
 * The maths behind the interactive fuel gauge.
 *
 * Kept out of the component so it can be tested without a DOM and so the drag,
 * the keyboard and the snapping all agree by construction rather than by two
 * people remembering to keep them in step.
 *
 * The internal value is a continuous 0–1 fraction. Rounding happens only when a
 * number is shown or stored, because a gauge read as "about a quarter" is not a
 * measurement of 0.250000 of anything.
 */

import { clamp, roundToStep } from "./numeric";

/** Display step. A gauge is coarse; pretending otherwise would be dishonest. */
export const GAUGE_STEP = 0.05;

/** Arrow keys move one step; Page keys move four. */
export const GAUGE_KEY_STEP = GAUGE_STEP;
export const GAUGE_PAGE_STEP = GAUGE_STEP * 4;

/**
 * How far the continuous value must travel before the SHOWN number moves.
 *
 * Without it the label flickers between 25% and 30% while a finger rests on the
 * boundary, which reads as a broken control rather than a precise one.
 */
export const GAUGE_SNAP_HYSTERESIS = GAUGE_STEP * 0.35;

export interface GaugeBounds {
  /** Distance from the top of the viewport to the top of the track, in px. */
  top: number;
  /** Track height in px. Must be positive. */
  height: number;
}

/**
 * Pointer position → level.
 *
 * The track is vertical and fuel rises from the bottom, so the TOP of the track
 * is full. This is independent of writing direction: an RTL layout mirrors the
 * horizontal axis and leaves the vertical one alone.
 */
export function levelFromPointer(clientY: number, bounds: GaugeBounds): number {
  if (!(bounds.height > 0)) return 0;
  const fromTop = clientY - bounds.top;
  return clamp(1 - fromTop / bounds.height, 0, 1);
}

/**
 * Keyboard handling for an ARIA slider.
 *
 * Up/Right increase and Down/Left decrease, which is what a screen reader user
 * expects from `role="slider"` regardless of the document's direction — the
 * roles are defined on the value, not on the page's writing order.
 *
 * Returns null for keys the gauge does not handle, so the caller knows not to
 * swallow the event.
 */
export function levelFromKey(current: number, key: string): number | null {
  const step = (delta: number) => clamp(roundToStep(current + delta, GAUGE_STEP), 0, 1);

  switch (key) {
    case "ArrowUp":
    case "ArrowRight":
      return step(GAUGE_KEY_STEP);
    case "ArrowDown":
    case "ArrowLeft":
      return step(-GAUGE_KEY_STEP);
    case "PageUp":
      return step(GAUGE_PAGE_STEP);
    case "PageDown":
      return step(-GAUGE_PAGE_STEP);
    case "Home":
      return 0;
    case "End":
      return 1;
    default:
      return null;
  }
}

/**
 * The value to SHOW for a continuous drag position.
 *
 * `previous` is the currently displayed value; it only changes once the raw
 * value has moved clear of the boundary by the hysteresis margin.
 */
export function snapLevel(raw: number, previous: number | null): number {
  const candidate = clamp(roundToStep(raw, GAUGE_STEP), 0, 1);
  if (previous === null) return candidate;
  if (Math.abs(raw - previous) < GAUGE_STEP / 2 + GAUGE_SNAP_HYSTERESIS) return previous;
  return candidate;
}

/** "כ־25%" — approximate, and it says so. */
export function levelLabel(level: number | null): string {
  if (level === null || !Number.isFinite(level)) return "לא ידוע";
  return `כ־${Math.round(clamp(level, 0, 1) * 100)}%`;
}

/** Coarse Hebrew name for a level, for screen readers and compact chips. */
export function levelName(level: number | null): string {
  if (level === null || !Number.isFinite(level)) return "לא ידוע";
  const value = clamp(level, 0, 1);
  if (value >= 0.95) return "מלא";
  if (value >= 0.7) return "כשלושה רבעים";
  if (value >= 0.45) return "כחצי";
  if (value >= 0.2) return "כרבע";
  if (value > 0.02) return "כמעט ריק";
  return "ריק";
}

/** ARIA value text: a percentage plus the coarse name, both approximate. */
export function gaugeValueText(level: number | null): string {
  if (level === null) return "לא ידוע";
  return `${levelLabel(level)} — ${levelName(level)}`;
}

/**
 * Whether the fill may animate.
 *
 * The animation is presentation only — nothing is ever derived from its
 * progress — so switching it off changes how the gauge looks and nothing else.
 */
export function shouldAnimateFill(prefersReducedMotion: boolean): boolean {
  return !prefersReducedMotion;
}
