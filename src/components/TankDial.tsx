import { levelLabel } from "../lib/tank/gaugeInteraction";

/** The exported design's horizontal fuel bar. Unknown is never drawn as empty. */
export function TankDial({ level, reserveLevel = null, habitLevel = null, tone = "accent", caption }: {
  level: number | null;
  reserveLevel?: number | null;
  habitLevel?: number | null;
  tone?: "accent" | "warning";
  caption?: string | null;
}) {
  const known = level !== null && Number.isFinite(level);
  const percent = known ? Math.min(100, Math.max(0, level * 100)) : 0;
  return <div className="tm-tank-level" data-testid="tank-level-bar">
    <div className="tm-tank-level-heading">
      <span data-testid="current-tank-level" className={known ? "tm-tank-value" : "text-[22px] font-semibold text-muted"}>{known ? levelLabel(level) : "לא ידוע"}</span>
      {caption ? <span className="tm-tank-capacity">{caption}</span> : null}
    </div>
    {known ? <div className="tm-tank-track" role="img" aria-label={`${levelLabel(level)} דלק במיכל${reserveLevel !== null ? `, רזרבה ב־${Math.round(reserveLevel * 100)}%` : ""}`}>
      <span className="tm-tank-fill" style={{ inlineSize: `${percent}%`, background: tone === "warning" ? "var(--warning)" : undefined }} />
      {reserveLevel !== null && Number.isFinite(reserveLevel) ? <span className="tm-tank-marker" style={{ insetInlineStart: `${Math.max(0, Math.min(100, reserveLevel * 100))}%` }} /> : null}
      {habitLevel !== null && Number.isFinite(habitLevel) ? <span className="tm-tank-marker tm-tank-habit" style={{ insetInlineStart: `${Math.max(0, Math.min(100, habitLevel * 100))}%` }} /> : null}
    </div> : null}
  </div>;
}
