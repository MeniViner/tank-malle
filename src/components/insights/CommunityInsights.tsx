import { Link } from "react-router-dom";
import { Bar, BarChart, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { hasComparison, MIN_PEERS, type BenchmarkComparison, type InsufficientPeers } from "../../lib/benchmarks";
import { consumption, int, num, price } from "../../lib/format";
import { ConsumptionValue, NumericText, NumRun, Percent, PricePerLiter } from "../Fmt";
import { InfoTip } from "../InfoTip";
import { CHART_MARGIN, ChartLegend, InsightCard, InsightChart, InsightTable, InsightTooltip, TIME_AXIS, VALUE_AXIS } from "./InsightChart";
import { consumptionNumber, consumptionRangeLabel, type ConsumptionUnits } from "./presentation";

export function CommunityInsights({ comparison, loading, sharing, hasOwnFigure, ownPriceKnown, units, historyReady, historyLoading, historyLabel }: {
  comparison: BenchmarkComparison | InsufficientPeers | null; loading: boolean; sharing: boolean;
  hasOwnFigure: boolean; ownPriceKnown: boolean; units: ConsumptionUnits;
  historyReady: boolean; historyLoading: boolean; historyLabel: string;
}) {
  const state = !sharing ? "off" : !historyReady ? historyLoading ? "history-loading" : "history-unavailable"
    : !hasOwnFigure ? "own-needed" : loading ? "loading" : !comparison ? "unavailable"
    : hasComparison(comparison) ? "ready" : "insufficient";
  const found = comparison && !hasComparison(comparison) ? comparison.peers : 0;
  const required = comparison && !hasComparison(comparison) ? comparison.required : MIN_PEERS;
  const missing = Math.max(0, required - found);
  return <div className="insights-stack" data-testid="insights-panel-community">
    <div data-testid="insights-community-status" data-state={state}>
      {state === "off" ? <InsightCard label="השוואה לרכבים בקבוצה" title="ההשוואה כבויה">
        <p className="insights-note">ההשתתפות בשיתוף הסיכום כבויה בחשבון שלך.</p>
        <Link className="insights-text-action" to="/account">שינוי ההשתתפות בחשבון ←</Link>
      </InsightCard> : null}
      {state === "history-loading" || state === "history-unavailable" ? <InsightCard label="השוואה לרכבים בקבוצה" title="נחכה להשלמת היסטוריית התדלוקים">
        <p className="insights-note" role="status">{historyLabel}</p>
      </InsightCard> : null}
      {state === "own-needed" ? <InsightCard label="השוואה לרכבים בקבוצה" title="עוד קצת מדידה לפני ההשוואה">
        <p className="insights-note">נדרשים לפחות שני מקטעי צריכה סגורים כדי לשתף סיכום ולהציג השוואה.</p>
        <Link className="insights-text-action" to="/fillup/new">תדלוק חדש ←</Link>
      </InsightCard> : null}
      {state === "loading" ? <InsightCard label="השוואה לרכבים בקבוצה" title="בודקים את קבוצת ההשוואה">
        <p className="insights-note" role="status">טוענים את סיכומי הרכבים.</p>
      </InsightCard> : null}
      {state === "unavailable" ? <InsightCard label="השוואה לרכבים בקבוצה" title="ההשוואה אינה זמינה כרגע">
        <p className="insights-note">לא התקבלו נתוני קבוצה. אפשר לחזור לכאן כשהחיבור זמין.</p>
      </InsightCard> : null}
      {state === "insufficient" ? <InsightCard label="השוואה לרכבים בקבוצה" title={missing === 1 ? "עוד סיכום רכב אחד ונשווה" : <>מחכים לעוד <NumRun>{int(missing)}</NumRun> סיכומי רכבים</>}>
        <div className="insights-progress" role="progressbar" aria-label="סיכומי רכבים בקבוצת ההשוואה" aria-valuemin={0}
          aria-valuemax={required} aria-valuenow={Math.min(required, found)} data-testid="insights-community-progress">
          <span style={{ width: `${Math.min(100, found / required * 100)}%` }} />
        </div>
        <div className="insights-basis"><span><NumRun>{int(found)}</NumRun> מתוך <NumRun>{int(required)}</NumRun> סיכומי רכבים</span>
          <InfoTip label="איך נבחרת קבוצת ההשוואה"><span>ההשוואה מחפשת אותו דגם וסוג דלק, ואם אין מספיק סיכומים — אותו סוג דלק.</span></InfoTip>
        </div>
      </InsightCard> : null}
      {state === "ready" && hasComparison(comparison) ? <PeerComparison comparison={comparison} units={units} ownPriceKnown={ownPriceKnown} /> : null}
    </div>
    <PrivacyCard sharing={sharing} />
  </div>;
}

function PeerComparison({ comparison, units, ownPriceKnown }: { comparison: BenchmarkComparison; units: ConsumptionUnits; ownPriceKnown: boolean }) {
  const unit = consumption(comparison.yourAverage, units).unit;
  const distribution = comparison.distribution.map((bucket, index) => ({
    key: String(index), label: consumptionRangeLabel(bucket.from, bucket.to, units),
    count: bucket.count, isYou: bucket.isYou,
  }));
  const versus = [
    { label: "שלך", value: consumptionNumber(comparison.yourAverage, units), canonical: comparison.yourAverage, isYou: true },
    { label: "ממוצע הקבוצה", value: consumptionNumber(comparison.peerAverage, units), canonical: comparison.peerAverage, isYou: false },
    { label: "החסכוני בקבוצה", value: consumptionNumber(comparison.best, units), canonical: comparison.best, isYou: false },
  ];
  return <div className="insights-stack">
    <InsightCard label={<>לפי כל ההיסטוריה · <NumRun>{int(comparison.peers)}</NumRun> סיכומי רכבים</>}
      title={<><Percent value={comparison.percentile} /> מהסיכומים מצביעים על צריכת דלק גבוהה משלך לק״מ</>}>
      <div className="insights-comparison-pair"><div><span>הממוצע שלך</span><strong><ConsumptionValue kmPerLiter={comparison.yourAverage} units={units} /></strong></div>
        <div><span>ממוצע הקבוצה</span><strong><ConsumptionValue kmPerLiter={comparison.peerAverage} units={units} /></strong></div></div>
      <div className="insights-basis"><span>{comparison.basis === "model" ? "אותו דגם ואותו סוג דלק" : "אותו סוג דלק"}</span>
        <InfoTip label="מה ההשוואה אומרת"><span>הקבוצה כוללת ממוצעים מתועדים של רכבים עם {comparison.basis === "model" ? "אותו דגם ואותו סוג דלק" : "אותו סוג דלק"}. תנאי הנסיעה עשויים להיות שונים.</span></InfoTip>
      </div>
    </InsightCard>
    <InsightCard label="התפלגות הצריכה בקבוצה" title="כך הממוצע שלך משתלב בקבוצה">
      <InsightChart label={`התפלגות ממוצעי הצריכה · ${unit}`} testId="insights-community-distribution" chronological={false}>
        <BarChart data={distribution} margin={CHART_MARGIN} accessibilityLayer>
          <XAxis {...TIME_AXIS} /><YAxis {...VALUE_AXIS} allowDecimals={false} tickFormatter={value => int(Number(value))} />
          <Tooltip content={<InsightTooltip kind="integer" suffix="סיכומי רכבים" labels={{ count: "בקבוצה" }} />} />
          <Bar dataKey="count" maxBarSize={36} isAnimationActive={false}>{distribution.map(bucket =>
            <Cell key={bucket.key} fill={bucket.isYou ? "var(--accent)" : "var(--surface-2)"} stroke="var(--ink)" strokeWidth={.75} />)}</Bar>
        </BarChart>
      </InsightChart>
      <div className="insights-legend"><ChartLegend block color="var(--accent)">הטווח שבו נמצא הממוצע שלך</ChartLegend></div>
      <InsightTable testId="insights-community-distribution-table" caption={`התפלגות סיכומי רכבים לפי ${unit}`}>
        <thead><tr><th scope="col">טווח הצריכה</th><th scope="col">סיכומי רכבים</th><th scope="col">הממוצע שלך</th></tr></thead>
        <tbody>{distribution.map(bucket => <tr key={bucket.key}><th scope="row"><NumRun>{bucket.label}</NumRun></th><td><NumRun>{int(bucket.count)}</NumRun></td><td>{bucket.isYou ? "בטווח הזה" : "—"}</td></tr>)}</tbody>
      </InsightTable>
    </InsightCard>
    <InsightCard label="אותה יחידת צריכה, שלושה ממוצעים" title="הממוצע שלך מול הקבוצה">
      <InsightChart label={`השוואת ממוצעי צריכה · ${unit}`} testId="insights-community-versus" chronological={false}>
        <BarChart data={versus} layout="vertical" margin={{ top: 8, bottom: 6, left: 8, right: 0 }} accessibilityLayer>
          <XAxis type="number" reversed tick={{ fill: "var(--ink-2)", fontSize: 12, direction: "ltr", unicodeBidi: "isolate" }} tickLine={false} axisLine={false} tickFormatter={value => num(Number(value), 1)} />
          <YAxis type="category" dataKey="label" orientation="right" width={88} tick={{ fill: "var(--ink-2)", fontSize: 12 }} tickLine={false} axisLine={false} />
          <Tooltip content={<InsightTooltip suffix={unit} />} />
          <Bar dataKey="value" maxBarSize={24} isAnimationActive={false}>{versus.map(row =>
            <Cell key={row.label} fill={row.isYou ? "var(--accent)" : "var(--surface-2)"} stroke="var(--ink)" strokeWidth={.75} />)}</Bar>
        </BarChart>
      </InsightChart>
      <InsightTable testId="insights-community-versus-table" caption="הממוצע האישי, ממוצע הקבוצה והסיכום החסכוני בקבוצה">
        <thead><tr><th scope="col">נתון</th><th scope="col">צריכה</th></tr></thead>
        <tbody>{versus.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td><ConsumptionValue kmPerLiter={row.canonical} units={units} /></td></tr>)}</tbody>
      </InsightTable>
    </InsightCard>
    {ownPriceKnown && comparison.yourAvgPrice !== null && comparison.peerAvgPrice !== null ? <InsightCard label="מחיר ממוצע לליטר · כל ההיסטוריה"
      title={Math.abs(comparison.yourAvgPrice - comparison.peerAvgPrice) < .005 ? "המחיר שלך קרוב לממוצע הקבוצה"
        : <>שילמת <NumRun>{price(Math.abs(comparison.yourAvgPrice - comparison.peerAvgPrice))}</NumRun> {comparison.yourAvgPrice < comparison.peerAvgPrice ? "פחות" : "יותר"} לליטר מממוצע הקבוצה</>}>
      <div className="insights-comparison-pair"><div><span>שלך</span><strong><PricePerLiter value={comparison.yourAvgPrice} /></strong></div>
        <div><span>הקבוצה</span><strong><PricePerLiter value={comparison.peerAvgPrice} /></strong></div></div>
    </InsightCard> : null}
  </div>;
}

function PrivacyCard({ sharing }: { sharing: boolean }) {
  return <InsightCard label="מה משותף" title="סיכום אחד לכל רכב" testId="insights-community-privacy">
    <p className="insights-note">משויך למזהי החשבון והרכב</p>
    <div className="insights-basis"><span>ההשוואה משתמשת בכל ההיסטוריה</span><InfoTip label="מה כולל סיכום ההשוואה">
      <span><b>משותף:</b> דגם, שנת הרכב, סוג דלק, ממוצע צריכה, מספר המקטעים, מחיר ממוצע ששולם וזמן עדכון הסיכום. מזהי החשבון והרכב משויכים לסיכום.</span>
      <span><b>לא משותף:</b> שם, מייל, מספר רישוי, קילומטראז׳, תאריכי תדלוקים, תחנות, מיקום או הערות.</span>
      <span>הסיכום אינו אנונימי: אפשר לקשר בין עדכוניו באמצעות מזהי החשבון והרכב.</span>
      <span>כל רכב תורם סיכום משלו. מספר הסיכומים אינו בהכרח מספר הנהגים, והשנתון אינו תנאי חובה להתאמת הקבוצה.</span>
      <span>בחירת תקופה בתובנות אינה משנה את הסיכום ששותף או את קבוצת ההשוואה.</span>
    </InfoTip></div>
    <Link className="insights-text-action" to="/account"><NumericText>{sharing ? "אפשר לכבות את ההשתתפות בחשבון" : "אפשר לשנות את ההשתתפות בחשבון"}</NumericText> ←</Link>
  </InsightCard>;
}
