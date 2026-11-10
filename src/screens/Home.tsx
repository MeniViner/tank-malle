import { useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useVehicleData } from "../context/VehicleDataContext";
import { useStats } from "../hooks/useStats";
import { useTankEstimate, type TankEstimateHandle } from "../hooks/useTankEstimate";
import { useVehicleEnrichment } from "../hooks/useVehicleEnrichment";
import { useSpotlight } from "../hooks/useSpotlight";
import { useTco } from "../hooks/useTco";
import { dayMonthShort, int, vehicleLabel } from "../lib/format";
import type { SpotlightItem } from "../lib/home/spotlight";
import type { Stats } from "../lib/stats";
import type { LedgerRow } from "../lib/vehicle/derived";
import { AppHeader } from "../components/AppHeader";
import { Button } from "../components/Button";
import { Skeleton } from "../components/Card";
import { ConsumptionSparkline } from "../components/ConsumptionSparkline";
import { ConsumptionValue, Distance, Money, NumericText, NumRun } from "../components/Fmt";
import { InfoIcon, PumpIcon } from "../components/icons";
import { JournalEntryRow } from "../components/JournalEntryRow";
import { serviceMileageWarning } from "../lib/journal/presentation";
import { HomeSpotlight } from "../components/home/HomeSpotlight";
import { ConsumptionComparison } from "../components/home/ConsumptionComparison";
import { ConsumptionDetails } from "../components/home/ConsumptionDetails";
import { HomeFuelPrice } from "../components/home/HomeFuelPrice";
import { SegmentSheet } from "../components/home/SegmentSheet";
import { TankHero, type TankSheetEntry } from "../components/tank/TankHero";
import { TankSheets } from "../components/tank/TankSheets";
import { TcoBlock } from "../components/TcoBlock";
import "../home-design.css";

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
  const spotlight = useSpotlight(stats);
  const body = useRef<HTMLDivElement>(null);
  const consumptionId = useId();
  const [tankEntry, setTankEntry] = useState<TankSheetEntry | null>(null);
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [measurementOpen, setMeasurementOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const units = data.settings.units;
  const active = data.activeVehicle;
  const loading = data.loadingFillups || data.observationsStatus === "loading";
  const hasFillups = data.fillups.length > 0;
  const incompleteHistory = !!data.fillupsError || data.malformedFillups.length > 0;
  const recent = vehicle.ledger.filter(row => row.day <= vehicle.today).slice(0, 3);
  const kmPerDay = tank.estimate.mobility.kmPerDay;
  const tco = useTco(kmPerDay);
  const monthly = hasFillups ? tco.parts[0].value : null;
  const segmentValues = new Map(stats.segments.map(segment => [segment.endId, segment.kmPerLiter]));
  const flagged = new Set(stats.anomalies.map(anomaly => anomaly.fillupId));
  const pendingPaths = new Set(data.outbox.filter(operation => operation.status === "pending").map(operation => operation.path));
  const attentionPaths = new Set(data.outbox.filter(operation => operation.status === "failed" || operation.status === "conflict").map(operation => operation.path));

  function openItem(item: SpotlightItem) {
    if (item.target.kind === "segment") setSegmentId(item.target.endId);
    else if (item.target.kind === "price") setPriceOpen(true);
    else navigate(item.target.to);
  }
  function openEntry(row: LedgerRow) {
    const params = new URLSearchParams({ entry: row.key, owner: vehicle.uid, vehicle: vehicle.vehicleId });
    navigate(`/history?${params}`);
  }
  function focusContent() { body.current?.querySelector<HTMLElement>("button, a")?.focus({ preventScroll: true }); }

  return <div ref={body} className="home-body">
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
      {hasFillups || data.observations.length ? <TankHero estimate={tank.estimate} onOpen={setTankEntry} /> : null}
      {hasFillups ? <section className="home-consumption" data-testid="consumption-summary">
        <div className="home-consumption-heading">
          <span className="home-label">{stats.lastSegment ? "צריכה בתדלוק האחרון" : "צריכה"}</span>
          <button className="tm-icon-button" type="button" data-testid="consumption-details-open" aria-label="פרטי מדידת הצריכה"
            aria-haspopup="dialog" onClick={() => setMeasurementOpen(true)}><InfoIcon size={18} /></button>
        </div>
        {stats.lastSegment ? <>
          <button type="button" className="home-consumption-reading" onClick={() => setSegmentId(stats.lastSegment!.endId)}
            aria-labelledby={`${consumptionId}-action ${consumptionId}-value`} aria-describedby={`${consumptionId}-comparison`}>
            <span id={`${consumptionId}-action`} className="sr-only">פרטי המקטע האחרון</span>
            <span id={`${consumptionId}-value`}><ConsumptionValue kmPerLiter={stats.lastSegment.kmPerLiter} units={units} long className="home-consumption-value" unitClassName="home-consumption-unit" /></span>
            <span id={`${consumptionId}-comparison`}><ConsumptionComparison latest={stats.lastSegment.kmPerLiter} average={stats.avgKmPerLiter} units={units} /></span>
          </button>
          <ConsumptionSparkline segments={stats.segments} units={units} average={stats.avgKmPerLiter} onSelect={segment => setSegmentId(segment.endId)} />
        </> : <div className="home-empty home-consumption-empty" data-testid="home-open-segment">
          <h2>{stats.openSegment.hasBaseline ? "עוד תדלוק מלא אחד ונדע" : "מתחילים בתדלוק עד הסוף"}</h2>
          <div className="home-measurement-progress" aria-hidden="true"><span style={{ width: stats.openSegment.hasBaseline ? "50%" : "10%" }} /></div>
          <p>{stats.openSegment.hasBaseline ? "נקודת ההתחלה נשמרה. אחרי נסיעה ותדלוק נוסף עד הסוף נחשב את הצריכה."
            : "התדלוקים נשמרו. למדידת צריכה צריך שני תדלוקים עד הסוף."}</p>
        </div>}
      </section> : null}
      <TcoBlock tco={tco} />
      <div className="home-trio" data-testid="home-trio">
        <button type="button" className="home-trio-cell" data-testid="home-km-day" onClick={() => navigate("/vehicle")}>
          <span className="home-trio-label">נוסע ביום</span>
          {kmPerDay !== null && kmPerDay >= .5 ? <Distance value={kmPerDay} className="home-trio-value" unitClassName="home-trio-unit" /> : <NumRun block className="home-trio-value">—</NumRun>}
          <span className="home-trio-caption">{kmPerDay !== null && kmPerDay > 0 ? kmPerDay < .5 ? "פחות מקילומטר ביום" : <>כ־<NumRun>{int(kmPerDay * 30)}</NumRun> בחודש</> : "אחרי כמה רישומים"}</span>
        </button>
        <button type="button" className="home-trio-cell" data-testid="home-fuel-month" onClick={() => navigate("/stats?tab=spend")}>
          <span className="home-trio-label">דלק {dayMonthShort(vehicle.now).replace(/^\d+\s+/, '')}</span>
          {tco.fuelThisMonth !== null ? <Money block value={tco.fuelThisMonth} className="home-trio-value" /> : <NumRun block className="home-trio-value">—</NumRun>}
          <span className="home-trio-caption">{monthly === null ? "אין ממוצע מלא" : <>בד״כ <Money value={monthly} /></>}</span>
        </button>
        <HomeFuelPrice vehicle={active} now={vehicle.now} open={priceOpen} onOpen={() => setPriceOpen(true)} onClose={() => setPriceOpen(false)} />
      </div>
      {recent.length ? <section data-testid="recent-fillups-timeline" className="home-recent">
        <div className="home-recent-heading"><h2 className="home-group-title">לאחרונה</h2><Link className="home-text-action" to="/history">כל היומן</Link></div>
        {recent.map(row => <JournalEntryRow key={row.key} row={row} units={units} kmPerLiter={segmentValues.get(row.id)}
          pending={pendingPaths.has(`users/${vehicle.uid}/vehicles/${vehicle.vehicleId}/${row.collection}/${row.id}`)} flagged={row.kind === "fuel" ? flagged.has(row.id) : !!serviceMileageWarning(row, vehicle.mileage)}
          attention={attentionPaths.has(`users/${vehicle.uid}/vehicles/${vehicle.vehicleId}/${row.collection}/${row.id}`)}
          onOpen={() => openEntry(row)} />)}
      </section> : null}
      <TankSheets handle={tank} entry={tankEntry} enriching={enriching} onClose={() => setTankEntry(null)} />
      {segmentId ? <SegmentSheet endId={segmentId} stats={stats} units={units} onClose={() => setSegmentId(null)} /> : null}
      {measurementOpen ? <ConsumptionDetails stats={stats} units={units} incomplete={incompleteHistory} onClose={() => setMeasurementOpen(false)} /> : null}
    </>}
  </div>;
}

function HomeSkeleton() {
  return <div className="home-skeleton"><Skeleton className="h-[228px] rounded-lg" /><Skeleton className="h-[310px] rounded-lg" /><Skeleton className="h-[100px] rounded-md" /></div>;
}
