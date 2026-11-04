import { useMemo, useRef } from "react";
import { Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { consumptionComparison } from "../../lib/consumptionPresentation";
import { consumption, dayMonthShort, int, num } from "../../lib/format";
import type { DateRange } from "../../lib/periods";
import type { Segment, Stats, Vehicle } from "../../lib/stats";
import { ConsumptionValue, Distance, NumericText, NumRun, Percent, Quantity } from "../Fmt";
import { InfoTip } from "../InfoTip";
import { CHART_MARGIN, ChartLegend, InsightCard, InsightChart, InsightEmpty, InsightTable, InsightTooltip, TIME_AXIS, VALUE_AXIS } from "./InsightChart";
import { consumptionNumber, consumptionPoints, type ConsumptionPoint, type ConsumptionSummary, type ConsumptionUnits } from "./presentation";

// Recharts treats formatter identity as axis settings. A fresh function would
// rebuild its keyed point layer after modal cleanup and discard restored focus.
const formatConsumptionTick = (value: number) => num(Number(value), 1);

export function ConsumptionInsights({ stats, summary, vehicle, units, range, historyReady, onSelect }: {
  stats: Stats; summary: ConsumptionSummary; vehicle: Vehicle | null; units: ConsumptionUnits; range: DateRange;
  historyReady: boolean;
  onSelect: (endId: string, returnFocus?: () => HTMLElement | null) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const points = useMemo(() => consumptionPoints(summary, stats, units), [summary, stats, units]);
  const selectPoint = (endId: string) => {
    const root = rootRef.current;
    // Recharts can replace point nodes when a sheet opens. Retain the logical
    // point only inside this exact mounted screen, including across A→B→A.
    onSelect(endId, () => root && rootRef.current === root && root.isConnected
      ? [...root.querySelectorAll<HTMLButtonElement>(".insights-point")].find(point => point.dataset.segmentEndId === endId) ?? null
      : null);
  };
  const unit = consumption(summary.average, units).unit;
  const declared = vehicle?.declaredKmPerLiter;
  const declaredComparison = consumptionComparison(summary.average, declared ?? null);
  const declaredLabel = vehicle?.declaredSource === "exact-year" ? "נתון היצרן"
    : vehicle?.declaredSource === "other-year" ? "נתון יצרן משנה אחרת"
    : vehicle?.declaredSource === "co2-estimate" ? "אומדן לפי נתוני הפליטה"
    : vehicle?.declaredSource === "user" ? "הנתון שהזנת" : "הנתון השמור לרכב";
  return <div ref={rootRef} className="insights-stack" data-testid="insights-panel-cons">
    {summary.average !== null ? <>
      <InsightCard label={<>{historyReady ? "צריכה ממוצעת" : "צריכה בתדלוקים הזמינים"} · לפי המרחק והדלק שנמדדו · <NumericText>{range.compactLabel}</NumericText></>}
        title={<span data-testid="insights-consumption-average">{units === "kmPerLiter" ? "אתה נוסע " : "אתה צורך "}
          <ConsumptionValue kmPerLiter={summary.average} units={units} long /></span>}>
        <InsightChart label={`צריכה · ${unit}`} testId="insights-consumption-chart" points={points.length} pointSpacing={44}>
          <LineChart data={points} margin={{ ...CHART_MARGIN, top: 26, left: 24, right: 24 }} accessibilityLayer={false}>
            <XAxis {...TIME_AXIS} /><YAxis {...VALUE_AXIS} tickFormatter={formatConsumptionTick} domain={["auto", "auto"]} />
            <Tooltip content={<InsightTooltip suffix={unit} labels={{ value: "במקטע" }} />} />
            <ReferenceLine y={consumptionNumber(summary.average, units)} stroke="var(--ink-2)" strokeDasharray="5 5" strokeWidth={1} />
            <Line type="monotone" dataKey="value" stroke="var(--ink)" strokeWidth={2.5} connectNulls={false} isAnimationActive={false}
              activeDot={false} dot={props => <ConsumptionDot cx={props.cx} cy={props.cy} payload={props.payload} summary={summary} units={units} onSelect={selectPoint} />} />
          </LineChart>
        </InsightChart>
        <div className="insights-legend"><ChartLegend>כל מקטע בין טנקים מלאים</ChartLegend>
          <ChartLegend dashed color="var(--ink-2)">הממוצע שלך · <NumRun>{consumption(summary.average, units).value}</NumRun></ChartLegend></div>
        {declared && declaredComparison ? <p className="insights-note" data-testid="insights-manufacturer-comparison">
          {declaredComparison.tone === "neutral" ? <>קרוב ל{declaredLabel}</>
            : <><Percent value={declaredComparison.percent} /> {declaredComparison.tone === "worse" ? "יותר" : "פחות"} דלק לק״מ לעומת {declaredLabel}</>}
          {" "}(<ConsumptionValue kmPerLiter={declared} units={units} />).
        </p> : null}
        <InsightTable testId="insights-consumption-table" caption={`מקטעי הצריכה, ${range.label}`} label="כל המקטעים ופרטיהם">
          <thead><tr><th scope="col">סיום המקטע</th><th scope="col">צריכה</th><th scope="col">מרחק</th><th scope="col">דלק</th></tr></thead>
          <tbody>{summary.ordered.map(segment => <tr key={segment.endId} data-segment-end-id={segment.endId}>
            <th scope="row"><button type="button" className="insights-table-action" onClick={() => onSelect(segment.endId)}
              aria-label={`פרטי המקטע עד ${dayMonthShort(segment.endDate)}`}><NumericText>{dayMonthShort(segment.endDate)}</NumericText></button></th>
            <td><ConsumptionValue kmPerLiter={segment.kmPerLiter} units={units} /></td><td><Distance value={segment.km} /></td><td><Quantity value={segment.liters} digits={1} /></td>
          </tr>)}</tbody>
        </InsightTable>
      </InsightCard>
      <div className="insights-kpis">
        <SegmentKpi segment={summary.best!} units={units} title="המקטע הטוב" testId="insights-best-segment" onSelect={onSelect} />
        <SegmentKpi segment={summary.worst!} units={units} title="המקטע החלש" testId="insights-worst-segment" onSelect={onSelect} />
        <div className="insights-kpi" data-testid="insights-measured-km"><span>מרחק שנמדד</span><strong><NumRun>{int(summary.km)}</NumRun></strong>
          <small>ק״מ ב־<NumRun>{int(summary.segments.length)}</NumRun> מקטעים סגורים</small></div>
        <div className="insights-kpi" data-testid="insights-measured-liters"><span>דלק במקטעים</span><strong><NumRun>{num(summary.liters, 1)}</NumRun></strong><small>ליטרים</small></div>
      </div>
    </> : <InsightEmpty action={historyReady} title={!historyReady ? "נתוני הצריכה עדיין אינם זמינים" : stats.segments.length ? "אין מקטעים סגורים בתקופה הזו" : stats.openSegment.hasBaseline ? "עוד תדלוק מלא אחד ונדע" : "מתחילים מתדלוק מלא"}>
      {!historyReady ? "נחכה להשלמת היסטוריית התדלוקים." : stats.segments.length ? "אפשר לבחור תקופה אחרת כדי לראות את המקטעים שנמדדו."
        : "צריכה נמדדת בין שני תדלוקים שסומנו כמלאים, יחד עם התדלוקים החלקיים שביניהם."}
    </InsightEmpty>}
    {historyReady ? <OpenSegment stats={stats} /> : null}
    <div className="insights-basis"><span><NumRun>{int(summary.segments.length)}</NumRun> מקטעים סגורים · <NumericText>{range.compactLabel}</NumericText></span>
      <InfoTip label="בסיס החישוב">
        <span>המקטעים נבנים מכל ההיסטוריה, והתקופה נבחרת לפי מועד סגירת כל מקטע.</span>
        <span>הממוצע מחושב מסך המרחק והליטרים במקטעים; התדלוק שפתח את המקטע אינו נכלל בליטרים או בעלות שלו.</span>
        <span>הליטרים במקטע הפתוח ייכללו במדידה כשהוא ייסגר בתדלוק מלא.</span>
        {stats.breakCount > 0 ? <span>יש <NumRun>{int(stats.breakCount)}</NumRun> {stats.breakCount === 1 ? "נקודת התחלה מחדש" : "נקודות התחלה מחדש"}. חישובי הצריכה והקו אינם חוצים אותן.</span> : null}
      </InfoTip>
    </div>
  </div>;
}

function ConsumptionDot({ cx, cy, payload, summary, units, onSelect }: {
  cx?: number; cy?: number; payload?: ConsumptionPoint; summary: ConsumptionSummary; units: ConsumptionUnits; onSelect: (endId: string) => void;
}) {
  if (!payload?.endId || cx === undefined || cy === undefined) return <g />;
  const segment = summary.segments.find(item => item.endId === payload.endId);
  if (!segment) return <g />;
  const last = payload.endId === summary.last?.endId;
  const color = last && summary.lastTone !== "neutral" ? `var(--${summary.lastTone})` : "var(--ink)";
  const shown = consumption(segment.kmPerLiter, units);
  return <g>
    <circle cx={cx} cy={cy} r={last ? 5.5 : 3.5} fill={last ? color : "var(--surface)"} stroke={color} strokeWidth={2} pointerEvents="none" />
    <foreignObject x={cx - 22} y={cy - 22} width={44} height={44}>
      <button type="button" className="insights-point" data-segment-end-id={payload.endId}
        aria-label={`מקטע עד ${payload.label}, ${shown.value} ${shown.unit}, פתיחת פרטים`}
        onClick={event => { event.currentTarget.focus(); onSelect(segment.endId); }} />
    </foreignObject>
  </g>;
}

function SegmentKpi({ segment, units, title, testId, onSelect }: {
  segment: Segment; units: ConsumptionUnits; title: string; testId: string; onSelect: (endId: string) => void;
}) {
  return <button type="button" className="insights-kpi" data-testid={testId} data-segment-end-id={segment.endId} onClick={() => onSelect(segment.endId)}>
    <span>{title}</span><strong><ConsumptionValue kmPerLiter={segment.kmPerLiter} units={units} /></strong><small><NumericText>{dayMonthShort(segment.endDate)}</NumericText> ←</small>
  </button>;
}

function OpenSegment({ stats }: { stats: Stats }) {
  const open = stats.openSegment;
  if (!stats.fillups.length || open.hasBaseline && open.pendingFillups === 0) return null;
  return <div className="insights-open" data-testid="insights-open-segment"><h3>המקטע שעדיין פתוח</h3>
    {open.hasBaseline ? <p><Quantity value={open.liters} digits={1} /> מ־<NumRun>{int(open.pendingFillups)}</NumRun> תדלוקים · <Distance value={open.km} /> מהתדלוק המלא האחרון</p>
      : <p>מחכים לתדלוק מלא שיפתח מדידה</p>}
  </div>;
}
