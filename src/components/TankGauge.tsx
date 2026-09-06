import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";
import {
  gaugeValueText,
  levelFromKey,
  levelFromPointer,
  levelLabel,
  shouldAnimateFill,
  snapLevel,
} from "../lib/tank/gaugeInteraction";

/**
 * A vertical fuel gauge.
 *
 * Drawn as a tank with fuel rising from the bottom rather than as a settings
 * slider, because that is what the control is a picture of. The arithmetic
 * lives in `tank/gaugeInteraction.ts` and `tank/balance.ts`; this file draws
 * and handles input, and computes nothing about fuel.
 *
 * The vertical axis is unaffected by writing direction, so the same component
 * is correct in RTL and LTR. Only the two gauges' left/right PLACEMENT is
 * direction-dependent, and that is the parent's job.
 */

const MARKS = [0.25, 0.5, 0.75];

export interface TankGaugeProps {
  /** Fraction of usable capacity, 0–1. Null renders an explicitly unknown tank. */
  level: number | null;
  /** Present on the interactive gauge; absent makes it read-only. */
  onChange?: (level: number) => void;
  label: string;
  /** Accessible name; falls back to the visible label. */
  ariaLabel?: string;
  /** Small line under the percentage, e.g. "כ־30 ליטר". */
  caption?: string;
  /** Draws the fill in the warning colour, for a reconciliation state. */
  tone?: "accent" | "warning";
  /** Marks the gauge as confirmed full, which changes only its wording. */
  confirmedFull?: boolean;
}

export function TankGauge({
  level,
  onChange,
  label,
  ariaLabel,
  caption,
  tone = "accent",
  confirmedFull = false,
}: TankGaugeProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const reducedMotion = useReducedMotion();
  const interactive = typeof onChange === "function";

  const percent = level === null ? 0 : Math.round(Math.min(1, Math.max(0, level)) * 100);

  const apply = useCallback(
    (clientY: number) => {
      const element = trackRef.current;
      if (!element || !onChange) return;
      const rect = element.getBoundingClientRect();
      const raw = levelFromPointer(clientY, { top: rect.top, height: rect.height });
      // Snapping is applied to the DISPLAYED value only, with hysteresis, so a
      // finger resting on a boundary does not make the number flicker.
      onChange(snapLevel(raw, level));
    },
    [onChange, level],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    // Capture keeps the drag attached to this element even when the finger
    // leaves it, and releasing it on pointerup is what hands scrolling back.
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    apply(event.clientY);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.preventDefault();
    apply(event.clientY);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onChange) return;
    const next = levelFromKey(level ?? 0, event.key);
    if (next === null) return;
    event.preventDefault();
    onChange(next);
  };

  const animate = shouldAnimateFill(reducedMotion) && !dragging;

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <span className="text-[13px] font-semibold text-muted">{label}</span>

      <div className="flex items-stretch gap-1.5">
        {/* E and F sit OUTSIDE the tank. Inside, the fuel column swallows the
            "E" at any level above empty — which is precisely the level at
            which somebody is reading the gauge. */}
        <span
          aria-hidden="true"
          className="flex flex-col justify-between py-1 text-[10px] font-bold text-muted"
        >
          <span>F</span>
          <span>E</span>
        </span>

      <div
        ref={trackRef}
        role={interactive ? "slider" : "img"}
        tabIndex={interactive ? 0 : undefined}
        aria-label={ariaLabel ?? label}
        aria-valuemin={interactive ? 0 : undefined}
        aria-valuemax={interactive ? 100 : undefined}
        aria-valuenow={interactive && level !== null ? percent : undefined}
        aria-valuetext={gaugeValueText(level)}
        aria-orientation={interactive ? "vertical" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        /* Only this element opts out of browser panning, so a drag on the gauge
           cannot scroll the page while a swipe anywhere else still can. */
        style={interactive ? { touchAction: "none" } : undefined}
        className={`relative h-[168px] w-[76px] flex-none overflow-hidden rounded-[18px] border-2 bg-surface-2 outline-none transition-[border-color,box-shadow] duration-200 ${
          interactive
            ? "cursor-ns-resize border-line focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)]"
            : "border-line"
        } ${dragging ? "border-accent" : ""}`}
      >
        {/* Fuel column. */}
        <span
          aria-hidden="true"
          className={`absolute inset-x-0 bottom-0 ${
            tone === "warning" ? "bg-warning/70" : "bg-accent"
          } ${animate ? "transition-[height] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]" : ""}`}
          style={{ height: level === null ? "0%" : `${percent}%` }}
        />

        {/* Gauge marks. Decoration for the value, which is written out below. */}
        {MARKS.map((mark) => (
          <span
            key={mark}
            aria-hidden="true"
            className="absolute end-0 h-px w-3 bg-line/70 mix-blend-overlay"
            style={{ bottom: `${mark * 100}%` }}
          />
        ))}

        {/* The handle sits on the fill line; it is the thing a finger aims at. */}
        {interactive && level !== null ? (
          <span
            aria-hidden="true"
            className={`absolute inset-x-[-2px] flex h-[22px] -translate-y-1/2 items-center justify-center ${
              animate ? "transition-[bottom] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]" : ""
            }`}
            style={{ bottom: `${percent}%` }}
          >
            <span className="h-[6px] w-full rounded-pill bg-surface shadow-[0_1px_2px_rgb(13_35_28/0.2)]" />
          </span>
        ) : null}

        {level === null ? (
          <span className="absolute inset-0 flex items-center justify-center text-[12px] font-semibold text-muted">
            לא ידוע
          </span>
        ) : null}
      </div>
      </div>

      <span className="flex flex-col items-center gap-0.5 text-center">
        <span className="text-[16px] font-bold text-ink">
          {confirmedFull ? "מלא" : levelLabel(level)}
        </span>
        {caption ? <span className="text-[12px] text-muted">{caption}</span> : null}
      </span>
    </div>
  );
}
