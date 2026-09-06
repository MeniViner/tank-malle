import { useReducedMotion } from "../hooks/useReducedMotion";
import { arcPath, polar } from "../lib/curve";
import { levelLabel } from "../lib/tank/gaugeInteraction";

/**
 * The tank, drawn as a dashboard gauge.
 *
 * A dial rather than a bar because a fuel gauge IS a dial — and because a
 * horizontal bar has to pick a direction, which in an RTL layout means
 * choosing between "fills toward the reading edge" and "E is on the left like
 * every car ever built". A dial has no such argument: E left, F right,
 * everywhere in the world.
 *
 * Both thresholds are marked on the arc, which is the point of the whole
 * feature — the amber tick is the reserve the user configured, the accent tick
 * is where they actually tend to refuel, and seeing them apart is what makes
 * "you refuel earlier than you need to" a thing you can look at rather than
 * read about.
 */

/** Sweep of the arc: 200° from lower-left round to lower-right. */
const START_ANGLE = 190;
const END_ANGLE = -10;

const SIZE = { width: 150, height: 104 };
const CX = SIZE.width / 2;
const CY = 84;
const RADIUS = 62;
const TRACK_WIDTH = 12;

/** Level (0–1) to a angle on the arc. */
function angleFor(level: number): number {
  const t = Math.min(1, Math.max(0, level));
  return START_ANGLE - (START_ANGLE - END_ANGLE) * t;
}

export interface TankDialProps {
  /** Fraction of capacity, 0–1. Null draws an explicitly unknown dial. */
  level: number | null;
  /** The configured reserve, marked in amber. */
  reserveLevel?: number | null;
  /** Where this person actually tends to refuel, marked in the accent colour. */
  habitLevel?: number | null;
  /** Renders in the warning colour, for a reconciliation state. */
  tone?: "accent" | "warning";
  /** Small line under the percentage, e.g. "כ־22 ליטר". */
  caption?: string | null;
}

export function TankDial({
  level,
  reserveLevel = null,
  habitLevel = null,
  tone = "accent",
  caption,
}: TankDialProps) {
  const reducedMotion = useReducedMotion();
  const known = level !== null && Number.isFinite(level);
  const value = known ? Math.min(1, Math.max(0, level)) : 0;

  const track = arcPath(CX, CY, RADIUS, START_ANGLE, END_ANGLE);
  const filled = arcPath(CX, CY, RADIUS, START_ANGLE, angleFor(value));

  // One path length for the whole sweep, so the fill can be animated by
  // dash offset rather than by regenerating geometry every frame.
  const sweepLength = (Math.PI * RADIUS * (START_ANGLE - END_ANGLE)) / 180;

  return (
    <div className="flex flex-none flex-col items-center">
      <svg
        width={SIZE.width}
        height={SIZE.height}
        viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
        aria-hidden="true"
        className="overflow-visible"
      >
        <path
          d={track}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={TRACK_WIDTH}
          strokeLinecap="round"
        />

        {known ? (
          <path
            d={filled}
            fill="none"
            stroke={tone === "warning" ? "var(--warning)" : "var(--accent)"}
            strokeWidth={TRACK_WIDTH}
            strokeLinecap="round"
            style={
              reducedMotion
                ? undefined
                : {
                    strokeDasharray: sweepLength,
                    strokeDashoffset: 0,
                    transition: "stroke-dashoffset 700ms cubic-bezier(0.22,1,0.36,1)",
                  }
            }
          />
        ) : null}

        {/* Quarter ticks, inside the track so they read as gauge markings. */}
        {[0, 0.25, 0.5, 0.75, 1].map((mark) => {
          const outer = polar(CX, CY, RADIUS - TRACK_WIDTH / 2 + 1, angleFor(mark));
          const inner = polar(CX, CY, RADIUS - TRACK_WIDTH / 2 - 4, angleFor(mark));
          return (
            <line
              key={mark}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              stroke="var(--line)"
              strokeWidth={mark === 0 || mark === 1 ? 2.4 : 1.6}
              strokeLinecap="round"
            />
          );
        })}

        {/* Thresholds only make sense against a reading. On a blank dial they
            are two unexplained ticks. */}
        {known ? (
          <>
            <Threshold level={reserveLevel} color="var(--warning)" />
            <Threshold level={habitLevel} color="var(--accent)" dashed />
          </>
        ) : null}

        <text
          x={polar(CX, CY, RADIUS + 13, START_ANGLE).x}
          y={polar(CX, CY, RADIUS + 13, START_ANGLE).y + 4}
          textAnchor="middle"
          className="fill-muted text-[11px] font-bold"
        >
          E
        </text>
        <text
          x={polar(CX, CY, RADIUS + 13, END_ANGLE).x}
          y={polar(CX, CY, RADIUS + 13, END_ANGLE).y + 4}
          textAnchor="middle"
          className="fill-muted text-[11px] font-bold"
        >
          F
        </text>
      </svg>

      {/* The reading itself is text, sitting inside the arc. */}
      <div className="-mt-[48px] flex flex-col items-center gap-0.5">
        <span
          className={`font-bold leading-none tracking-[-0.01em] ${
            known ? "text-[27px] text-ink" : "text-[19px] text-muted"
          }`}
        >
          {known ? levelLabel(level) : "לא ידוע"}
        </span>
        {caption ? <span className="text-[12px] text-muted">{caption}</span> : null}
      </div>
    </div>
  );
}

/** A short marker outside the track, for a threshold the arc has to show. */
function Threshold({
  level,
  color,
  dashed = false,
}: {
  level: number | null;
  color: string;
  dashed?: boolean;
}) {
  if (level === null || !Number.isFinite(level)) return null;
  const angle = angleFor(level);
  const outer = polar(CX, CY, RADIUS + TRACK_WIDTH / 2 + 4, angle);
  const inner = polar(CX, CY, RADIUS + TRACK_WIDTH / 2 - 1, angle);

  return (
    <line
      x1={outer.x}
      y1={outer.y}
      x2={inner.x}
      y2={inner.y}
      stroke={color}
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeDasharray={dashed ? "2 2" : undefined}
    />
  );
}
