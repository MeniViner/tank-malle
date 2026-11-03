import type { Stats } from "../../lib/stats";
import { GroupRow } from "../DesignPrimitives";
import { ConsumptionValue, Distance, NumRun, Quantity } from "../Fmt";
import { Sheet } from "../Sheet";

export function ConsumptionDetails({ stats, units, incomplete = false, onClose }: {
  stats: Stats; units: "kmPerLiter" | "litersPer100"; incomplete?: boolean; onClose: () => void;
}) {
  const open = stats.openSegment;
  return <Sheet open onClose={onClose} title="מדידת הצריכה">
    <div className="home-sheet-stack" data-testid="consumption-details-sheet">
      <div data-testid="consumption-average"><ConsumptionValue kmPerLiter={stats.avgKmPerLiter} units={units} long className="home-sheet-consumption" unitClassName="home-sheet-unit" /></div>
      <p className="home-sheet-note">{incomplete ? "לפי הרישומים הזמינים. חלק מהיסטוריית התדלוקים אינו זמין." : "הממוצע שלך, לפי המרחק בכל מקטע שנמדד."}</p>
      <div className="tm-group">
        <GroupRow title="מקטעים שנמדדו" value={<NumRun>{stats.segments.length}</NumRun>} testId="consumption-segment-count" />
        <GroupRow title="תדלוקים שנרשמו" value={<NumRun>{stats.records.fillupCount}</NumRun>} testId="consumption-fillup-count" />
      </div>
      <h3 className="home-group-title">המקטע הפתוח</h3>
      <div className="tm-group">
        <GroupRow title="ליטרים שממתינים לחישוב" value={<Quantity value={open.liters} digits={1} />} testId="consumption-open-liters" />
        <GroupRow title="תדלוקים שממתינים לחישוב" value={<NumRun>{open.pendingFillups}</NumRun>} testId="consumption-open-count" />
        {open.hasBaseline ? <GroupRow title="מרחק שנרשם" value={<Distance value={open.km} />} /> : null}
      </div>
      <p className="home-sheet-note">{open.nextFullWillClose
        ? "התדלוק הבא עד הסוף יסגור את המקטע. כל הליטרים שנוספו מאז התדלוק המלא הקודם ייכללו בו."
        : open.hasBaseline ? "נקודת ההתחלה נשמרה. מקטע ייסגר אחרי נסיעה ותדלוק נוסף עד הסוף."
          : "צריכה נמדדת בין שני תדלוקים עד הסוף. התדלוקים נשמרו, אך עדיין אין נקודת התחלה למדידה."}</p>
    </div>
  </Sheet>;
}
