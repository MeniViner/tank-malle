import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useStats } from "../hooks/useStats";
import { usePublishSummary } from "../hooks/usePublishSummary";
import { AppHeader } from "../components/AppHeader";
import { Card, Label, SectionTitle, Skeleton } from "../components/Card";
import { MyTankCard } from "../components/MyTankCard";
import { Sheet } from "../components/Sheet";
import { Num } from "../components/Num";
import { ConsumptionValue, Quantity } from "../components/Fmt";
import { InfoIcon, PumpIcon, SparkleIcon, WarningIcon } from "../components/icons";
import { compareToPersonalAverage } from "../lib/efficiency";
import { adaptLegacyConfig, regulatedMaxPrice } from "../lib/prices/regulated";
import type { Segment } from "../lib/stats";
import { normalise, smoothPath } from "../lib/curve";
import {
  FUEL_TYPE_SHORT,
  consumption,
  dayMonthShort,
  heMonthName,
  num,
  price,
  shekel,
} from "../lib/format";

/** How many closed segments the hero sparkline plots. */
const SPARK_SEGMENTS = 6;

/**
 * Home dashboard.
 *
 * One dark hero card carries the single number the screen exists for, two
 * light cards under it carry the supporting pair, and the recent fill-ups are
 * a timeline rather than a boxed list — so the eye lands on the consumption
 * first and everything else reads as context to it.
 */
export function Home() {
  const { settings, fillups, loadingFillups } = useData();
  const stats = useStats();
  // Operational telemetry for the admin dashboard, so it never has to read
  // anyone's fill-up records to count them.
  usePublishSummary(stats);

  const [explainerOpen, setExplainerOpen] = useState(false);

  const units = settings.units;

  const hero = consumption(stats.lastSegment?.kmPerLiter ?? null, units);
  const average = consumption(stats.avgKmPerLiter, units);

  /**
   * More economical or less — never "above/below the average".
   *
   * Computed from km/L, the canonical metric, so the verdict is identical
   * whether the screen is showing km/L or L/100 km. Saying "+4% above the
   * average" beside a 6.8 that is BELOW a 7.1 L/100 km average is the exact
   * contradiction this replaces.
   */
  const comparison = compareToPersonalAverage(
    stats.lastSegment?.kmPerLiter ?? null,
    stats.avgKmPerLiter,
  );

  const recent = [...stats.fillups].sort((a, b) => b.date - a.date).slice(0, 3);
  const lastFillup = recent[0] ?? null;
  const consumptionByEndId = new Map(stats.segments.map((s) => [s.endId, s.kmPerLiter]));

  return (
    <main className="flex flex-1 flex-col pb-[104px] pt-safe">
      <AppHeader />

      <div className="flex flex-col gap-3 px-5 pt-2.5">
        {loadingFillups ? (
          <HomeSkeleton />
        ) : (
          <>
            {/* Hero: the last measured consumption, the personal average, and
                which of the two is the more economical result. */}
            <section className="tm-rise flex flex-col gap-3 rounded-hero bg-hero p-[16px_18px_17px] text-hero-ink shadow-raised">
              <div className="flex items-start justify-between gap-2">
                <span className="flex flex-none items-center">
                  <Label className="text-hero-muted">צריכה אחרונה</Label>
                  <button
                    type="button"
                    aria-label="מה המספרים האלה"
                    aria-haspopup="dialog"
                    aria-expanded={explainerOpen}
                    onClick={() => setExplainerOpen(true)}
                    className="flex size-9 items-center justify-center rounded-full text-hero-muted transition-[color,scale] duration-200 active:scale-[0.96]"
                  >
                    <InfoIcon size={15} />
                  </button>
                </span>

                {comparison ? (
                  <span
                    className={`mt-1 inline-flex items-center gap-1.5 rounded-pill bg-hero-soft px-[11px] py-1 text-[12px] font-semibold ${
                      comparison.outcome === "better"
                        ? "text-hero-good"
                        : comparison.outcome === "worse"
                          ? "text-hero-bad"
                          : "text-hero-muted"
                    }`}
                  >
                    {comparison.outcome === "better" ? (
                      <SparkleIcon size={13} />
                    ) : comparison.outcome === "worse" ? (
                      <WarningIcon size={13} />
                    ) : null}
                    {comparison.label}
                  </span>
                ) : null}
              </div>

              <span className="flex items-baseline gap-2">
                <Num className="text-[52px] font-bold leading-[0.92] tracking-[-0.01em]">
                  {hero.value}
                </Num>
                <span className="text-[15px] font-semibold text-hero-muted">{hero.unit}</span>
              </span>

              <HeroSpark segments={stats.segments} />

              {stats.avgKmPerLiter !== null ? (
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-hero-line pt-3 text-[12.5px]">
                  <span>
                    ממוצע כולל <Num className="font-semibold">{average.value}</Num>{" "}
                    {average.unit}
                  </span>
                  <span className="text-hero-muted">
                    מבוסס על <Num>{stats.segments.length}</Num>{" "}
                    {stats.segments.length === 1 ? "מקטע" : "מקטעים"} ·{" "}
                    <Num>{stats.records.fillupCount}</Num> תדלוקים
                  </span>
                </div>
              ) : (
                <div className="border-t border-hero-line pt-3 text-[12.5px] text-hero-muted">
                  הצריכה תחושב אחרי שני תדלוקים
                </div>
              )}

              <OpenSegmentNote stats={stats} />
            </section>

            <div className="tm-rise flex gap-3" style={{ animationDelay: "70ms" }}>
              <MonthSpendCard stats={stats} lastFillupDate={lastFillup?.date ?? null} />
              <FuelPriceCard />
            </div>

            {/* Full width: the estimate, both thresholds, the personalised
                sentence and two actions do not fit in half a row. The old
                full-tank range strip is gone — this card carries the range that
                matters, which is the one to the refuelling threshold rather
                than to an empty tank. */}
            <MyTankCard />

            <SectionTitle
              action={
                fillups.length > 0 ? (
                  <Link to="/history" className="text-[13.5px] font-semibold text-accent">
                    לכל ההיסטוריה
                  </Link>
                ) : null
              }
            >
              תדלוקים אחרונים
            </SectionTitle>

            {recent.length === 0 ? (
              <Card className="flex flex-col items-center gap-3 px-6 py-8 text-center">
                <span className="flex size-[58px] items-center justify-center rounded-[20px] bg-accent-soft text-accent">
                  <PumpIcon size={28} />
                </span>
                <span className="text-[16px] font-bold text-ink">אין עדיין תדלוקים</span>
                <span className="max-w-[250px] text-[13.5px] leading-relaxed text-muted">
                  הוסיפו תדלוק ראשון כדי להתחיל.
                </span>
              </Card>
            ) : (
              /* A timeline, not a list card: the rail runs down the end edge
                 and each record hangs off its own node, newest at the top. */
              <div
                className="tm-rise relative flex flex-col"
                style={{ animationDelay: "150ms" }}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-6 end-[12px] w-px bg-line"
                />

                {recent.map((fillup, index) => {
                  const kmPerLiter = consumptionByEndId.get(fillup.id) ?? null;
                  return (
                    <Link
                      key={fillup.id}
                      to={`/fillup/${fillup.id}`}
                      className="relative flex min-h-[58px] items-center gap-2.5 rounded-[16px] px-1 py-2.5 transition-[background-color] duration-150 active:bg-surface-2"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[15px] font-semibold text-ink">
                          {fillup.station?.name || "ללא מיקום"}
                        </span>
                        <span className="text-[13px] text-muted">
                          {dayMonthShort(fillup.date)} · <Num>{num(fillup.liters, 1)}</Num> ל׳ ·{" "}
                          <Num>{shekel(fillup.totalCost)}</Num>
                        </span>
                      </span>

                      {!fillup.isFullTank ? (
                        <span className="flex-none text-[12.5px] font-semibold text-muted">
                          חלקי
                        </span>
                      ) : kmPerLiter !== null ? (
                        <ConsumptionValue
                          kmPerLiter={kmPerLiter}
                          units={units}
                          className="flex-none text-[15px] font-bold text-ink"
                          unitClassName="text-[11.5px] font-semibold text-muted"
                        />
                      ) : null}

                      {/* The node sits on the rail; its ring in the page
                          background is what makes the line stop at the dot. */}
                      <span
                        aria-hidden="true"
                        className="flex w-[24px] flex-none justify-center"
                      >
                        <span
                          className={`size-[9px] rounded-full ring-4 ring-bg ${
                            index === 0 ? "bg-accent" : "border border-line bg-surface"
                          }`}
                        />
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <Sheet
        open={explainerOpen}
        onClose={() => setExplainerOpen(false)}
        title={<h2 className="text-[17px] font-bold text-ink">איך זה מחושב</h2>}
      >
        <div className="flex flex-col gap-3 px-1 text-[13.5px] leading-relaxed text-ink/85">
          <span>
            <b className="text-ink">צריכה אחרונה</b> — צריכת הדלק שנמדדה מאז התדלוק המלא הקודם.
          </span>

          <span>
            <b className="text-ink">ממוצע כולל</b> — ממוצע צריכת הדלק מכל הנסיעות שנמדדו, לפי המרחק שנסעת.
          </span>

          <span>
            אם סימנת שהיה תדלוק שלא תועד, החישוב מתחיל מחדש מאותה נקודה כדי לשמור על דיוק.
          </span>
        </div>
      </Sheet>
    </main>
  );
}

/**
 * The last few closed segments: bars, with the trend drawn over them.
 *
 * The bars are the individual results and the curve is the shape they make —
 * a run of six numbers is a lot easier to read as a direction than as six
 * heights. Newest sits at the reading start of the row, which in RTL is the
 * left end, so the eye lands on the most recent result first.
 *
 * Decoration for the number above it: every figure it encodes is already
 * written out in text, so it is hidden from assistive tech rather than given
 * labels nobody asked for.
 */
function HeroSpark({ segments }: { segments: Segment[] }) {
  const recent = segments.slice(-SPARK_SEGMENTS);
  if (recent.length < 2) return null;

  // SVG x always runs left to right, so the series is reversed to put the
  // newest result on the left the way the rest of the row reads.
  const series = [...recent].reverse();
  const heights = normalise(series.map((segment) => segment.kmPerLiter));

  const width = 100;
  const height = 40;
  const gap = 1.6;
  const barWidth = (width - gap * (series.length - 1)) / series.length;
  // A flat run would otherwise collapse to a row of slivers, so the scale
  // starts a third of the way up rather than at zero.
  const topFor = (value: number) => height - (34 + 62 * value) * (height / 100);

  const points = series.map((_, index) => ({
    x: index * (barWidth + gap) + barWidth / 2,
    y: topFor(heights[index]),
  }));

  // Run the curve out to both edges so it reads as a continuing trend rather
  // than a line that starts and stops inside the card.
  const curve = smoothPath([
    { x: 0, y: points[0].y },
    ...points,
    { x: width, y: points[points.length - 1].y },
  ]);

  const newestEdge = barWidth + gap / 2;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-[46px] w-full overflow-visible"
      aria-hidden="true"
    >
      <defs>
        {/* The newest result is highlighted by clipping a second copy of the
            same geometry, so the bar and the curve above it can never disagree
            about where "newest" ends. */}
        <clipPath id="spark-newest" clipPathUnits="userSpaceOnUse">
          <rect x={0} y={-8} width={newestEdge} height={height + 16} />
        </clipPath>
      </defs>

      {series.map((segment, index) => (
        <rect
          key={segment.endId}
          x={index * (barWidth + gap)}
          y={points[index].y}
          width={barWidth}
          height={height - points[index].y}
          rx={1.6}
          className={index === 0 ? "fill-hero-accent" : "fill-hero-soft"}
          opacity={index === 0 ? 0.85 : 1}
        />
      ))}

      <path
        d={curve}
        fill="none"
        stroke="var(--hero-ink)"
        strokeOpacity={0.7}
        strokeWidth={1.6}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={curve}
        fill="none"
        stroke="var(--hero-accent)"
        strokeWidth={2.2}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        clipPath="url(#spark-newest)"
      />
    </svg>
  );
}

/**
 * This month's spend.
 *
 * A month with no fill-up in it is not a ₪0 month — it is a month that has not
 * happened yet — so it says so and points at the last one that did.
 */
function MonthSpendCard({
  stats,
  lastFillupDate,
}: {
  stats: ReturnType<typeof useStats>;
  lastFillupDate: number | null;
}) {
  const month = stats.currentMonth;

  return (
    <Card className="flex flex-1 flex-col gap-1.5 p-[14px_16px]">
      <Label className="text-[12.5px]">הוצאה החודש</Label>

      {month ? (
        <>
          {/* dir="ltr" inside an RTL card left-aligns by default; the amount
              belongs on the card's start edge, which is the right. */}
          <Num className="text-end text-[24px] font-bold leading-tight text-ink">
            {shekel(month.cost)}
          </Num>
          <span className="text-[12.5px] text-muted">
            <Num>{month.count}</Num> {month.count === 1 ? "תדלוק" : "תדלוקים"} ·{" "}
            {heMonthName(new Date().getMonth() + 1)}
          </span>
        </>
      ) : (
        <>
          <span className="text-[19px] font-bold leading-tight text-ink">טרם תודלק</span>
          <span className="text-[12.5px] text-muted">
            {lastFillupDate !== null ? `אחרון: ${dayMonthShort(lastFillupDate)}` : "עדיין אין תדלוקים"}
          </span>
        </>
      )}
    </Card>
  );
}

/**
 * The current fuel price, for THIS vehicle's fuel type.
 *
 * The regulated maximum in Israel covers 95-octane self-service and nothing
 * else. A diesel or 98 vehicle therefore gets "אין מחיר עדכני" rather than the
 * 95 figure wearing its label.
 */
function FuelPriceCard() {
  const { prices, activeVehicle } = useData();
  const fuelType = activeVehicle?.fuelType ?? "95";

  const lookup = useMemo(
    () => regulatedMaxPrice(adaptLegacyConfig(prices), fuelType, Date.now()),
    [prices, fuelType],
  );

  return (
    <Card className="flex flex-1 flex-col gap-1.5 p-[14px_16px]">
      <Label className="text-[12.5px]">מחיר דלק נוכחי</Label>
      <span className="flex items-baseline gap-1.5">
        <Num className="text-[24px] font-bold leading-tight text-ink">
          {lookup.price !== null ? price(lookup.price) : "—"}
        </Num>
        {lookup.price !== null ? (
          <span className="text-[12px] text-muted">לליטר</span>
        ) : null}
      </span>
      <span className="truncate text-[12.5px] text-muted">
        {lookup.price === null
          ? `אין מחיר עדכני · ${FUEL_TYPE_SHORT[fuelType]}`
          : `${FUEL_TYPE_SHORT[fuelType]}${
              lookup.updatedAt ? ` · עודכן ${dayMonthShort(lookup.updatedAt)}` : ""
            }`}
      </span>
    </Card>
  );
}

/**
 * Open-segment status.
 *
 * Partial fill-ups are retained, not ignored — but nothing in the UI said so,
 * which made a partial look like it had been thrown away. This states the
 * pending liters explicitly.
 */
function OpenSegmentNote({ stats }: { stats: ReturnType<typeof useStats> }) {
  const open = stats.openSegment;

  if (!open.hasBaseline) {
    if (stats.records.fillupCount === 0) return null;
    return (
      <span className="text-[12.5px] text-hero-muted">
        עדיין אין נקודת התחלה. התדלוק הבא יפתח את החישוב.
      </span>
    );
  }

  if (open.pendingFillups === 0) return null;

  return (
    <span className="text-[12.5px] text-hero-muted">
      במקטע הפתוח נשמרו <Quantity value={open.liters} digits={1} /> מ־
      <Num>{open.pendingFillups}</Num>{" "}
      {open.pendingFillups === 1 ? "תדלוק חלקי" : "תדלוקים חלקיים"} — הם ייכללו בחישוב
      בתדלוק הבא.
    </span>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-[208px] rounded-hero" />
      <div className="flex gap-3">
        <Skeleton className="h-[92px] flex-1 rounded-card" />
        <Skeleton className="h-[92px] flex-1 rounded-card" />
      </div>
      <Skeleton className="h-[210px] rounded-card" />
      <Skeleton className="h-[176px] rounded-card" />
    </div>
  );
}
