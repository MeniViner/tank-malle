import { useNavigate } from "react-router-dom";
import { dayMonthShort, int } from "../../lib/format";
import { segmentContributors } from "../../lib/home/presentation";
import type { Stats } from "../../lib/stats";
import { GroupRow } from "../DesignPrimitives";
import { ConsumptionValue, Distance, Money, NumericText, NumRun, Quantity } from "../Fmt";
import { Sheet } from "../Sheet";
import { ConsumptionComparison } from "./ConsumptionComparison";

/** Re-resolve the selected identity after every edit/import; never hold stale arithmetic. */
export function SegmentSheet({ endId, stats, units, onClose, returnFocus }: {
  endId: string; stats: Stats; units: "kmPerLiter" | "litersPer100"; onClose: () => void;
  returnFocus?: () => HTMLElement | null;
}) {
  const navigate = useNavigate();
  const segment = stats.segments.find(item => item.endId === endId);
  const closing = stats.fillups.find(fill => fill.id === endId);
  const costs = segment ? segmentContributors(segment, stats.fillups) : null;
  const additionalFillups = segment ? Math.max(0, segment.fillupCount - 1) : 0;
  return <Sheet open title={segment ? <h2><NumericText>{`${dayMonthShort(segment.startDate)} – ${dayMonthShort(segment.endDate)}`}</NumericText></h2> : "מקטע"} onClose={onClose} returnFocus={returnFocus}>
    <div className="home-sheet-stack" data-testid="segment-sheet">
      {segment ? <>
        <ConsumptionValue kmPerLiter={segment.kmPerLiter} units={units} long className="home-sheet-consumption" unitClassName="home-sheet-unit" />
        <ConsumptionComparison latest={segment.kmPerLiter} average={stats.avgKmPerLiter} units={units} />
        <div className="tm-group">
          <GroupRow title="מרחק" testId="segment-distance" value={<Distance value={segment.km} align="trailing" />} />
          <GroupRow title="דלק" testId="segment-liters" subtitle={additionalFillups ? <span>תדלוקים נוספים במקטע: <NumRun>{int(additionalFillups)}</NumRun></span> : undefined}
            value={<Quantity value={segment.liters} digits={1} align="trailing" />} />
          <GroupRow title="עלות" testId="segment-cost" value={costs?.costKnown ? <Money value={segment.cost} align="trailing" /> : <NumRun>—</NumRun>} />
          <GroupRow title="עלות לק״מ" testId="segment-cost-per-km" value={costs?.costKnown
            ? <span><NumRun>{int(segment.costPerKm * 100)}</NumRun> אג׳ לק״מ</span> : <NumRun>—</NumRun>} />
          <GroupRow title="תדלוקים שנכללו" testId="segment-fillup-count" value={<NumRun>{int(segment.fillupCount)}</NumRun>} />
          {closing ? <GroupRow title="נסגר בתדלוק" subtitle={<NumericText>{closing.station?.name || "ללא מיקום"}</NumericText>}
            value={<NumericText>{dayMonthShort(closing.date)}</NumericText>} testId="segment-closing-fillup"
            onClick={() => { onClose(); navigate(`/fillup/${encodeURIComponent(closing.id)}`); }} /> : null}
        </div>
        {!costs?.costKnown ? <p className="home-sheet-note" data-testid="segment-cost-unknown">חסר סכום באחד התדלוקים. עלות המקטע אינה ידועה במלואה.</p> : null}
        <p className="home-sheet-note">מקטע נמדד בין שני תדלוקים עד הסוף: המרחק שנסעת, חלקי כל הליטרים שנכנסו אחרי התדלוק הראשון.</p>
      </> : <p>המקטע אינו זמין יותר. החישוב השתנה עם הרשומות.</p>}
    </div>
  </Sheet>;
}
