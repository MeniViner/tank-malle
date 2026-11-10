import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { useVehicleData } from "../../context/VehicleDataContext";
import { useTankEstimate } from "../../hooks/useTankEstimate";
import { useTco } from "../../hooks/useTco";
import { TcoBlock } from "../TcoBlock";
import { int, num } from "../../lib/format";
import { bucketSpend, GROUPING_LABELS, inRange, summariseSpend, type DateRange } from "../../lib/periods";
import type { Stats } from "../../lib/stats";
import { periodSummary } from "../../lib/vehicle/derived";
import { vehicleDay } from "../../lib/vehicle/format";
import { NumericText, NumRun, Quantity } from "../Fmt";
import { InfoTip } from "../InfoTip";
import { ChevronStart } from "../icons";
import { Segmented } from "../Segmented";
import { CHART_MARGIN, ChartLegend, InsightCard, InsightChart, InsightTable, InsightTooltip, LedgerAmount, TIME_AXIS, VALUE_AXIS } from "./InsightChart";
import { journalRangeLink, knownFillCost, odometerPoints, spendingSummary, type ConsumptionSummary } from "./presentation";

const SPEND_LABELS = { fuel: "דלק", service: "טיפולים", other: "הוצאות אחרות", refunds: "החזרים" };

export function SpendingInsights({ stats, consumption, range, from, to, historyReady }: {
  stats: Stats; consumption: ConsumptionSummary; range: DateRange; from: string; to: string; historyReady: boolean;
}) {
  const vehicle = useVehicleData();
  const tank = useTankEstimate();
  const tco = useTco(tank.estimate.mobility.kmPerDay);
  const summary = useMemo(() => spendingSummary(vehicle.ledger, from, to), [vehicle.ledger, from, to]);
  const ownership = useMemo(() => periodSummary(vehicle.ledger, vehicle.mileage, from, to, vehicle.incomplete), [vehicle.ledger, vehicle.mileage, from, to, vehicle.incomplete]);
  const patternId = useId().replace(/:/g, "");
  const amount = !summary.rows.length && vehicle.incomplete ? null : summary.amount;
  const fuelCost = vehicle.incomplete ? null : consumption.costPerKm;
  const links = [
    { kind: "fuel" as const, label: "דלק", amount: summary.fuelAmount, count: summary.fuelCount },
    { kind: "service" as const, label: "טיפולים", amount: summary.serviceAmount, count: summary.serviceCount },
    { kind: "expense" as const, label: "הוצאות אחרות", amount: summary.expenseAmount, count: summary.expenseCount },
  ];
  return <div className="insights-stack" data-testid="insights-panel-spend">
    <TcoBlock tco={tco} compact />
    <InsightCard label={<>הוצאות הרכב · <NumericText>{range.compactLabel}</NumericText></>}
      title={<>תועדו ברכב <span className="insights-total" data-testid="running-total"><LedgerAmount value={amount} /></span> נטו</>}>
      <p className="insights-note" data-testid="insights-spend-coverage" role="status">
        {amount === null ? "סכום ההוצאות עדיין אינו ידוע. " : summary.totals.unknown ? "סכומים ידועים בלבד. " : ""}
        {summary.totals.unknown > 0 ? <><NumRun>{int(summary.totals.unknown)}</NumRun> {summary.totals.unknown === 1 ? "רשומה ללא עלות מלאה" : "רשומות ללא עלות מלאה"}. </> : null}
        {vehicle.incomplete ? "חלק מהרשומות עדיין אינן מאושרות או זמינות. " : null}
        {summary.totals.refunds > 0 ? <>אחרי <LedgerAmount value={summary.totals.refunds} /> שהוחזרו. </> : null}
        {!summary.rows.length && !vehicle.incomplete ? "אין הוצאות מתועדות בתקופה שנבחרה." : null}
      </p>
      {summary.rows.length > 0 ? <>
        <InsightChart label="הוצאות הרכב לפי חודש, כולל החזרים" testId="insights-spend-chart" points={summary.months.length}>
          <BarChart data={summary.months} margin={CHART_MARGIN} stackOffset="sign" accessibilityLayer>
            <defs><pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--surface)" />
              <path d="M-1 1L1-1M0 6L6 0M5 7L7 5" stroke="var(--ink-2)" strokeWidth="1" /></pattern></defs>
            <XAxis {...TIME_AXIS} /><YAxis {...VALUE_AXIS} width={42} allowDecimals={false} tickFormatter={value => int(Number(value))}
              domain={[(minimum: number) => Math.min(0, minimum), (maximum: number) => Math.max(0, maximum)]} />
            <Tooltip content={<InsightTooltip kind="money" labels={SPEND_LABELS} />} />
            <ReferenceLine y={0} stroke="var(--ink-2)" strokeWidth={1} />
            <Bar dataKey="fuel" stackId="spending" fill="var(--cat-fuel)" stroke="var(--ink)" strokeWidth={.65} maxBarSize={36} isAnimationActive={false} />
            <Bar dataKey="service" stackId="spending" fill="var(--cat-service)" maxBarSize={36} isAnimationActive={false} />
            <Bar dataKey="other" stackId="spending" fill="var(--cat-other)" stroke="var(--ink)" strokeWidth={.65} maxBarSize={36} isAnimationActive={false} />
            <Bar dataKey="refunds" stackId="spending" fill={`url(#${patternId})`} stroke="var(--ink-2)" strokeWidth={.65} maxBarSize={36} isAnimationActive={false} />
          </BarChart>
        </InsightChart>
        <div className="insights-legend"><ChartLegend block color="var(--cat-fuel)">דלק</ChartLegend><ChartLegend block color="var(--cat-service)">טיפולים</ChartLegend>
          <ChartLegend block outlined color="var(--cat-other)">הוצאות</ChartLegend>
          {summary.totals.refunds > 0 ? <ChartLegend block outlined color="var(--surface)">החזרים מתחת לאפס</ChartLegend> : null}</div>
        <InsightTable testId="insights-spend-table" caption={`הוצאות הרכב לפי חודש, ${range.label}`}>
          <thead><tr><th scope="col">חודש</th><th scope="col">דלק</th><th scope="col">טיפולים</th><th scope="col">אחרות</th><th scope="col">החזרים</th><th scope="col">נטו</th></tr></thead>
          <tbody>{summary.months.map(month => <tr key={month.key} data-month={month.key}>
            <th scope="row"><NumericText>{month.label}</NumericText>{month.unknown > 0 ? <small><NumRun>{int(month.unknown)}</NumRun> {month.unknown === 1 ? "עלות חסרה" : "עלויות חסרות"}</small> : null}</th>
            {[month.fuel, month.service, month.other, month.refunds, month.total].map((value, index) => <td key={index}><LedgerAmount value={value === null ? null : Math.round(value * 100)} /></td>)}
          </tr>)}</tbody>
        </InsightTable>
      </> : <Link className="insights-text-action" to={journalRangeLink("all", from, to)}>לרשומות בתקופה הזו ←</Link>}
    </InsightCard>

    <InsightCard className="insights-cost-card" label="דלק שנמדד במקטעים סגורים"
      title={fuelCost === null ? "עלות הדלק לק״מ עדיין לא ידועה" : "כל ק״מ עולה לך"}>
      <strong className="insights-cost-value" data-testid="insights-fuel-cost-per-km"><NumRun>{fuelCost === null ? "—" : int(fuelCost * 100)}</NumRun><span> אג׳</span></strong>
      <p className="insights-note">{vehicle.incomplete ? "נחכה עד שהרשומות יהיו זמינות ומאושרות."
        : !consumption.segments.length ? "העלות תופיע אחרי סגירת מקטע צריכה בתקופה הזו."
        : !consumption.costKnown ? "חסר סכום באחד התדלוקים שנכללו במקטעים."
        : <><NumRun>{int(consumption.km)}</NumRun> ק״מ שנמדדו</>}</p>
      <div className="insights-basis"><span>עלות הדלק שנמדד</span><InfoTip label="איך מחושבת עלות הדלק לק״מ">
        <span>העלות כוללת את התדלוקים במקטעים הסגורים, ללא התדלוק שפתח כל מקטע. היא מחולקת בסך המרחק שנמדד באותם מקטעים.</span>
      </InfoTip></div>
    </InsightCard>

    <nav className="insights-journal-links" aria-label="פירוט ההוצאות ביומן">
      {links.map(link => <Link key={link.kind} to={journalRangeLink(link.kind, from, to)} data-testid={`insights-journal-${link.kind}`}>
        <span><strong>{link.label}</strong>{link.kind === "expense" && summary.totals.refunds > 0 ? <small>אחרי החזרים</small> : null}</span>
        <span className="insights-link-value"><LedgerAmount value={vehicle.incomplete && !link.count ? null : link.amount} /><ChevronStart size={18} /></span>
      </Link>)}
    </nav>

    <details className="insights-details" data-testid="insights-ownership-detail"><summary>עלויות הרכב והמרחק המתועד</summary>
      <div className="insights-details-body"><div className="insights-kpis insights-kpis-compact">
        <div className="insights-kpi"><span>הכול לק״מ</span><strong><NumRun>{ownership.costPerKm === null ? "—" : int(ownership.costPerKm * 100)}</NumRun> <small>אג׳</small></strong></div>
        <div className="insights-kpi"><span>רכישות דלק לק״מ</span><strong><NumRun>{ownership.fuelPerKm === null ? "—" : int(ownership.fuelPerKm * 100)}</NumRun> <small>אג׳</small></strong></div>
      </div>
      <p className="insights-note">{ownership.distance === null ? "אין טווח קילומטראז׳ מספיק ועקבי לחישוב עלות לק״מ."
        : <>לפי <NumRun>{int(ownership.distance)}</NumRun> ק״מ שתועדו בין <NumericText>{vehicleDay(ownership.fromDay!)}</NumericText> ל־<NumericText>{vehicleDay(ownership.toDay!)}</NumericText>.</>}
        {ownership.incomplete ? " חלק מהרשומות עדיין אינן זמינות או מאושרות." : ""}
        {ownership.boundaryUnknown ? " סדר הרשומות בגבול התקופה אינו ידוע." : ""}
        {ownership.mileageInconsistent ? " קריאות הקילומטראז׳ אינן עקביות." : ""}
        {ownership.continuityMissing ? " יש הפסקת רציפות בטווח." : ""}
        {ownership.unknown ? " יש עלויות חסרות." : ""}</p>
      <p className="insights-note">היחסים כוללים רק הוצאות בתוך טווח המרחק המתועד, ללא ירידת ערך. רכישות דלק וצריכת דלק שנמדדה הן שני נתונים שונים.</p>
      </div>
    </details>
    <FuelPurchaseDetail stats={stats} range={range} now={vehicle.now} historyReady={historyReady} />
  </div>;
}

function FuelPurchaseDetail({ stats, range, now, historyReady }: { stats: Stats; range: DateRange; now: number; historyReady: boolean }) {
  const [open, setOpen] = useState(false);
  const [grouping, setGrouping] = useState<"week" | "month" | "year">("month");
  const gradientId = useId().replace(/:/g, "");
  const known = useMemo(() => stats.fillups.filter(knownFillCost), [stats.fillups]);
  const selected = stats.fillups.filter(fill => inRange(fill.date, range));
  const complete = historyReady && selected.every(knownFillCost);
  const spend = useMemo(() => summariseSpend(known, range, now), [known, range, now]);
  const buckets = useMemo(() => bucketSpend(known, range, grouping), [known, range, grouping]);
  const odometer = useMemo(() => odometerPoints(stats, range), [stats, range]);
  const yearStart = +new Date(new Date(now).getFullYear(), 0, 1);
  const yearComplete = historyReady && stats.fillups.filter(fill => fill.date >= yearStart && fill.date <= now).every(knownFillCost);
  return <details className="insights-details" data-testid="insights-fuel-detail" onToggle={event => setOpen(event.currentTarget.open)}><summary>פירוט רכישות דלק וקילומטראז׳</summary>
    {open ? <div className="insights-details-body">
      <p className="insights-note">כל רכישות הדלק בתקופה, גם בתדלוקים חלקיים ולפני התחלת מדידה. הסכומים והגרף כוללים עלויות ידועות בלבד.</p>
      {!historyReady ? <p className="insights-note" role="status">הממוצעים והסכום מתחילת השנה יופיעו אחרי השלמת ההיסטוריה.</p> : null}
      <div className="insights-kpis insights-kpis-compact">
        <div className="insights-kpi"><span>ליטרים שנרכשו</span><strong>{!historyReady && !selected.length ? <NumRun>—</NumRun> : <Quantity value={selected.reduce((sum, fill) => sum + fill.liters, 0)} digits={1} />}</strong></div>
        <div className="insights-kpi"><span>ממוצע שבועי</span><strong><LedgerAmount value={complete && spend.perWeek !== null ? Math.round(spend.perWeek * 100) : null} /></strong></div>
        <div className="insights-kpi"><span>ממוצע חודשי</span><strong><LedgerAmount value={complete && spend.perMonth !== null ? Math.round(spend.perMonth * 100) : null} /></strong></div>
        <div className="insights-kpi"><span>מתחילת השנה</span><strong><LedgerAmount value={yearComplete ? Math.round(spend.yearToDate * 100) : null} /></strong></div>
      </div>
      <div className="insights-basis"><span>ממוצעים לפי משך התקופה</span><InfoTip label="בסיס ממוצעי ההוצאות">
        <span>הממוצע השבועי והחודשי מחושבים לפי הזמן שעבר בתקופה, כולל ימים ללא תדלוק. סכום חסר משאיר את הממוצע לא ידוע.</span>
      </InfoTip></div>
      <Segmented value={grouping} options={(["week", "month", "year"] as const).map(value => ({ value, label: GROUPING_LABELS[value] }))}
        onChange={setGrouping} ariaLabel="קיבוץ" size="sm" />
      <h3 className="insights-detail-title">הוצאה · {GROUPING_LABELS[grouping]}</h3>
      <InsightChart label={`רכישות דלק · ${GROUPING_LABELS[grouping]}`} testId="insights-fuel-grouped-chart" points={buckets.length}>
        <BarChart data={buckets} margin={CHART_MARGIN} accessibilityLayer><XAxis {...TIME_AXIS} />
          <YAxis {...VALUE_AXIS} width={42} allowDecimals={false} tickFormatter={value => int(Number(value))} />
          <Tooltip content={<InsightTooltip kind="money" labels={{ cost: "רכישות דלק" }} />} />
          <Bar dataKey="cost" fill="var(--cat-fuel)" stroke="var(--ink)" strokeWidth={.65} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </InsightChart>
      <InsightTable testId="insights-fuel-grouped-table" caption={`רכישות דלק בקיבוץ ${GROUPING_LABELS[grouping]}`}>
        <thead><tr><th scope="col">תקופה</th><th scope="col">סכום ידוע</th><th scope="col">ליטרים עם סכום ידוע</th></tr></thead>
        <tbody>{buckets.map(bucket => <tr key={bucket.key}><th scope="row"><NumericText>{bucket.label}</NumericText></th><td><LedgerAmount value={Math.round(bucket.cost * 100)} /></td><td><NumRun>{num(bucket.liters, 1)}</NumRun></td></tr>)}</tbody>
      </InsightTable>
      <h3 className="insights-detail-title">קילומטראז׳ מצטבר</h3>
      <InsightChart label="קילומטראז׳ מצטבר, כולל הפסקות רציפות" testId="insights-odometer-chart" points={odometer.length}>
        <AreaChart data={odometer} margin={CHART_MARGIN} accessibilityLayer>
          <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--ink)" stopOpacity={.1} /><stop offset="100%" stopColor="var(--ink)" stopOpacity={0} /></linearGradient></defs>
          <XAxis {...TIME_AXIS} /><YAxis {...VALUE_AXIS} width={52} domain={[0, "auto"]} tickFormatter={value => int(Number(value))} />
          <Tooltip content={<InsightTooltip kind="integer" suffix="ק״מ" labels={{ odometer: "קילומטראז׳" }} />} />
          <Area type="linear" dataKey="odometer" fill={`url(#${gradientId})`} stroke="var(--ink)" strokeWidth={2} connectNulls={false} isAnimationActive={false} />
        </AreaChart>
      </InsightChart>
      <InsightTable testId="insights-odometer-table" caption="קריאות הקילומטראז׳ בתדלוקים">
        <thead><tr><th scope="col">תאריך</th><th scope="col">קילומטראז׳</th></tr></thead><tbody>{odometer.filter(point => point.odometer !== null).map(point =>
          <tr key={point.key}><th scope="row"><NumericText>{point.label}</NumericText></th><td><NumRun>{int(point.odometer!)}</NumRun> ק״מ</td></tr>)}</tbody>
      </InsightTable>
      {stats.breakCount > 0 ? <p className="insights-note">יש <NumRun>{int(stats.breakCount)}</NumRun> נקודות התחלה מחדש בהיסטוריה. הקו נקטע שם בכוונה; לא מוצג רצף על פני תדלוקים שלא תועדו.</p> : null}
    </div> : null}
  </details>;
}
