import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useData } from "../context/DataContext";
import { useBenchmark } from "../hooks/useBenchmark";
import { computeStats, filterSegmentsByRange } from "../lib/stats";
import {
  GROUPING_LABELS,
  RANGE_COMPACT,
  bucketSpend,
  buildRange,
  inRange,
  resolveGrouping,
  summariseSpend,
  type DateRange,
  type Grouping,
  type RangeKey,
} from "../lib/periods";
import {
  MIN_PEERS,
  hasComparison,
  type BenchmarkComparison,
  type InsufficientPeers,
} from "../lib/benchmarks";
import { ConsumptionValue, Distance, Quantity, SignedPercent } from "../components/Fmt";
import { Card, Label, Skeleton } from "../components/Card";
import { Segmented } from "../components/Segmented";
import { Sheet } from "../components/Sheet";
import { Num } from "../components/Num";
import { CheckIcon, ChartIcon, ChevronDown, UserIcon } from "../components/icons";
import { InfoTip } from "../components/InfoTip";
import {
  FUEL_TYPE_SHORT,
  dayMonthShort,
  monthYear,
  num,
  price,
  shekel,
  vehicleLabel,
  vehicleShort,
} from "../lib/format";

/* ------------------------------------------------------------------ *
 * Information architecture
 *
 * The old screen had one control — 3ח׳ / 6ח׳ / שנה / הכול — that silently did
 * two different jobs: it chose WHICH RECORDS were in scope and it chose HOW
 * THEY WERE GROUPED, and no label said which numbers it had changed. Those are
 * separated here into a range, a grouping, and named sections; every heading
 * states the range it is showing.
 * ------------------------------------------------------------------ */

type Section = "overview" | "costs" | "consumption" | "prices" | "community";

const SECTIONS: { value: Section; label: string }[] = [
  { value: "overview", label: "סקירה" },
  { value: "costs", label: "הוצאות" },
  { value: "consumption", label: "צריכה" },
  { value: "prices", label: "מחירים" },
  { value: "community", label: "קהילה" },
];

/** Every range the picker offers, in the order it lists them. */
const RANGE_OPTIONS: Exclude<RangeKey, "custom">[] = [
  "thisMonth",
  "3m",
  "6m",
  "ytd",
  "1y",
  "all",
];

const GROUPINGS: { value: Grouping; label: string }[] = [
  { value: "auto", label: GROUPING_LABELS.auto },
  { value: "week", label: GROUPING_LABELS.week },
  { value: "month", label: GROUPING_LABELS.month },
  { value: "year", label: GROUPING_LABELS.year },
];

/**
 * Statistics (designs 17 / 23).
 *
 * The engine runs on the COMPLETE history and the range is applied afterwards,
 * per metric. Filtering the fill-ups first — what this screen used to do —
 * destroys any consumption segment whose opening full tank happens to fall
 * outside the window, so shortening the range could silently delete a valid
 * measurement rather than just hiding it.
 */
export function Statistics() {
  const {
    fillups,
    activeVehicle,
    activeVehicles,
    setActiveVehicle,
    prices,
    settings,
    loadingFillups,
  } = useData();
  const [section, setSection] = useState<Section>("overview");
  const [rangeKey, setRangeKey] = useState<RangeKey>("6m");
  const [grouping, setGrouping] = useState<Grouping>("auto");
  const [vehicleSheetOpen, setVehicleSheetOpen] = useState(false);

  const now = Date.now();
  const range = useMemo(() => buildRange(rangeKey, now), [rangeKey, now]);

  // Canonical, whole-history statistics. Never range-filtered.
  const stats = useMemo(
    () => computeStats(fillups, activeVehicle, prices),
    [fillups, activeVehicle, prices],
  );

  // Segments are built on everything, then clipped by their CLOSING date.
  const segments = useMemo(
    () => filterSegmentsByRange(stats.segments, range.from, range.to),
    [stats.segments, range],
  );

  const units = settings.units;
  const { comparison, loading: loadingComparison } = useBenchmark(stats);

  const spend = useMemo(() => summariseSpend(fillups, range, now), [fillups, range, now]);
  const resolvedGrouping = useMemo(
    () => resolveGrouping(grouping, range, fillups),
    [grouping, range, fillups],
  );
  const spendBuckets = useMemo(
    () => bucketSpend(fillups, range, resolvedGrouping),
    [fillups, range, resolvedGrouping],
  );

  /* Consumption in the range, distance-weighted like everywhere else. */
  const rangeKm = segments.reduce((sum, s) => sum + s.km, 0);
  const rangeLiters = segments.reduce((sum, s) => sum + s.liters, 0);
  const rangeCost = segments.reduce((sum, s) => sum + s.cost, 0);
  const rangeKmPerLiter = rangeLiters > 0 ? rangeKm / rangeLiters : null;
  const rangeCostPerKm = rangeKm > 0 ? rangeCost / rangeKm : null;

  // Every plotted value, the average line, the axis and the tooltip are
  // converted together. Relabelling the title while leaving km/L values in
  // place is the bug this single conversion point exists to prevent.
  const toUnit = (kmPerLiter: number) =>
    units === "litersPer100"
      ? Math.round((100 / kmPerLiter) * 100) / 100
      : Math.round(kmPerLiter * 100) / 100;

  const unitLabel = units === "litersPer100" ? "ל׳/100 ק״מ" : "קמ״ל";

  const consumptionData = useMemo(
    () =>
      segments.map((segment) => ({
        label: dayMonthShort(segment.endDate),
        value: toUnit(segment.kmPerLiter),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segments, units],
  );

  const averageLine = rangeKmPerLiter !== null ? toUnit(rangeKmPerLiter) : null;

  const priceData = useMemo(
    () =>
      stats.priceSeries
        .filter((point) => inRange(point.date, range))
        .map((point) => ({
          label: point.label,
          paid: point.paid,
          official: point.official,
        })),
    [stats.priceSeries, range],
  );

  const odometerData = useMemo(
    () =>
      stats.odometerSeries
        .filter((point) => inRange(point.date, range))
        .map((point, index, all) => ({
          label: point.label,
          // A declared break must show as a gap, not as a line drawn across
          // history the user told us is missing.
          odometer: point.gapBefore && index > 0 ? null : point.odometer,
          realOdometer: point.odometer,
          gap: point.gapBefore && index > 0,
          _all: all.length,
        })),
    [stats.odometerSeries, range],
  );

  const spendData = spendBuckets.map((bucket) => ({
    label: bucket.label,
    cost: bucket.cost,
  }));

  const empty = !loadingFillups && stats.fillups.length === 0;

  return (
    <main className="flex flex-1 flex-col pb-[104px] pt-safe">
      <header className="flex flex-none items-center justify-between gap-2 px-5 pb-3 pt-4">
        <h1 className="text-[22px] font-bold text-ink">סטטיסטיקות</h1>
        {/* A loose vehicle name floating in the header said nothing and had no
            affordance. With one vehicle it is redundant; with several it needs
            to be a control, so that is what it is. */}
        {activeVehicles.length > 1 ? (
          <button
            type="button"
            onClick={() => setVehicleSheetOpen(true)}
            className="flex min-h-[32px] max-w-[52%] items-center gap-1 rounded-pill bg-surface-2 px-3 text-[12.5px] font-semibold text-ink"
          >
            <span className="truncate">{vehicleShort(activeVehicle)}</span>
            <ChevronDown size={14} className="flex-none text-muted" />
          </button>
        ) : null}
      </header>

      {/* Section navigation. Five equal columns that fit 360px without
          scrolling — the old rail clipped its last tab off the edge. */}
      <nav
        aria-label="מדורי סטטיסטיקה"
        className="grid flex-none grid-cols-5 gap-1 px-5 pb-3"
      >
        {SECTIONS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            aria-current={section === entry.value ? "page" : undefined}
            onClick={() => setSection(entry.value)}
            className={`min-h-[34px] rounded-pill px-1 text-[12.5px] font-semibold transition-[background-color,color] duration-200 ${
              section === entry.value
                ? "bg-accent text-accent-contrast"
                : "bg-surface-2 text-muted"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="flex flex-col gap-3 px-5">
        {/* One range control, not six pills on two lines. Grouping stays with
            the charts that actually bucket. */}
        {section !== "community" ? (
          <RangePicker value={rangeKey} onChange={setRangeKey} />
        ) : null}

        {loadingFillups ? (
          <>
            <Skeleton className="h-[188px] rounded-card" />
            <Skeleton className="h-[188px] rounded-card" />
          </>
        ) : empty ? (
          <Card className="flex flex-col items-center gap-3 px-7 py-12 text-center">
            <span className="flex size-[64px] items-center justify-center rounded-[22px] bg-accent-soft text-accent">
              <ChartIcon size={30} />
            </span>
            <span className="text-[17px] font-bold text-ink">אין עדיין מספיק נתונים</span>
            <span className="max-w-[260px] text-[13.5px] leading-relaxed text-muted">
              אחרי שני תדלוקים שבסיומם המיכל היה מלא נתחיל להציג מגמות, עלויות והשוואות.
            </span>
          </Card>
        ) : (
          <>
            {section === "overview" ? (
              <>
                <div className="tm-rise flex gap-3">
                  <SummaryCard
                    label="צריכה אחרונה"
                    value={
                      segments.length > 0
                        ? String(toUnit(segments[segments.length - 1].kmPerLiter))
                        : "—"
                    }
                    unit={unitLabel}
                    accent
                  />
                  <SummaryCard
                    label="ממוצע צריכה"
                    value={averageLine !== null ? String(averageLine) : "—"}
                    unit={unitLabel}
                  />
                </div>

                <div className="tm-rise flex gap-3" style={{ animationDelay: "70ms" }}>
                  <SummaryCard
                    label="מרחק במעקב"
                    value={num(rangeKm, 0)}
                    unit="ק״מ"
                  />
                  <SummaryCard
                    label="עלות לק״מ"
                    value={rangeCostPerKm !== null ? shekel(rangeCostPerKm, 2) : "—"}
                  />
                </div>

                <div className="tm-rise flex gap-3" style={{ animationDelay: "140ms" }}>
                  {/* The label names the period; the ₪ sign already says it is
                      money spent. "הוצאה · 6 החודשים האחרונים" wrapped to three
                      lines and read like a broken sentence. */}
                  <SummaryCard label={range.compactLabel} value={shekel(spend.total)} />
                  <SummaryCard
                    label="ממוצע חודשי"
                    value={spend.perMonth !== null ? shekel(spend.perMonth) : "—"}
                  />
                </div>

                <BasisNote
                  segments={segments.length}
                  fillups={spend.fillups}
                  range={range}
                  breaks={stats.breakCount}
                />

                <OpenSegmentCard stats={stats} />
              </>
            ) : null}

            {section === "costs" ? (
              <>
                <div className="flex gap-3">
                  <SummaryCard label={range.compactLabel} value={shekel(spend.total)} />
                  <SummaryCard
                    label="ליטרים"
                    value={num(spend.liters, 1)}
                    unit="ל׳"
                  />
                </div>
                <div className="flex gap-3">
                  <SummaryCard
                    label="ממוצע שבועי"
                    value={spend.perWeek !== null ? shekel(spend.perWeek) : "—"}
                  />
                  <SummaryCard
                    label="ממוצע חודשי"
                    value={spend.perMonth !== null ? shekel(spend.perMonth) : "—"}
                  />
                </div>
                <div className="flex gap-3">
                  <SummaryCard label="מתחילת השנה" value={shekel(spend.yearToDate)} />
                  <SummaryCard
                    label="עלות לק״מ"
                    value={rangeCostPerKm !== null ? shekel(rangeCostPerKm, 2) : "—"}
                  />
                </div>

                <Segmented
                  value={grouping}
                  options={GROUPINGS}
                  onChange={setGrouping}
                  ariaLabel="קיבוץ"
                />

                <ChartCard title={`הוצאה · ${GROUPING_LABELS[resolvedGrouping]}`}>
                  <BarChart data={spendData} margin={CHART_MARGIN}>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis {...xAxis} />
                    <YAxis {...yAxis} width={44} />
                    <Tooltip content={<ChartTooltip currency />} />
                    <Bar
                      dataKey="cost"
                      fill="var(--accent)"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={34}
                    />
                  </BarChart>
                </ChartCard>

                <p className="px-1 text-[12px] leading-relaxed text-muted">
                  ההוצאה כוללת את כל התדלוקים בטווח — גם חלקיים וגם כאלה שאחרי התחלת
                  תקופה חדשה. אלה נתונים גולמיים, לא מדד צריכה.
                </p>
              </>
            ) : null}

            {section === "consumption" ? (
              <>
                <div className="flex gap-3">
                  <SummaryCard
                    label="ממוצע צריכה"
                    value={averageLine !== null ? String(averageLine) : "—"}
                    unit={unitLabel}
                    accent
                  />
                  <SummaryCard label="מקטעים סגורים" value={String(segments.length)} />
                </div>

                <ChartCard
                  title={`צריכה · ${unitLabel}`}
                  legend={
                    <>
                      <LegendDot color="var(--accent)" label="בפועל" />
                      {averageLine !== null ? (
                        <LegendDot
                          color="var(--muted)"
                          label={`ממוצע ${num(averageLine, 1)}`}
                          dashed
                        />
                      ) : null}
                    </>
                  }
                >
                  <LineChart data={consumptionData} margin={CHART_MARGIN}>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis {...xAxis} />
                    <YAxis {...yAxis} width={38} />
                    <Tooltip content={<ChartTooltip suffix={` ${unitLabel}`} />} />
                    {averageLine !== null ? (
                      <ReferenceLine
                        y={averageLine}
                        stroke="var(--muted)"
                        strokeDasharray="5 5"
                        strokeWidth={1.5}
                      />
                    ) : null}
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="var(--accent)"
                      strokeWidth={2.6}
                      dot={{ r: 3, fill: "var(--accent)", strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ChartCard>

                <OpenSegmentCard stats={stats} />

                {stats.vsDeclaredPercent !== null ? (
                  <Card className="flex items-center justify-between gap-3 p-4">
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[14.5px] font-semibold text-ink">
                        מול נתוני היצרן
                      </span>
                      <span className="text-[12.5px] text-muted">
                        מוצהר:{" "}
                        <ConsumptionValue
                          kmPerLiter={activeVehicle?.declaredKmPerLiter ?? null}
                          units={units}
                        />{" "}
                        · מבוסס על כל ההיסטוריה
                      </span>
                    </span>
                    <SignedPercent
                      value={stats.vsDeclaredPercent}
                      digits={1}
                      className={`rounded-pill px-3 py-1.5 text-[13px] font-bold ${
                        stats.vsDeclaredPercent >= 0
                          ? "bg-success-soft text-success-ink"
                          : "bg-danger-soft text-danger-ink"
                      }`}
                    />
                  </Card>
                ) : null}

                <ChartCard title="קילומטראז׳ מצטבר">
                  <AreaChart data={odometerData} margin={CHART_MARGIN}>
                    <defs>
                      <linearGradient id="odoFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis {...xAxis} />
                    <YAxis {...yAxis} width={52} domain={["auto", "auto"]} />
                    <Tooltip content={<ChartTooltip suffix=" ק״מ" />} />
                    <Area
                      type="monotone"
                      dataKey="odometer"
                      stroke="var(--accent)"
                      strokeWidth={2.4}
                      fill="url(#odoFill)"
                      connectNulls={false}
                    />
                  </AreaChart>
                </ChartCard>

                {stats.breakCount > 0 ? (
                  <p className="px-1 text-[12px] leading-relaxed text-muted">
                    בגרף יש {stats.breakCount === 1 ? "נקודת" : `${stats.breakCount} נקודות`}{" "}
                    התחלת תקופה חדשה. הקו נקטע שם בכוונה — לא מחושב שום נתון שחוצה תדלוקים
                    שלא תועדו.
                  </p>
                ) : null}
              </>
            ) : null}

            {section === "prices" ? (
              <>
                <div className="flex gap-3">
                  <SummaryCard
                    label="מחיר ממוצע ששולם"
                    value={stats.avgPricePaid !== null ? price(stats.avgPricePaid) : "—"}
                  />
                  <SummaryCard
                    label="סוג דלק"
                    value={FUEL_TYPE_SHORT[activeVehicle?.fuelType ?? "95"] ?? "—"}
                  />
                </div>

                <ChartCard
                  title="מחיר לליטר"
                  legend={
                    <>
                      <LegendDot color="var(--accent)" label="ששולם" />
                      {activeVehicle?.fuelType === "95" ? (
                        <LegendDot color="var(--muted)" label="מחיר מרבי מפוקח" dashed />
                      ) : null}
                    </>
                  }
                >
                  <LineChart data={priceData} margin={CHART_MARGIN}>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis {...xAxis} />
                    <YAxis {...yAxis} width={42} domain={["auto", "auto"]} />
                    <Tooltip content={<ChartTooltip currency />} />
                    {activeVehicle?.fuelType === "95" ? (
                      <Line
                        type="monotone"
                        dataKey="official"
                        stroke="var(--muted)"
                        strokeWidth={1.8}
                        strokeDasharray="5 5"
                        dot={false}
                      />
                    ) : null}
                    <Line
                      type="monotone"
                      dataKey="paid"
                      stroke="var(--accent)"
                      strokeWidth={2.6}
                      dot={{ r: 3, fill: "var(--accent)", strokeWidth: 0 }}
                    />
                  </LineChart>
                </ChartCard>

                {activeVehicle && activeVehicle.fuelType !== "95" ? (
                  <p className="px-1 text-[12px] leading-relaxed text-muted">
                    אין מחיר מרבי מפוקח ל
                    {FUEL_TYPE_SHORT[activeVehicle.fuelType]} בישראל, ולכן מוצג רק המחיר
                    ששילמתם בפועל. לא נציג את מחיר בנזין 95 כאילו הוא חל על הרכב שלכם.
                  </p>
                ) : null}

                {stats.stationStats.length > 1 ? (
                  <Card className="flex flex-col gap-2.5 p-4">
                    <Label>השוואת תחנות · מחיר ממוצע ששולם לליטר</Label>
                    <div className="flex flex-col gap-2">
                      {stats.stationStats.map((entry) => (
                        <div
                          key={entry.name}
                          className="flex items-center justify-between gap-3"
                        >
                          <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                            {entry.name}
                          </span>
                          <span className="flex-none text-[12px] text-muted">
                            <Num>{entry.count}</Num> תדלוקים
                          </span>
                          <Num className="w-[62px] flex-none text-end text-[14px] font-bold text-ink">
                            {price(entry.avgPricePerLiter)}
                          </Num>
                        </div>
                      ))}
                    </div>
                    <span className="text-[11.5px] leading-relaxed text-muted">
                      אלה המחירים ש<b>אתם</b> שילמתם, כולל הנחות אישיות — לא מחירי המשאבה
                      הפומביים של התחנות.
                    </span>
                  </Card>
                ) : null}

                <div className="flex gap-3">
                  <Card className="flex flex-1 flex-col gap-1.5 p-[14px_16px]">
                    <Label className="text-[12.5px]">התדלוק היקר ביותר</Label>
                    <Num className="text-[22px] font-bold leading-tight text-ink">
                      {stats.records.mostExpensive
                        ? shekel(stats.records.mostExpensive.totalCost)
                        : "—"}
                    </Num>
                    <span className="truncate text-[12.5px] text-muted">
                      {stats.records.mostExpensive
                        ? `${stats.records.mostExpensive.station?.name ?? "ללא מיקום"} · ${dayMonthShort(
                            stats.records.mostExpensive.date,
                          )}`
                        : "—"}
                    </span>
                  </Card>

                  <Card className="flex flex-1 flex-col gap-1.5 p-[14px_16px]">
                    <Label className="text-[12.5px]">החודש החסכוני</Label>
                    <span className="flex items-baseline gap-1.5">
                      <Num className="text-[22px] font-bold leading-tight text-accent">
                        {stats.records.mostEconomicalMonth?.kmPerLiter != null
                          ? String(toUnit(stats.records.mostEconomicalMonth.kmPerLiter))
                          : "—"}
                      </Num>
                      <span className="text-[12px] text-muted">{unitLabel}</span>
                    </span>
                    <span className="truncate text-[12.5px] text-muted">
                      {stats.records.mostEconomicalMonth
                        ? monthYear(stats.records.mostEconomicalMonth.key)
                        : "—"}
                    </span>
                  </Card>
                </div>
              </>
            ) : null}

            {/* Always rendered — including when there is nothing to compare
                against yet, which is exactly when a disappearing section is
                most confusing. */}
            {section === "community" ? (
              <CommunitySection
                comparison={comparison}
                loading={loadingComparison}
                units={units}
                sharing={settings.shareBenchmarks !== false}
                hasOwnFigure={stats.segments.length >= 2}
              />
            ) : null}
          </>
        )}
      </div>

      <Sheet
        open={vehicleSheetOpen}
        onClose={() => setVehicleSheetOpen(false)}
        title={<h2 className="text-[17px] font-bold text-ink">רכב</h2>}
      >
        <div className="flex flex-col gap-1.5">
          {activeVehicles.map((vehicle) => (
            <button
              key={vehicle.id}
              type="button"
              aria-pressed={vehicle.id === activeVehicle?.id}
              onClick={() => {
                void setActiveVehicle(vehicle.id);
                setVehicleSheetOpen(false);
              }}
              className={`flex min-h-[48px] items-center justify-between gap-3 rounded-[12px] px-3.5 text-start text-[14.5px] font-semibold transition-[background-color] duration-150 ${
                vehicle.id === activeVehicle?.id
                  ? "bg-accent-soft text-accent"
                  : "bg-surface-2 text-ink"
              }`}
            >
              <span className="truncate">{vehicleLabel(vehicle)}</span>
              {vehicle.id === activeVehicle?.id ? (
                <CheckIcon size={18} className="flex-none" />
              ) : null}
            </button>
          ))}
        </div>
      </Sheet>
    </main>
  );
}

/**
 * The date range, as ONE control.
 *
 * Six pills in a segmented track could not fit 360px: "6 חודשים" broke across
 * two lines and the whole row grew to double height. A single chip that says
 * what is selected and opens the rest costs one tap and no layout.
 */
function RangePicker({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (value: RangeKey) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex min-h-[38px] w-fit items-center gap-1.5 rounded-pill bg-surface-2 px-3.5 text-[13.5px] font-semibold text-ink"
      >
        {RANGE_COMPACT[value === "custom" ? "all" : value]}
        <ChevronDown size={15} className="text-muted" />
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={<h2 className="text-[17px] font-bold text-ink">טווח תאריכים</h2>}
      >
        <div className="flex flex-col gap-1.5">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === value}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={`flex min-h-[46px] items-center justify-between gap-3 rounded-[12px] px-3.5 text-start text-[14.5px] font-semibold transition-[background-color] duration-150 ${
                option === value
                  ? "bg-accent-soft text-accent"
                  : "bg-surface-2 text-ink"
              }`}
            >
              {RANGE_COMPACT[option]}
              {option === value ? <CheckIcon size={18} className="flex-none" /> : null}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

/**
 * What the numbers above are based on.
 *
 * One quiet line plus an info button. The card this replaces spent five lines
 * of the primary overview explaining the calculation engine to someone who had
 * come to read their own consumption.
 */
function BasisNote({
  segments,
  fillups,
  range,
  breaks,
}: {
  segments: number;
  fillups: number;
  range: DateRange;
  breaks: number;
}) {
  return (
    <div className="flex items-center gap-0.5 px-1">
      <span className="text-[12px] text-muted">
        <Num>{segments}</Num> {segments === 1 ? "מקטע" : "מקטעים"} ·{" "}
        <Num>{fillups}</Num> תדלוקים · {range.compactLabel}
      </span>
      <InfoTip label="בסיס החישוב">
        <span>
          <b className="text-ink">מקטע</b> — המרחק בין שני תדלוקים שבסיומם המיכל היה
          מלא. רק ממקטע סגור אפשר לחשב צריכה.
        </span>
        <span>הממוצע משוקלל לפי מרחק, כך שמקטע ארוך שוקל יותר מקצר.</span>
        {breaks > 0 ? (
          <span>
            בהיסטוריה יש{" "}
            <Num>{breaks}</Num>{" "}
            {breaks === 1 ? "נקודת התחלה מחדש" : "נקודות התחלה מחדש"} — שום חישוב לא
            חוצה אותן.
          </span>
        ) : null}
      </InfoTip>
    </div>
  );
}

/** Open-segment status, so retained partial fill-ups are visibly retained. */
function OpenSegmentCard({ stats }: { stats: ReturnType<typeof computeStats> }) {
  const open = stats.openSegment;
  if (!open.hasBaseline) {
    if (stats.records.fillupCount === 0) return null;
    return (
      <Card className="flex flex-col gap-1 p-4">
        <Label className="text-[12.5px]">מקטע פתוח</Label>
        <span className="text-[13.5px] leading-relaxed text-ink">
          עדיין אין נקודת התחלה. התדלוק הבא יפתח את החישוב.
        </span>
      </Card>
    );
  }

  if (open.pendingFillups === 0) return null;

  return (
    <Card className="flex flex-col gap-1 p-4">
      <Label className="text-[12.5px]">מקטע פתוח</Label>
      <span className="text-[13.5px] leading-relaxed text-ink">
        <Quantity value={open.liters} digits={1} /> מ־<Num>{open.pendingFillups}</Num>{" "}
        {open.pendingFillups === 1 ? "תדלוק חלקי" : "תדלוקים חלקיים"} ·{" "}
        <Distance value={open.km} /> מאז המילוי האחרון עד מלא
      </span>
      <span className="text-[12px] leading-relaxed text-muted">
        הליטרים נשמרים וייכללו בחישוב בתדלוק הבא.
      </span>
    </Card>
  );
}

/**
 * The Community area.
 *
 * Always on screen. The old version rendered nothing at all below four peers,
 * so a feature that was working correctly looked like a feature that did not
 * exist. Now the section explains what it is waiting for.
 */
function CommunitySection({
  comparison,
  loading,
  units,
  sharing,
  hasOwnFigure,
}: {
  comparison: BenchmarkComparison | InsufficientPeers | null;
  loading: boolean;
  units: "kmPerLiter" | "litersPer100";
  sharing: boolean;
  hasOwnFigure: boolean;
}) {
  if (!sharing) {
    return (
      <Card className="flex flex-col gap-2 p-5">
        <span className="text-[16px] font-bold text-ink">השוואה לנהגים דומים</span>
        <span className="text-[13.5px] leading-relaxed text-muted">
          ההשתתפות בהשוואה כבויה בהגדרות. כשמפעילים אותה, מפורסם סיכום צריכה אחד לכל רכב
          — בלי שם, אימייל, מספר רכב, קילומטראז׳, תחנה או תאריכים.
        </span>
      </Card>
    );
  }

  if (!hasOwnFigure) {
    return (
      <Card className="flex flex-col gap-2 p-5">
        <span className="text-[16px] font-bold text-ink">השוואה לנהגים דומים</span>
        <span className="text-[13.5px] leading-relaxed text-muted">
          צריך לפחות שני מקטעי צריכה סגורים כדי שיהיה מה להשוות.
        </span>
      </Card>
    );
  }

  if (loading) return <Skeleton className="h-[220px] rounded-card" />;

  if (comparison === null || !hasComparison(comparison)) {
    const found = comparison?.peers ?? 0;
    const required = comparison?.required ?? MIN_PEERS;
    return (
      <Card className="flex flex-col gap-3 p-5">
        <span className="text-[16px] font-bold text-ink">השוואה לנהגים דומים</span>
        <span className="text-[13.5px] leading-relaxed text-muted">
          עדיין אין מספיק נהגים להשוואה.
        </span>
        <span className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink">
            יש כרגע <Num>{found}</Num> מתוך <Num>{required}</Num> נהגים נדרשים עם רכב דומה.
          </span>
          <span className="h-2 overflow-hidden rounded-pill bg-surface-2">
            <span
              className="block h-full rounded-pill bg-accent transition-[width] duration-500"
              style={{ width: `${Math.min(100, (found / required) * 100)}%` }}
            />
          </span>
        </span>
        <span className="text-[12px] leading-relaxed text-muted">
          ההשוואה נבנית מסיכומי צריכה של נהגים אחרים עם אותו דגם וסוג דלק. היא מבוססת על
          כל היסטוריית הרכב ולא משתנה לפי טווח התאריכים שנבחר למעלה.
        </span>
      </Card>
    );
  }

  return <PeerSection comparison={comparison} units={units} />;
}

/**
 * Peer comparison.
 *
 * Placed last on purpose: this is your log first, and the community angle is
 * context rather than a scoreboard. Everything here is derived from anonymous
 * summaries — see the explainer tip.
 */
function PeerSection({
  comparison,
  units,
}: {
  comparison: import("../lib/benchmarks").BenchmarkComparison;
  units: "kmPerLiter" | "litersPer100";
}) {
  const ahead = comparison.percentile >= 50;

  /**
   * Everything on this screen is stored in km/L and converted here, together.
   * Relabelling a title while leaving the values and the tooltip in the other
   * unit is the specific failure this single conversion point prevents — and
   * it was still happening in this section's comparison chart.
   */
  const unitLabel = units === "litersPer100" ? "ל׳/100 ק״מ" : "קמ״ל";
  const toUnit = (kmPerLiter: number) =>
    units === "litersPer100"
      ? Math.round((100 / kmPerLiter) * 100) / 100
      : Math.round(kmPerLiter * 100) / 100;

  const distribution = comparison.distribution.map((bucket) => ({
    // The bucket boundary is a km/L figure too, so its axis label converts.
    label: String(toUnit(Number(bucket.bucket))),
    count: bucket.count,
    isYou: bucket.isYou,
  }));

  const versus = [
    { label: "שלכם", value: toUnit(comparison.yourAverage), isYou: true },
    { label: "ממוצע הקבוצה", value: toUnit(comparison.peerAverage), isYou: false },
    { label: "הטוב ביותר", value: toUnit(comparison.best), isYou: false },
  ];

  return (
    <section className="flex flex-col gap-3 pt-1">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-0.5">
          <Label>מול נהגים דומים</Label>
          <InfoTip label="השוואה אנונימית">
            <span>
              <b className="text-ink">משותף:</b> דגם ושנה, סוג דלק, ממוצע צריכה.
            </span>
            <span>
              <b className="text-ink">לא משותף:</b> שם, מייל, מספר רישוי, קילומטראז׳,
              תאריכים, תחנה ומיקום.
            </span>
          </InfoTip>
        </div>
        <span className="flex items-center gap-1 text-[11.5px] text-muted">
          <UserIcon size={13} />
          <Num>{comparison.peers}</Num> נהגים
        </span>
      </div>

      {/* Headline percentile */}
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline gap-2">
          <Num className="text-[30px] font-bold leading-none text-accent">
            {comparison.percentile}%
          </Num>
          <span className="text-[13.5px] leading-snug text-ink/80">
            {ahead ? "מהנהגים צורכים יותר מכם" : "מהנהגים צורכים פחות מכם"}
          </span>
        </div>

        <div className="relative h-2.5 w-full overflow-hidden rounded-pill bg-surface-2">
          <span
            className="absolute inset-y-0 end-0 rounded-pill bg-accent transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ width: `${Math.max(3, Math.min(100, comparison.percentile))}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[12.5px] text-muted">
          <span>
            שלכם:{" "}
            <ConsumptionValue
              kmPerLiter={comparison.yourAverage}
              units={units}
              className="font-bold text-ink"
            />
          </span>
          <span>
            ממוצע הקבוצה:{" "}
            <ConsumptionValue
              kmPerLiter={comparison.peerAverage}
              units={units}
              className="font-bold text-ink"
            />
          </span>
        </div>
      </Card>

      {/* Where you sit inside the pack */}
      <ChartCard
        title="התפלגות הצריכה בקבוצה"
        legend={<LegendDot color="var(--accent)" label="אתם" swatch="block" />}
      >
        <BarChart data={distribution} margin={CHART_MARGIN}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis {...xAxis} />
          <YAxis {...yAxis} width={28} allowDecimals={false} />
          <Tooltip content={<ChartTooltip suffix=" נהגים" digits={0} />} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={40}>
            {distribution.map((bucket, index) => (
              <Cell
                key={index}
                fill={bucket.isYou ? "var(--accent)" : "var(--surface-2)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartCard>

      {/* Direct side-by-side */}
      <ChartCard title={`השוואה · ${unitLabel}`}>
        <BarChart data={versus} layout="vertical" margin={{ ...CHART_MARGIN, left: 8 }}>
          <CartesianGrid stroke="var(--line)" horizontal={false} />
          <XAxis type="number" {...yAxis} orientation="bottom" />
          <YAxis
            type="category"
            dataKey="label"
            orientation="right"
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={78}
          />
          <Tooltip content={<ChartTooltip suffix={` ${unitLabel}`} />} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={22}>
            {versus.map((row, index) => (
              <Cell key={index} fill={row.isYou ? "var(--accent)" : "var(--surface-2)"} />
            ))}
          </Bar>
        </BarChart>
      </ChartCard>

      {/* Price is the other half of the story */}
      {comparison.peerAvgPrice !== null && comparison.yourAvgPrice !== null ? (
        <Card className="flex flex-col gap-2.5 p-4">
          <Label>מחיר ממוצע לליטר</Label>
          <div className="flex items-end gap-3">
            <PriceBar
              label="שלכם"
              value={comparison.yourAvgPrice}
              max={Math.max(comparison.yourAvgPrice, comparison.peerAvgPrice)}
              accent
            />
            <PriceBar
              label="הקבוצה"
              value={comparison.peerAvgPrice}
              max={Math.max(comparison.yourAvgPrice, comparison.peerAvgPrice)}
            />
          </div>
          <span className="text-[11.5px] leading-relaxed text-muted">
            {comparison.yourAvgPrice <= comparison.peerAvgPrice
              ? `אתם משלמים ${price(comparison.peerAvgPrice - comparison.yourAvgPrice)} פחות לליטר מהממוצע`
              : `אתם משלמים ${price(comparison.yourAvgPrice - comparison.peerAvgPrice)} יותר לליטר מהממוצע`}
          </span>
        </Card>
      ) : null}

      <p className="px-1 text-[11px] leading-relaxed text-muted/80">
        מבוסס על {comparison.label} · נתונים אנונימיים בלבד
      </p>
    </section>
  );
}

function PriceBar({
  label,
  value,
  max,
  accent = false,
}: {
  label: string;
  value: number;
  max: number;
  accent?: boolean;
}) {
  const height = Math.max(18, Math.round((value / max) * 78));
  return (
    <span className="flex flex-1 flex-col items-center gap-1.5">
      <Num className={`text-[14px] font-bold ${accent ? "text-accent" : "text-ink"}`}>
        {price(value)}
      </Num>
      <span
        className={`w-full rounded-t-[8px] transition-[height] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          accent ? "bg-accent" : "bg-surface-2"
        }`}
        style={{ height }}
      />
      <span className="text-[11.5px] text-muted">{label}</span>
    </span>
  );
}

/* ---------------- chart chrome ---------------- */

const CHART_MARGIN = { top: 8, right: 4, bottom: 0, left: 4 };

/**
 * RTL adjustment: time flows right-to-left, so the category axis is reversed
 * and the value axis is pinned to the right edge.
 */
const xAxis = {
  dataKey: "label",
  reversed: true,
  tick: { fill: "var(--muted)", fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "var(--line)" },
  minTickGap: 14,
  interval: "preserveStartEnd" as const,
};

const yAxis = {
  orientation: "right" as const,
  tick: { fill: "var(--muted)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
};

function ChartCard({
  title,
  legend,
  children,
}: {
  title: string;
  legend?: React.ReactNode;
  children: React.ReactElement;
}) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <Label>{title}</Label>
        {legend ? <span className="flex items-center gap-3">{legend}</span> : null}
      </div>
      <div className="h-[168px] w-full" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function LegendDot({
  color,
  label,
  dashed = false,
  swatch = "line",
}: {
  color: string;
  label: string;
  dashed?: boolean;
  /** Match the mark to the series: a line for lines, a block for bars. */
  swatch?: "line" | "block";
}) {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
      <span
        className={swatch === "block" ? "size-2.5 rounded-[3px]" : "h-0.5 w-3.5 rounded-full"}
        style={
          dashed
            ? {
                backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)`,
              }
            : { background: color }
        }
      />
      {label}
    </span>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  suffix = "",
  currency = false,
  digits = 1,
}: {
  active?: boolean;
  payload?: { value?: number | string; dataKey?: string | number; name?: string }[];
  label?: string;
  suffix?: string;
  currency?: boolean;
  digits?: number;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div
      dir="rtl"
      className="rounded-[12px] border border-line bg-surface px-3 py-2 shadow-[0_10px_24px_-12px_rgb(13_35_28/0.4)]"
    >
      <div className="text-[11.5px] text-muted">{label}</div>
      {payload.map((entry, index) => {
        const value = typeof entry.value === "number" ? entry.value : Number(entry.value);
        if (!Number.isFinite(value)) return null;
        return (
          <div key={index} className="text-[13.5px] font-bold text-ink">
            <Num>{currency ? shekel(value, 2) : `${num(value, digits)}${suffix}`}</Num>
          </div>
        );
      })}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  unit,
  accent = false,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <Card className="flex flex-1 flex-col gap-1.5 p-[14px_16px]">
      <Label className="text-[12.5px]">{label}</Label>
      <span className="flex items-baseline gap-1.5">
        <Num
          className={`text-[22px] font-bold leading-tight ${accent ? "text-accent" : "text-ink"}`}
        >
          {value}
        </Num>
        {unit ? <span className="text-[12px] text-muted">{unit}</span> : null}
      </span>
    </Card>
  );
}
