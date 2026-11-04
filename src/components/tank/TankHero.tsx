import { useId } from "react";
import { displayTankLevel } from "../../lib/tank/display";
import { Skeleton } from "../Card";
import { Gauge } from "../DesignPrimitives";
import { Distance, Percent } from "../Fmt";
import { TankHabitLevel, TankLevel, TankPassage, TankSource } from "./TankPresentation";
import type { TankHeroProps } from "./types";
import "../../tank-design.css";

export type { TankHeroProps, TankSheetEntry } from "./types";

/** A view of the one Home estimate, never another hook or a second forecast. */
export function TankHero({ estimate, loading = false, onOpen }: TankHeroProps) {
  const labelId = useId();
  const headlineId = useId();
  const descriptionId = useId();
  if (loading) return <Skeleton className="tm-tank-skeleton" />;
  if (!estimate.available) return null;

  const level = displayTankLevel(estimate);
  const known = level !== null;
  const low = known && level <= estimate.reserveLevel;
  const qualifiedHabit = estimate.habit.canClaim || estimate.habit.overridden;
  const uncertainDate = estimate.expectedRefuel.status === "unknown" || estimate.expectedRefuel.status === "beyondHorizon";

  return <button type="button" data-testid="tank-hero" className="tm-tank-hero"
    aria-labelledby={`${labelId} ${headlineId}`}
    aria-describedby={`${descriptionId}-level ${descriptionId}-habit ${descriptionId}-source`}
    aria-haspopup="dialog" onClick={() => onOpen(known ? "summary" : "gauge")}>
    <span id={labelId} className="tm-tank-label">{low ? "הדלק עומד להיגמר" : "התדלוק הבא"}</span>
    <span id={headlineId} data-testid="tank-headline" className={`tm-tank-headline${!known || uncertainDate ? " tm-tank-headline-small" : ""}`}>
      {known ? <TankPassage passage={estimate.expectedRefuel} headline /> : "כמה דלק יש עכשיו?"}
    </span>
    {known ? <div className="tm-tank-hero-level">
      <Gauge value={level} habit={qualifiedHabit ? estimate.habit.typicalLevel : null} low={low} />
      <span id={`${descriptionId}-level`} className="tm-tank-gauge-caption">
        <span data-testid="current-tank-level"><TankLevel level={level} /></span>
        {estimate.rangeToReserveKm !== null && estimate.rangeToReserveKm > 0
          ? <> · כ־<Distance value={estimate.rangeToReserveKm} /> עד לרזרבה</> : null}
      </span>
    </div> : <span id={`${descriptionId}-level`} data-testid="current-tank-level" className="sr-only">כמות הדלק לא ידועה</span>}
    <span id={`${descriptionId}-habit`} className="tm-tank-hero-note">
      {!known ? "הקישו כדי לסמן את מחוון הדלק."
        : estimate.habit.overridden ? <>לפי ההעדפה שלך, תדלוק סביב <Percent value={estimate.habit.typicalLevel * 100} />.</>
          : estimate.habit.canClaim ? <>בדרך כלל אתה מתדלק כשנשארים <TankHabitLevel habit={estimate.habit} />.</>
            : "אחרי עוד כמה תדלוקים נלמד את ההרגל שלך."}
    </span>
    <span className="tm-tank-hero-footer"><span id={`${descriptionId}-source`}><TankSource estimate={estimate} level={level} /></span><span>עדכון ›</span></span>
  </button>;
}
