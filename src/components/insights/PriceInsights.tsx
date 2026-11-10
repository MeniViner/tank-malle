import { Link, useNavigate } from "react-router-dom";
import { Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { FUEL_TYPE_SHORT, dayMonthShort, int, num, price, shekel } from "../../lib/format";
import { EV_PRICE_PENDING } from "../../lib/vehicle/energyCopy";
import { isEv } from "../../lib/vehicle/v3Fields";
import type { DateRange } from "../../lib/periods";
import type { Vehicle } from "../../lib/stats";
import { Money, NumericText, NumRun, PricePerLiter } from "../Fmt";
import { Fact, FactsStrip } from "../FactsStrip";
import { InfoTip } from "../InfoTip";
import { CHART_MARGIN, ChartLegend, ChartValueLabel, InsightCard, InsightChart, InsightEmpty, InsightTable, InsightTooltip, QUIET_VALUE_AXIS, TIME_AXIS } from "./InsightChart";
import { priceExtremes, REFERENCE_LABELS, type PriceExtreme, type PriceSummary } from "./presentation";

// Room above the plot and at both ends for the endpoint values (v3 quiet chart, D6).
const PRICE_CHART_MARGIN = { ...CHART_MARGIN, top: 26, left: 26, right: 26 };

export function PriceInsights({ summary, vehicle, range, historyReady }: { summary: PriceSummary; vehicle: Vehicle | null; range: DateRange; historyReady: boolean }) {
  const paidPoints = summary.points.filter(point => point.paid !== null);
  const first = paidPoints[0], last = paidPoints.at(-1);
  const referenceLabel = summary.kinds.length === 1 ? REFERENCE_LABELS[summary.kinds[0]] : "מחיר להשוואה לפי מקורו";
  const hasReference = summary.kinds.length > 0;
  const rankingMax = Math.max(...summary.stations.map(station => station.average), 1);
  const navigate = useNavigate();
  if (isEv(vehicle)) return <div className="insights-stack" data-testid="insights-panel-price" data-powertrain="ev">
    {/* Stage 7 D2: a per-litre price is meaningless for an EV recorded in litres; whole-shekel totals stay valid. */}
    <InsightCard label={<>מחיר ממוצע ששילמתם · <NumericText>{range.compactLabel}</NumericText></>}
      title={<span data-testid="insights-paid-average"><NumRun>—</NumRun></span>}>
      <p className="insights-note" data-testid="insights-ev-pending">{EV_PRICE_PENDING}</p>
      {summary.fills.length ? <p className="insights-note"><NumRun>{int(summary.knownCount)}</NumRun> טעינות עם סכום ידוע · הסכומים בלשונית ההוצאות</p> : null}
    </InsightCard>
    {summary.mostExpensive ? <FactsStrip label="הטעינה היקרה בתקופה" testId="insights-price-facts">
      <Fact testId="insights-price-dearest-total" label="הטעינה היקרה ביותר" value={shekel(summary.mostExpensive.totalCost)}
        sub={<NumericText>{`${summary.mostExpensive.station?.name?.trim() || "ללא מיקום"} · ${dayMonthShort(summary.mostExpensive.date)}`}</NumericText>} />
    </FactsStrip> : null}
  </div>;
  const extremes = priceExtremes(summary.points);
  const extremeSub = (extreme: PriceExtreme) => <NumericText>{`${summary.fills.find(fill => fill.id === extreme.fillId)?.station?.name?.trim() || "ללא מיקום"} · ${dayMonthShort(extreme.date)}`}</NumericText>;
  const openFill = (extreme: PriceExtreme) => navigate(`/fillup/${encodeURIComponent(extreme.fillId)}`);
  if (!summary.fills.length) return <div className="insights-stack" data-testid="insights-panel-price">
    <InsightEmpty action={historyReady} title={historyReady ? "אין תדלוקים מהסוג הזה בתקופה שנבחרה" : "נתוני המחירים עדיין אינם זמינים"}>
      {historyReady ? <NumericText>{`המחירים מוצגים עבור ${FUEL_TYPE_SHORT[vehicle?.fuelType ?? "95"]}.`}</NumericText> : "נחכה להשלמת היסטוריית התדלוקים."}
    </InsightEmpty>
  </div>;
  return <div className="insights-stack" data-testid="insights-panel-price">
    <InsightCard label={<>{historyReady ? "מחיר ממוצע ששילמתם" : "מחיר ממוצע בתדלוקים הזמינים"} · <NumericText>{range.compactLabel}</NumericText></>}
      title={<span data-testid="insights-paid-average">{summary.average === null ? "מחיר התדלוקים עדיין חסר" : <PricePerLiter value={summary.average} />}</span>}>
      {summary.unknown > 0 ? <p className="insights-note"><NumRun>{int(summary.unknown)}</NumRun> תדלוקים עם סכום חסר{summary.knownCount ? " · סכומים ידועים בלבד" : ""}</p> : null}
      {summary.average !== null || hasReference ? <>
        <InsightChart label="מחיר לליטר בתאריכי התדלוקים" testId="insights-price-chart" points={summary.plot.length}>
          <LineChart data={summary.plot} margin={PRICE_CHART_MARGIN} accessibilityLayer>
            {/* v3 quiet chart (D6): straight segments, no value axis; the first and last paid prices are printed at their points. */}
            <XAxis {...TIME_AXIS} /><YAxis {...QUIET_VALUE_AXIS} />
            <Tooltip content={<InsightTooltip kind="price" labels={{ paid: "מה ששילמתם", official: referenceLabel }} />} />
            {hasReference ? <Line type="linear" dataKey="official" stroke="var(--ink-2)" strokeDasharray="4 5" strokeWidth={1.5}
              connectNulls={false} dot={false} isAnimationActive={false} /> : null}
            <Line type="linear" dataKey="paid" stroke="var(--ink)" strokeWidth={2.5} connectNulls={false} isAnimationActive={false}
              activeDot={{ r: 5, fill: "var(--ink)", stroke: "var(--surface)" }}
              dot={props => {
                const { cx, cy, payload } = props;
                if (payload?.paid === null || cx === undefined || cy === undefined) return <g />;
                const isLast = payload?.fillId === last?.fillId;
                const delta = (payload?.paid ?? 0) - (summary.average ?? 0);
                const color = isLast && Math.abs(delta) >= .005 ? delta > 0 ? "var(--worse)" : "var(--better)" : "var(--ink)";
                const isFirst = payload?.fillId === first?.fillId;
                return <g><circle cx={cx} cy={cy} r={isLast ? 5 : 3.5} fill={isLast ? color : "var(--surface)"} stroke={color} strokeWidth={2} />
                  {isFirst || isLast ? <ChartValueLabel className="insights-price-point-label" x={cx} y={cy - 11} fill={isLast ? color : undefined} strong={isLast}>{price(payload!.paid!)}</ChartValueLabel> : null}</g>;
              }} />
          </LineChart>
        </InsightChart>
        <div className="insights-legend"><ChartLegend>מה ששילמתם</ChartLegend>
          {hasReference ? <ChartLegend dashed color="var(--ink-2)">{referenceLabel}</ChartLegend> : null}</div>
      </> : null}
      {summary.difference !== null ? <div className="insights-price-difference" data-testid="insights-price-difference">
        <p className="insights-label">מול המחיר להשוואה בתאריכי התדלוקים</p>
        <strong>{Math.abs(summary.difference) < .005 ? "כמעט אותו מחיר לליטר" : <><NumRun>{price(Math.abs(summary.difference))}</NumRun> {summary.difference < 0 ? "פחות" : "יותר"} לליטר</>}</strong>
        <span className="insights-note">לפי <NumRun>{int(summary.comparedCount)}</NumRun> תדלוקים עם מחיר להשוואה מאותו חודש וסוג דלק.</span>
      </div> : !hasReference ? <p className="insights-note">אין מחיר להשוואה מתועד לסוג הדלק ולתאריכים האלה. מוצגים המחירים ששילמתם.</p> : null}
      <InsightTable testId="insights-price-table" caption={`מחירי התדלוקים, ${range.label}`}>
        <thead><tr><th scope="col">תדלוק</th><th scope="col">שולם לליטר</th><th scope="col">מחיר להשוואה</th></tr></thead>
        <tbody>{summary.points.map(point => <tr key={point.key} data-fillup-id={point.fillId}>
          <th scope="row"><Link className="insights-table-action" to={`/fillup/${encodeURIComponent(point.fillId!)}`}><NumericText>{dayMonthShort(point.date)}</NumericText></Link></th>
          <td><NumRun>{point.paid === null ? "—" : price(point.paid)}</NumRun></td>
          <td><NumRun>{point.official === null ? "—" : price(point.official)}</NumRun><small>{point.referenceLabel}</small></td>
        </tr>)}</tbody>
      </InsightTable>
      <div className="insights-basis"><span><NumericText>{FUEL_TYPE_SHORT[vehicle?.fuelType ?? "95"]}</NumericText> · <NumRun>{int(summary.knownCount)}</NumRun> תדלוקים עם סכום ידוע</span>
        <InfoTip label="מקור המחירים"><span>המחיר ששולם מחושב מהסכום והליטרים שתועדו בתדלוק, כולל הנחות אישיות.</span>
          <span>מחיר להשוואה נלקח מאותו חודש ומאותו סוג דלק. מקור ידני מסומן כידני; מחיר ללא מקור מפוקח אינו נקרא מחיר מפוקח.</span>
          <span>הממוצעים משוקללים לפי הליטרים שנרכשו. תדלוקים ללא סכום מלא אינם מוצגים כאפס.</span>
          {summary.otherFuelCount > 0 ? <span><NumRun>{int(summary.otherFuelCount)}</NumRun> תדלוקים מסוג דלק אחר אינם נכללים בהשוואה.</span> : null}
        </InfoTip>
      </div>
    </InsightCard>

    {extremes.dearest ? <FactsStrip label="קצוות המחיר בתקופה" testId="insights-price-facts">
      <Fact testId="insights-price-dearest" label="התדלוק היקר ביותר לליטר" sub={extremeSub(extremes.dearest)} value={price(extremes.dearest.paid)}
        onClick={() => openFill(extremes.dearest!)} ariaLabel={`התדלוק היקר ביותר לליטר, ${price(extremes.dearest.paid)}, פתיחת התדלוק`} />
      {extremes.cheapest ? <Fact testId="insights-price-cheapest" label="הכי זול ששילמתם לליטר" sub={extremeSub(extremes.cheapest)} value={price(extremes.cheapest.paid)}
        onClick={() => openFill(extremes.cheapest!)} ariaLabel={`הכי זול ששילמתם לליטר, ${price(extremes.cheapest.paid)}, פתיחת התדלוק`} /> : null}
      <Fact testId="insights-price-known-liters" label="ליטרים עם סכום ידוע" sub={<><NumRun>{int(extremes.knownCount)}</NumRun> תדלוקים</>}
        value={num(extremes.knownLiters, 1)} unit="ל׳" />
    </FactsStrip> : null}
    {summary.stations.length > 0 ? <InsightCard label="תחנות · המחירים האישיים שתועדו"
      title={summary.stations.length > 1 ? <>הכי זול ששילמתם בתקופה: <NumericText>{summary.stations[0].name}</NumericText></>
        : <>המחיר שתועד ב<NumericText>{summary.stations[0].name}</NumericText></>}>
      <ol className="insights-ranking" data-testid="insights-station-ranking">
        {summary.stations.map((station, index) => <li key={station.key} data-station-key={station.key} data-cheapest={index === 0 && summary.stations.length > 1}>
          <div className="insights-station-name"><span><NumericText>{station.name}</NumericText></span><small>
            <NumRun>{int(station.knownCount)}</NumRun> תדלוקים{station.unknown ? <> · <NumRun>{int(station.unknown)}</NumRun> סכומים חסרים</> : null}</small></div>
          <span className="insights-station-track" aria-hidden="true"><i style={{ width: `${Math.max(2, station.average / rankingMax * 100)}%` }} /></span>
          <strong><NumRun>{price(station.average)}</NumRun></strong>
        </li>)}
      </ol>
      {summary.spread !== null && summary.spread >= .005 ? <p className="insights-note" data-testid="insights-price-spread">
        הפרש של <NumRun>{price(summary.spread)}</NumRun> לליטר בין הממוצעים שתועדו
        {summary.tankSpread !== null ? <>, כ־<Money value={summary.tankSpread} /> לטנק מלא לפי נפח המיכל השמור לרכב</> : null}.
      </p> : null}
      <p className="insights-note">אלה מחירים ששילמתם, כולל הנחות אישיות, בתקופה שנבחרה.</p>
    </InsightCard> : <div className="insights-open"><h3>עוד אין תחנות להשוואה</h3><p>הדירוג יופיע כשיתועדו תחנה וסכום בתדלוק.</p></div>}
    {summary.mostExpensive ? <details className="insights-details"><summary>עוד על המחירים</summary><div className="insights-details-body">
      <p className="insights-label">התדלוק היקר ביותר בתקופה</p><strong className="insights-detail-number"><Money value={summary.mostExpensive.totalCost} /></strong>
      <p className="insights-note"><NumericText>{`${summary.mostExpensive.station?.name || "ללא מיקום"} · ${dayMonthShort(summary.mostExpensive.date)}`}</NumericText></p>
    </div></details> : null}
  </div>;
}
