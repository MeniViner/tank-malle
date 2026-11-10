import type { Stats } from "../../lib/stats";
import { measurementCopy, measurementCounts } from "../../lib/measurement";
import { GroupRow } from "../DesignPrimitives";
import { ConsumptionValue, Distance, NumRun, Quantity } from "../Fmt";
import { Sheet } from "../Sheet";

/**
 * v3 measurement sheet ("מדידת הצריכה"). Same props and test ids as
 * `home/ConsumptionDetails`, plus the §6 parity rows: full fills and restarts.
 * Drop-in: the Home opener only swaps the import (owned by the Home stage).
 */
export function MeasurementSheet({ stats, units, incomplete = false, onClose }: {
  stats: Stats; units: "kmPerLiter" | "litersPer100"; incomplete?: boolean; onClose: () => void;
}) {
  const open = stats.openSegment;
  const counts = measurementCounts(stats);
  const copy = measurementCopy(counts);
  return <Sheet open onClose={onClose} title="מדידת הצריכה">
    <div className="home-sheet-stack tm-measure-sheet" data-testid="consumption-details-sheet">
      <p className="home-sheet-note">צריכה נמדדת בין שני תדלוקים עד הסוף. התדלוק שפותח מקטע לא נספר בליטרים שלו.</p>
      <div data-testid="consumption-average"><ConsumptionValue kmPerLiter={stats.avgKmPerLiter} units={units} long className="home-sheet-consumption" unitClassName="home-sheet-unit" /></div>
      <p className="home-sheet-note">{incomplete ? "לפי הרישומים הזמינים. חלק מהיסטוריית התדלוקים אינו זמין." : "הממוצע שלך, לפי המרחק בכל מקטע שנמדד."}</p>
      <div className="tm-group">
        <GroupRow title="תדלוקים שנרשמו" subtitle={<span data-testid="consumption-full-count">{copy.fullLine}</span>}
          value={<NumRun>{stats.records.fillupCount}</NumRun>} testId="consumption-fillup-count" />
        <GroupRow title="מקטעים שנמדדו" subtitle={<span data-testid="consumption-restart-count">{copy.restartLine}</span>}
          value={<NumRun>{counts.segments}</NumRun>} testId="consumption-segment-count" />
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
