import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Skeleton } from "../components/Card";
import { NumericText, NumRun } from "../components/Fmt";
import { PeriodPicker } from "../components/PeriodPicker";
import { Sheet } from "../components/Sheet";
import { CheckIcon, ChevronDown } from "../components/icons";
import { SegmentSheet } from "../components/home/SegmentSheet";
import { CommunityInsights } from "../components/insights/CommunityInsights";
import { ConsumptionInsights } from "../components/insights/ConsumptionInsights";
import { PriceInsights } from "../components/insights/PriceInsights";
import { SpendingInsights } from "../components/insights/SpendingInsights";
import { INSIGHT_PERIODS, INSIGHT_TABS, consumptionSummary, insightRange, insightTab, knownFillCost, priceSummary, type InsightTab } from "../components/insights/presentation";
import { useData } from "../context/DataContext";
import { useVehicleData } from "../context/VehicleDataContext";
import { useBenchmark } from "../hooks/useBenchmark";
import { int, monthYear, vehicleLabel, vehicleShort } from "../lib/format";
import { inRange, rangeDates } from "../lib/periods";
import { computeStats } from "../lib/stats";
import "../insights-design.css";

/** Scope changes discard local selections before another account or vehicle renders. */
export function Statistics() {
  const vehicle = useVehicleData();
  return <InsightsSession key={vehicle.scope} />;
}

function InsightsSession() {
  const data = useData();
  const vehicle = useVehicleData();
  const [params, setParams] = useSearchParams();
  const [vehicleSheetOpen, setVehicleSheetOpen] = useState(false);
  const [selectedSegment, setSelectedSegment] = useState<{ endId: string; returnFocus?: () => HTMLElement | null } | null>(null);
  const selectSegment = useCallback((endId: string, returnFocus?: () => HTMLElement | null) => {
    setSelectedSegment({ endId, returnFocus });
  }, []);
  const section = insightTab(params.get("tab"));
  const selected = useMemo(() => insightRange(params, vehicle.now), [params, vehicle.now]);

  // One canonical engine invocation on COMPLETE history. Periods only select its output.
  const stats = useMemo(() => computeStats(data.fillups, data.activeVehicle, data.prices, vehicle.now),
    [data.fillups, data.activeVehicle, data.prices, vehicle.now]);
  const consumption = useMemo(() => consumptionSummary(stats, selected.range), [stats, selected.range]);
  const prices = useMemo(() => priceSummary(stats, data.activeVehicle, data.prices, selected.range),
    [stats, data.activeVehicle, data.prices, selected.range]);
  const unavailableFillups = !!data.fillupsError || data.malformedFillups.length > 0;
  const unresolvedFillups = data.outbox.some(operation => operation.vehicleId === vehicle.vehicleId && operation.path.includes("/fillups/"));
  const historyReady = !data.loadingFillups && !data.fillupsFromCache && !unavailableFillups && !unresolvedFillups;
  const historyLabel = data.loadingFillups ? "טוענים את היסטוריית התדלוקים"
    : unavailableFillups ? "חלק מהתדלוקים אינם זמינים לקריאה"
      : data.fillupsFromCache ? "נתוני התדלוקים עוד לא אומתו בענן"
        : unresolvedFillups ? "יש תדלוקים שממתינים לאישור או לבדיקה" : "";
  // The published benchmark and fetched cohort never receive a range-filtered Stats object.
  const { comparison, loading: loadingComparison } = useBenchmark(stats, historyReady);
  const selectedFillups = stats.fillups.filter(fill => inRange(fill.date, selected.range)).length;
  const periods = [...INSIGHT_PERIODS, ...(selected.month ? [{ value: "selected-month", label: monthYear(selected.month) }] : [])];
  const units = data.settings.units;
  const ownPriceKnown = historyReady && stats.fillups.length > 0 && stats.fillups.every(fill => knownFillCost(fill)
    && (fill.fuelType ?? data.activeVehicle?.fuelType) === data.activeVehicle?.fuelType);

  const selectTab = (tab: InsightTab) => {
    const next = new URLSearchParams(params); next.set("tab", tab); setParams(next, { replace: true });
  };
  const selectPeriod = (period: string) => {
    if (!INSIGHT_PERIODS.some(option => option.value === period)) return;
    const next = new URLSearchParams(params); next.set("period", period); next.delete("month"); setParams(next, { replace: true });
  };

  return <main className="insights-page pb-[112px] pt-safe" data-testid="insights-page">
    <div className="insights-shell">
      <header className="insights-heading"><h1>תובנות</h1>
        <PeriodPicker value={selected.value} options={periods} onChange={selectPeriod} label="תקופת התובנות" />
      </header>
      {data.activeVehicles.length > 1 ? <button type="button" className="insights-vehicle" aria-label="בחירת רכב לתובנות" onClick={event => { event.currentTarget.focus(); setVehicleSheetOpen(true); }}>
        <NumericText>{vehicleShort(data.activeVehicle)}</NumericText><ChevronDown size={16} />
      </button> : null}
      <nav className="insights-tabs" aria-label="מדורי תובנות">{INSIGHT_TABS.map(tab =>
        <button type="button" key={tab.value} aria-pressed={section === tab.value} data-testid={`insights-tab-${tab.value}`}
          onClick={() => selectTab(tab.value)}>{tab.label}</button>)}</nav>
      <div className="insights-period-summary" data-testid="insights-period-summary">
        {section === "community" ? <span>ההשוואה מבוססת על כל ההיסטוריה</span> : <>
          <span><NumRun>{int(selectedFillups)}</NumRun> תדלוקים · <NumRun>{int(consumption.segments.length)}</NumRun> מקטעים</span>
          <span><NumericText>{rangeDates(selected.range).replace("מהתדלוק הראשון", "מהרשומה הראשונה")}</NumericText></span>
        </>}
      </div>
      {!historyReady && section !== "community" ? <p className="insights-source-status" data-testid="insights-source-status" role="status">{historyLabel} · מוצגים הנתונים הזמינים</p> : null}
      {data.loadingFillups && (section === "cons" || section === "price") ? <div className="insights-stack" aria-label="טוענים תובנות" role="status">
        <Skeleton className="h-[280px] rounded-[20px]" /><Skeleton className="h-[180px] rounded-[20px]" />
      </div> : <>
        {section === "cons" ? <ConsumptionInsights stats={stats} summary={consumption} vehicle={data.activeVehicle} units={units}
          range={selected.range} historyReady={historyReady} onSelect={selectSegment} /> : null}
        {section === "price" ? <PriceInsights summary={prices} vehicle={data.activeVehicle} range={selected.range} historyReady={historyReady} /> : null}
        {section === "spend" ? <SpendingInsights stats={stats} consumption={consumption} range={selected.range} from={selected.fromDay} to={selected.toDay} historyReady={historyReady} /> : null}
        {section === "community" ? <CommunityInsights comparison={comparison} loading={loadingComparison} units={units}
          sharing={data.settings.shareBenchmarks !== false} hasOwnFigure={stats.segments.length >= 2 && stats.avgKmPerLiter !== null} ownPriceKnown={ownPriceKnown}
          historyReady={historyReady} historyLoading={data.loadingFillups} historyLabel={historyLabel} /> : null}
      </>}
    </div>
    {selectedSegment ? <SegmentSheet endId={selectedSegment.endId} stats={stats} units={units}
      returnFocus={selectedSegment.returnFocus} onClose={() => setSelectedSegment(null)} /> : null}
    <Sheet open={vehicleSheetOpen} onClose={() => setVehicleSheetOpen(false)} title={<h2>בחירת רכב</h2>}>
      <div className="insights-vehicle-choices">{data.activeVehicles.map(item => <button type="button" key={item.id}
        aria-pressed={item.id === data.activeVehicle?.id} onClick={() => { void data.setActiveVehicle(item.id); setVehicleSheetOpen(false); }}>
        <NumericText>{vehicleLabel(item)}</NumericText>{item.id === data.activeVehicle?.id ? <CheckIcon size={20} /> : null}
      </button>)}</div>
    </Sheet>
  </main>;
}
