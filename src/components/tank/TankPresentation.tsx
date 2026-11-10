import type { TankEstimate } from "../../lib/tank";
import type { PassageResult } from "../../lib/tank/types";
import { num, timeAgo } from "../../lib/format";
import { NumericText, NumRun, Percent } from "../Fmt";

/** Engine notes may contain ranges, which remain a single numeric island. */
export function TankText({ children }: { children: string }) {
  return <>{children.split(/(\d[\d,.]*\s*–\s*\d[\d,.]*)/g).map((part, index) =>
    index % 2 ? <NumRun key={index}>{part}</NumRun> : <NumericText key={index}>{part}</NumericText>)}</>;
}

/** Presentation of the engine's passage result; no second forecast calculation. */
export function TankPassage({ passage, headline = false }: { passage: PassageResult; headline?: boolean }) {
  if (passage.status === "reached") return <>היום</>;
  if (passage.status === "beyondHorizon") return <>מעבר לטווח התחזית</>;
  if (passage.status !== "withinHorizon" || passage.days === null) {
    return <>{headline ? "עוד לומדים מתי לתדלק" : "עוד אין תחזית"}</>;
  }
  const low = passage.daysLow;
  const high = passage.daysHigh;
  if (!headline && low !== null && high !== null && Math.round(high) - Math.round(low) >= 1) {
    // The entire range is one LTR island; the Hebrew unit stays outside it.
    return <>בעוד <NumRun>{`${num(Math.max(0, Math.round(low)), 0)}–${num(Math.max(0, Math.round(high)), 0)}`}</NumRun> ימים</>;
  }
  if (passage.days < 0.6) return <>היום</>;
  if (passage.days < 1.6) return <>מחר</>;
  return <>בעוד <NumRun>{num(Math.max(0, Math.round(passage.days)), 0)}</NumRun> ימים</>;
}

export function TankLevel({ level }: { level: number | null }) {
  return level === null ? <>לא ידוע</> : <>כ־<Percent value={level * 100} /></>;
}

/** Mixed routines remain a range instead of a midpoint nobody actually uses. */
export function TankHabitLevel({ habit }: { habit: Pick<TankEstimate["habit"], "mixed" | "overridden" | "low" | "high" | "typicalLevel"> }) {
  return habit.mixed && !habit.overridden
    ? <>בין <Percent value={habit.low * 100} /> ל־<Percent value={habit.high * 100} /></>
    : <Percent value={habit.typicalLevel * 100} />;
}

type TankSourceEstimate = Pick<TankEstimate, "reasons" | "lastLevelReport"> & { current: Pick<TankEstimate["current"], "level"> };
function tankSourceText(estimate: TankSourceEstimate, displayLevel: number | null): string {
  if (displayLevel === null) return "עדכון המחוון ישפר את ההערכה";
  if (estimate.reasons.includes("recentGaugeObservation")
    || (estimate.current.level === null && estimate.lastLevelReport)) return "לפי המחוון שסימנת";
  if (estimate.reasons.includes("recentConfirmedFullAnchor")) return "הערכה מהטנק המלא האחרון";
  return "הערכה לפי העדכונים שלך";
}

/** A reported level without a live projection always carries the report age. */
export function TankSource({ estimate, level }: { estimate: TankSourceEstimate; level: number | null }) {
  const reportOnly = level !== null && estimate.current.level === null && estimate.lastLevelReport;
  return <>{tankSourceText(estimate, level)}{reportOnly ? <> · עודכן <NumericText>{timeAgo(reportOnly.at)}</NumericText></> : null}</>;
}
