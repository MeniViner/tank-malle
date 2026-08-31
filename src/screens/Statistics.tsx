import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useData } from "../context/DataContext";
import { computeStats, filterByRange } from "../lib/stats";
import { Card, Label, Skeleton } from "../components/Card";
import { Segmented } from "../components/Segmented";
import { Num } from "../components/Num";
import { ChartIcon } from "../components/icons";
import {
  consumption,
  dayMonthShort,
  heMonthShort,
  monthYear,
  num,
  price,
  shekel,
  vehicleShort,
} from "../lib/format";

type Range = "3m" | "6m" | "1y" | "all";

const RANGES: { value: Range; label: string }[] = [
  { value: "3m", label: "3ח׳" },
  { value: "6m", label: "6ח׳" },
  { value: "1y", label: "שנה" },
  { value: "all", label: "הכול" },
];

/**
 * Statistics (designs 17 / 23).
 *
 * Every series is recomputed from the raw fill-ups for the selected range, so
 * the range control and any backdated edit are the same code path.
 */
export function Statistics() {
  const { fillups, activeVehicle, prices, settings, loadingFillups } = useData();
  const [range, setRange] = useState<Range>("6m");

  const stats = useMemo(
    () => computeStats(filterByRange(fillups, range), activeVehicle, prices),
    [fillups, range, activeVehicle, prices],
  );

  const units = settings.units;
  const average = consumption(stats.avgKmPerLiter, units);

  const consumptionData = useMemo(
    () =>
      stats.consumptionSeries.map((point) => ({
        label: point.label,
        value:
          units === "litersPer100"
            ? Math.round((100 / point.kmPerLiter) * 100) / 100
            : point.kmPerLiter,
      })),
    [stats.consumptionSeries, units],
  );

  const averageLine =
    units === "litersPer100" ? stats.avgLitersPer100 : stats.avgKmPerLiter;

  const monthlyData = useMemo(
    () =>
      stats.months.map((bucket) => ({
        label: heMonthShort(bucket.month),
        cost: bucket.cost,
      })),
    [stats.months],
  );

  const priceData = useMemo(
    () =>
      stats.priceSeries.map((point) => ({
        label: point.label,
        paid: point.paid,
        official: point.official,
      })),
    [stats.priceSeries],
  );

  const odometerData = useMemo(
    () =>
      stats.odometerSeries.map((point) => ({
        label: point.label,
        odometer: point.odometer,
      })),
    [stats.odometerSeries],
  );

  return (
    <main className="flex flex-1 flex-col pb-[104px] pt-safe">
      <header className="flex flex-none items-baseline justify-between gap-2 px-5 pb-3 pt-4">
        <h1 className="text-[22px] font-bold text-ink">סטטיסטיקות</h1>
        <span className="truncate text-[13px] text-muted">{vehicleShort(activeVehicle)}</span>
      </header>

      <div className="flex flex-col gap-3 px-5">
        <Segmented value={range} options={RANGES} onChange={setRange} ariaLabel="טווח זמן" />

        {loadingFillups ? (
          <>
            <Skeleton className="h-[188px] rounded-card" />
            <Skeleton className="h-[188px] rounded-card" />
          </>
        ) : stats.fillups.length < 2 ? (
          <Card className="flex flex-col items-center gap-3 px-7 py-12 text-center">
            <span className="flex size-[64px] items-center justify-center rounded-[22px] bg-accent-soft text-accent">
              <ChartIcon size={30} />
            </span>
            <span className="text-[17px] font-bold text-ink">אין עדיין מספיק נתונים</span>
            <span className="max-w-[260px] text-[13.5px] leading-relaxed text-muted">
              אחרי שני תדלוקים במיכל מלא נתחיל להציג מגמות, עלויות והשוואות.
            </span>
          </Card>
        ) : (
          <>
            {/* Summary strip */}
            <div className="flex gap-3">
              <SummaryCard
                label="ממוצע צריכה"
                value={average.value}
                unit={average.unit}
                accent
              />
              <SummaryCard
                label="עלות לק״מ"
                value={stats.avgCostPerKm !== null ? shekel(stats.avgCostPerKm, 2) : "—"}
              />
            </div>

            <div className="flex gap-3">
              <SummaryCard
                label="ק״מ בחודש"
                value={stats.kmPerMonth !== null ? num(stats.kmPerMonth, 0) : "—"}
                unit="ק״מ"
              />
              <SummaryCard
                label="סה״כ הוצאה"
                value={shekel(stats.records.totalCost)}
              />
            </div>

            <ChartCard
              title={units === "litersPer100" ? "צריכה · ל׳/100 ק״מ" : "צריכה · קמ״ל"}
              legend={
                <>
                  <LegendDot color="var(--accent)" label="בפועל" />
                  {averageLine ? (
                    <LegendDot color="var(--muted)" label={`ממוצע ${num(averageLine, 1)}`} dashed />
                  ) : null}
                </>
              }
            >
              <LineChart data={consumptionData} margin={CHART_MARGIN}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis {...xAxis} />
                <YAxis {...yAxis} width={38} />
                <Tooltip content={<ChartTooltip suffix={` ${average.unit}`} />} />
                {averageLine ? (
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

            <ChartCard title="הוצאה חודשית · ₪">
              <BarChart data={monthlyData} margin={CHART_MARGIN}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis {...xAxis} />
                <YAxis {...yAxis} width={44} />
                <Tooltip content={<ChartTooltip currency />} />
                <Bar dataKey="cost" fill="var(--accent)" radius={[6, 6, 0, 0]} maxBarSize={34} />
              </BarChart>
            </ChartCard>

            <ChartCard
              title="מחיר לליטר"
              legend={
                <>
                  <LegendDot color="var(--accent)" label="ששולם" />
                  <LegendDot color="var(--muted)" label="רשמי" dashed />
                </>
              }
            >
              <LineChart data={priceData} margin={CHART_MARGIN}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis {...xAxis} />
                <YAxis {...yAxis} width={42} domain={["auto", "auto"]} />
                <Tooltip content={<ChartTooltip currency />} />
                <Line
                  type="monotone"
                  dataKey="official"
                  stroke="var(--muted)"
                  strokeWidth={1.8}
                  strokeDasharray="5 5"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="paid"
                  stroke="var(--accent)"
                  strokeWidth={2.6}
                  dot={{ r: 3, fill: "var(--accent)", strokeWidth: 0 }}
                />
              </LineChart>
            </ChartCard>

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
                />
              </AreaChart>
            </ChartCard>

            {/* Records */}
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
                    {stats.records.mostEconomicalMonth
                      ? consumption(stats.records.mostEconomicalMonth.kmPerLiter, units).value
                      : "—"}
                  </Num>
                  <span className="text-[12px] text-muted">{average.unit}</span>
                </span>
                <span className="truncate text-[12.5px] text-muted">
                  {stats.records.mostEconomicalMonth
                    ? monthYear(stats.records.mostEconomicalMonth.key)
                    : "—"}
                </span>
              </Card>
            </div>

            {stats.vsDeclaredPercent !== null ? (
              <Card className="flex items-center justify-between gap-3 p-4">
                <span className="flex flex-col gap-0.5">
                  <span className="text-[14.5px] font-semibold text-ink">
                    מול נתוני היצרן
                  </span>
                  <span className="text-[12.5px] text-muted">
                    מוצהר: <Num>{num(activeVehicle?.declaredKmPerLiter ?? 0, 1)}</Num> קמ״ל
                  </span>
                </span>
                <Num
                  className={`rounded-pill px-3 py-1.5 text-[13px] font-bold ${
                    stats.vsDeclaredPercent >= 0
                      ? "bg-success-soft text-success-ink"
                      : "bg-danger-soft text-danger-ink"
                  }`}
                >
                  {stats.vsDeclaredPercent > 0 ? "+" : ""}
                  {num(stats.vsDeclaredPercent, 1)}%
                </Num>
              </Card>
            ) : null}

            {stats.stationStats.length > 1 ? (
              <Card className="flex flex-col gap-2.5 p-4">
                <Label>השוואת תחנות · מחיר ממוצע לליטר</Label>
                <div className="flex flex-col gap-2">
                  {stats.stationStats.map((entry) => (
                    <div key={entry.name} className="flex items-center justify-between gap-3">
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
              </Card>
            ) : null}
          </>
        )}
      </div>
    </main>
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
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
      <span
        className="h-0.5 w-3.5 rounded-full"
        style={
          dashed
            ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` }
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
}: {
  active?: boolean;
  payload?: { value?: number | string; dataKey?: string | number; name?: string }[];
  label?: string;
  suffix?: string;
  currency?: boolean;
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
            <Num>{currency ? shekel(value, 2) : `${num(value, 1)}${suffix}`}</Num>
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
