import type { Stats } from "../../lib/stats";
import { measurementCopy, measurementCounts } from "../../lib/measurement";
import { consumption, int, num, UNITS } from "../../lib/format";
import { Fact, FactsStrip } from "../FactsStrip";
import { Sheet } from "../Sheet";

/**
 * v3 measurement sheet ("מדידת הצריכה"). Same props and test ids as
 * `home/ConsumptionDetails`, plus the §6 parity rows: full fills and restarts.
 * Rows use the shared facts strip (§3 "measurement details"); the open segment
 * is one row as in the prototype, and its litres/distance parts appear only
 * when they are not zero.
 */
export function MeasurementSheet({ stats, units, incomplete = false, onClose }: {
  stats: Stats; units: "kmPerLiter" | "litersPer100"; incomplete?: boolean; onClose: () => void;
}) {
  const open = stats.openSegment;
  const counts = measurementCounts(stats);
  const copy = measurementCopy(counts);
  const average = consumption(stats.avgKmPerLiter, units);
  const openParts = [
    open.liters > 0 ? <span key="liters" data-testid="consumption-open-liters">{num(open.liters, 1)} ליטרים ממתינים לחישוב</span> : null,
    open.km > 0 ? <span key="km">{int(open.km)} {UNITS.km} מאז נקודת ההתחלה</span> : null,
  ].filter(part => part !== null);
  return <Sheet open onClose={onClose} title="מדידת הצריכה">
    <div className="home-sheet-stack tm-measure-sheet" data-testid="consumption-details-sheet">
      <p className="home-sheet-note">צריכה נמדדת בין שני תדלוקים עד הסוף. התדלוק שפותח מקטע לא נספר בליטרים שלו.</p>
      <FactsStrip label="פרטי מדידת הצריכה">
        <Fact label="תדלוקים שנרשמו" sub={<span data-testid="consumption-full-count">{copy.fullLine}</span>}
          value={int(stats.records.fillupCount)} testId="consumption-fillup-count" />
        <Fact label="מקטעים שנמדדו" sub={<span data-testid="consumption-restart-count">{copy.restartLine}</span>}
          value={int(counts.segments)} testId="consumption-segment-count" />
        <Fact label="הממוצע שלך"
          sub={incomplete ? "לפי הרישומים הזמינים. חלק מהיסטוריית התדלוקים אינו זמין." : "לפי המרחק בכל מקטע שנמדד"}
          value={stats.avgKmPerLiter === null ? null : average.value} unit={average.unit} valueTestId="consumption-average" />
        {open.hasBaseline ? <Fact label="המקטע הפתוח"
          sub={openParts.length ? openParts.flatMap((part, index) => index ? [" · ", part] : [part]) : "נקודת ההתחלה נשמרה"}
          value={int(open.pendingFillups)} unit={open.pendingFillups === 1 ? "תדלוק" : "תדלוקים"} testId="consumption-open-count" /> : null}
      </FactsStrip>
      <p className="home-sheet-note">{open.nextFullWillClose
        ? "התדלוק הבא עד הסוף יסגור את המקטע. כל הליטרים שנוספו מאז התדלוק המלא הקודם ייכללו בו."
        : open.hasBaseline ? "נקודת ההתחלה נשמרה. מקטע ייסגר אחרי נסיעה ותדלוק נוסף עד הסוף."
          : "צריכה נמדדת בין שני תדלוקים עד הסוף. התדלוקים נשמרו, אך עדיין אין נקודת התחלה למדידה."}</p>
    </div>
  </Sheet>;
}
