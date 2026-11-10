import { useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useVehicleData } from "../context/VehicleDataContext";
import { useStats } from "../hooks/useStats";
import { useTankEstimate, type TankEstimateHandle } from "../hooks/useTankEstimate";
import { useVehicleEnrichment } from "../hooks/useVehicleEnrichment";
import { useSpotlight } from "../hooks/useSpotlight";
import { useTco } from "../hooks/useTco";
import { dayMonthShort, heMonthName, int, num, shekel, vehicleLabel } from "../lib/format";
import { energyPer100Km, fuelMonthFact, homeStatus, type HomeStatus } from "../lib/home/facts";
import type { SpotlightItem } from "../lib/home/spotlight";
import type { Stats } from "../lib/stats";
import { displayTankLevel } from "../lib/tank/display";
import type { PassageResult } from "../lib/tank/types";
import type { LedgerRow } from "../lib/vehicle/derived";
import { isEv } from "../lib/vehicle/v3Fields";
import { AppHeader } from "../components/AppHeader";
import { Button } from "../components/Button";
import { Skeleton } from "../components/Card";
import { ConsumptionSparkline } from "../components/ConsumptionSparkline";
import { Fact, FactsStrip } from "../components/FactsStrip";
import { ConsumptionValue, Money, NumericText, NumRun, Percent } from "../components/Fmt";
import { InfoIcon, PumpIcon } from "../components/icons";
import { JournalEntryRow } from "../components/JournalEntryRow";
import { serviceMileageWarning } from "../lib/journal/presentation";
import { HomeSpotlight } from "../components/home/HomeSpotlight";
import { ConsumptionComparison } from "../components/home/ConsumptionComparison";
import { MeasurementSheet } from "../components/tank/MeasurementSheet";
import { HomeFuelPrice } from "../components/home/HomeFuelPrice";
import { SegmentSheet } from "../components/home/SegmentSheet";
import { TankHero, type TankSheetEntry } from "../components/tank/TankHero";
import { TankSheets } from "../components/tank/TankSheets";
import { TcoBlock } from "../components/TcoBlock";
import "../home-design.css";

/** Design v3 §2.8: Home shows the two newest records, the Journal has the rest. */
const HOME_RECENT_ROWS = 2;

/** One model/enrichment lifetime, including a vehicle with no fill-ups yet. */
export function Home() {
  const data = useData(), vehicle = useVehicleData();
  const stats = useStats();
  const tank = useTankEstimate();
  const enriching = useVehicleEnrichment();
  return <main className="home-page pt-safe" data-testid="home-page">
    <h1 className="sr-only">מצב הרכב</h1>
    <AppHeader />
    <HomeBody key={`${vehicle.uid}/${data.activeVehicle?.id ?? "none"}`} stats={stats} tank={tank} enriching={enriching} />
  </main>;
}

function HomeBody({ stats, tank, enriching }: { stats: Stats; tank: TankEstimateHandle; enriching: boolean }) {
  const data = useData(), vehicle = useVehicleData(), navigate = useNavigate();
  const spotlight = useSpotlight(stats, tank.estimate);
  const body = useRef<HTMLDivElement>(null);
  const consumptionId = useId();
  const [tankEntry, setTankEntry] = useState<TankSheetEntry | null>(null);
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [measurementOpen, setMeasurementOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const units = data.settings.units;
  const active = data.activeVehicle;
  const ev = isEv(active);
  const loading = data.loadingFillups || data.observationsStatus === "loading";
  const hasFillups = data.fillups.length > 0;
  const incompleteHistory = !!data.fillupsError || data.malformedFillups.length > 0;
  const recent = vehicle.ledger.filter(row => row.day <= vehicle.today).slice(0, HOME_RECENT_ROWS);
  const kmPerDay = tank.estimate.mobility.kmPerDay;
  const tco = useTco(kmPerDay);
  const monthly = hasFillups ? tco.parts[0].value : null;
  const fuelMonth = fuelMonthFact(vehicle.ledger, vehicle.today, vehicle.incomplete);
  const segmentValues = new Map(stats.segments.map(segment => [segment.endId, segment.kmPerLiter]));
  const flagged = new Set(stats.anomalies.map(anomaly => anomaly.fillupId));
  const pendingPaths = new Set(data.outbox.filter(operation => operation.status === "pending").map(operation => operation.path));
  const attentionPaths = new Set(data.outbox.filter(operation => operation.status === "failed" || operation.status === "conflict").map(operation => operation.path));
  const level = tank.estimate.available ? displayTankLevel(tank.estimate) : null;
  const status = homeStatus({ hasFillups, level, low: level !== null && level <= tank.estimate.reserveLevel,
    spotlightCount: spotlight.items.length, docs: active?.docs, today: vehicle.today });

  function openItem(item: SpotlightItem) {
    if (item.target.kind === "segment") setSegmentId(item.target.endId);
    else if (item.target.kind === "price") setPriceOpen(true);
    else if (item.target.kind === "tank") setTankEntry(level === null ? "gauge" : "summary");
    else navigate(item.target.to);
  }
  function openEntry(row: LedgerRow) {
    const params = new URLSearchParams({ entry: row.key, owner: vehicle.uid, vehicle: vehicle.vehicleId });
    navigate(`/history?${params}`);
  }
  function focusContent() { body.current?.querySelector<HTMLElement>("button, a")?.focus({ preventScroll: true }); }

  const monthName = fuelMonth.month?.longLabel ?? heMonthName(Number(vehicle.today.slice(5, 7)));
  const energy100 = ev ? energyPer100Km(tco, kmPerDay) : null;

  return <div ref={body} className="home-body">
    {active && !loading && status ? <HomeStatusLine status={status} passage={tank.estimate.expectedRefuel} /> : null}
    <HomeSpotlight items={spotlight.items} onOpen={openItem} onDismiss={spotlight.dismiss} onEmpty={focusContent} />
    {!active ? <section className="home-empty" data-testid="home-no-active">
      <h2>בוחרים רכב וממשיכים</h2><p>אפשר לשחזר רכב מהארכיון או להוסיף רכב.</p>
      <Button onClick={() => navigate("/vehicle")}>לרכב שלי</Button>
    </section> : loading ? <HomeSkeleton /> : <>
      {incompleteHistory ? <p className="home-history-status" role="status" data-testid="home-history-incomplete">חלק מהיסטוריית התדלוקים אינו זמין.</p> : null}
      {!hasFillups && !incompleteHistory ? <section className="home-empty" data-testid="home-first-fillup">
        <span className="home-label"><NumericText>{vehicleLabel(active)}</NumericText></span>
        <h2>מתחילים מהתדלוק הבא</h2>
        <p>שני תדלוקים עד הסוף ייתנו נקודת התחלה למדידת הצריכה.</p>
        <Button full data-testid="first-fillup" onClick={() => navigate("/fillup/new")}><PumpIcon size={22} />רישום התדלוק הראשון</Button>
        {tank.estimate.available ? <button type="button" className="home-text-action" onClick={() => setTankEntry("gauge")}>עדכון המחוון</button> : null}
      </section> : null}
      <FactsStrip label="הרכב במספרים" testId="home-facts">
        <Fact testId="home-km-day" label="נוסע ביום" onClick={() => navigate("/vehicle")}
          sub={kmPerDay !== null && kmPerDay > 0 ? kmPerDay < .5 ? "פחות מקילומטר ביום" : <>כ־<NumRun>{int(kmPerDay * 30)}</NumRun> ק״מ בחודש</> : "אחרי כמה רישומים"}
          value={kmPerDay !== null && kmPerDay >= .5 ? int(kmPerDay) : null} unit="ק״מ" />
        <Fact testId="home-fuel-month" label={`${ev ? "חשמל" : "דלק"} ב${monthName}`} onClick={() => navigate("/stats?tab=spend")}
          sub={monthly === null ? "אין ממוצע מלא" : <>בד״כ <Money value={monthly} /> בחודש</>}
          value={fuelMonth.value === null ? null : shekel(fuelMonth.value)} />
        {ev ? <Fact testId="home-energy-100" label="חשמל ל-100 ק״מ" onClick={() => navigate("/stats?tab=price")}
          sub={energy100 === null ? "אחרי כמה טעינות ונסיעות" : "לפי העלות והנסיעות שלך"}
          value={energy100 === null ? null : shekel(energy100)} />
          : <HomeFuelPrice vehicle={active} now={vehicle.now} open={priceOpen} onOpen={() => setPriceOpen(true)} onClose={() => setPriceOpen(false)} />}
      </FactsStrip>
      <TcoBlock tco={tco} />
      {hasFillups ? <section className="home-consumption" data-testid="consumption-summary">
        <div className="home-consumption-heading">
          <span className="home-label">{stats.lastSegment ? "צריכה בתדלוק האחרון" : "צריכה"}</span>
          <button className="tm-icon-button home-info-button" type="button" data-testid="consumption-details-open" aria-label="פרטי מדידת הצריכה"
            aria-haspopup="dialog" onClick={() => setMeasurementOpen(true)}><InfoIcon size={16} /></button>
        </div>
        {stats.lastSegment ? <>
          <button type="button" className="home-consumption-reading" onClick={() => setSegmentId(stats.lastSegment!.endId)}
            aria-labelledby={`${consumptionId}-action ${consumptionId}-value`} aria-describedby={`${consumptionId}-comparison`}>
            <span id={`${consumptionId}-action`} className="sr-only">פרטי המקטע האחרון</span>
            <span id={`${consumptionId}-value`}><ConsumptionValue kmPerLiter={stats.lastSegment.kmPerLiter} units={units} long className="home-consumption-value" unitClassName="home-consumption-unit" /></span>
            <span id={`${consumptionId}-comparison`}><ConsumptionComparison latest={stats.lastSegment.kmPerLiter} average={stats.avgKmPerLiter} units={units} /></span>
          </button>
          <ConsumptionSparkline variant="home" segments={stats.segments} units={units} average={stats.avgKmPerLiter} onSelect={segment => setSegmentId(segment.endId)} />
        </> : <div className="home-empty home-consumption-empty" data-testid="home-open-segment">
          <h2>{stats.openSegment.hasBaseline ? "עוד תדלוק מלא אחד ונדע" : "מתחילים בתדלוק עד הסוף"}</h2>
          <div className="home-measurement-progress" aria-hidden="true"><span style={{ width: stats.openSegment.hasBaseline ? "50%" : "10%" }} /></div>
          <p>{stats.openSegment.hasBaseline ? "נקודת ההתחלה נשמרה. אחרי נסיעה ותדלוק נוסף עד הסוף נחשב את הצריכה."
            : "התדלוקים נשמרו. למדידת צריכה צריך שני תדלוקים עד הסוף."}</p>
        </div>}
      </section> : null}
      {hasFillups || data.observations.length ? <TankHero estimate={tank.estimate} onOpen={setTankEntry} /> : null}
      {recent.length ? <section data-testid="recent-fillups-timeline" className="home-recent">
        <div className="home-recent-heading"><h2 className="home-label">לאחרונה</h2><Link className="home-text-action home-journal-link" to="/history">היומן המלא ›</Link></div>
        {recent.map(row => <JournalEntryRow key={row.key} row={row} units={units} kmPerLiter={segmentValues.get(row.id)}
          pending={pendingPaths.has(`users/${vehicle.uid}/vehicles/${vehicle.vehicleId}/${row.collection}/${row.id}`)} flagged={row.kind === "fuel" ? flagged.has(row.id) : !!serviceMileageWarning(row, vehicle.mileage)}
          attention={attentionPaths.has(`users/${vehicle.uid}/vehicles/${vehicle.vehicleId}/${row.collection}/${row.id}`)}
          onOpen={() => openEntry(row)} />)}
      </section> : null}
      <TankSheets handle={tank} entry={tankEntry} enriching={enriching} onClose={() => setTankEntry(null)} />
      {segmentId ? <SegmentSheet endId={segmentId} stats={stats} units={units} onClose={() => setSegmentId(null)} /> : null}
      {measurementOpen ? <MeasurementSheet stats={stats} units={units} incomplete={incompleteHistory} onClose={() => setMeasurementOpen(false)} /> : null}
    </>}
  </div>;
}

/** "תדלוק בעוד 5 ימים", from the engine's expected passage only; null when there is no dated forecast. */
function refuelWhen(passage: PassageResult) {
  if (passage.status === "reached") return <>תדלוק היום</>;
  if (passage.status !== "withinHorizon" || passage.days === null) return null;
  if (passage.days < .6) return <>תדלוק היום</>;
  if (passage.days < 1.6) return <>תדלוק מחר</>;
  return <>תדלוק בעוד <NumRun>{num(Math.max(0, Math.round(passage.days)), 0)}</NumRun> ימים</>;
}

/** v3 §2.2: one 15px line under the header that says only what the cards below don't. */
function HomeStatusLine({ status, passage }: { status: HomeStatus; passage: PassageResult }) {
  let text;
  if (status.kind === "low") text = <>הדלק נמוך · כדאי לתדלק היום</>;
  else if (status.kind === "refuel") {
    const when = refuelWhen(passage);
    text = <>{when}{when ? " · " : null}במיכל כ־<Percent value={status.level * 100} /></>;
  } else text = <>הכל תקין{status.testDue ? <> · הטסט בתוקף עד <NumericText>{dayMonthShort(new Date(`${status.testDue}T12:00:00`))}</NumericText></> : null}</>;
  return <p className="home-status" data-testid="home-status" data-status={status.kind}>{text}</p>;
}

function HomeSkeleton() {
  return <div className="home-skeleton"><Skeleton className="h-[228px] rounded-lg" /><Skeleton className="h-[310px] rounded-lg" /><Skeleton className="h-[100px] rounded-md" /></div>;
}
