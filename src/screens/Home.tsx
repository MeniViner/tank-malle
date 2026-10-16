import { resolveEndState } from "../lib/tank/observations";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useStats } from "../hooks/useStats";
import { AppHeader } from "../components/AppHeader";
import { Card, Label, SectionTitle, Skeleton } from "../components/Card";
import { MyTankCard } from "../components/MyTankCard";
import { Sheet } from "../components/Sheet";
import { Num } from "../components/Num";
import { ConsumptionValue, Quantity } from "../components/Fmt";
import { InfoIcon, PumpIcon, SparkleIcon, WarningIcon } from "../components/icons";
import { compareToPersonalAverage } from "../lib/efficiency";
import { officialPriceFor } from "../lib/prices/regulated";
import { StationBrandMark } from "../components/StationBrand";
import { HeroSpark } from "../components/HeroSpark";
import {
  FUEL_TYPE_SHORT,
  consumption,
  dayMonthShort,
  heMonthName,
  num,
  price,
  shekel,
} from "../lib/format";

/** Consumption first, followed by current costs, tank guidance and recent records. */
export function Home() {
  const { settings, fillups, loadingFillups } = useData();
  const stats = useStats();
  // Operational telemetry for the admin dashboard, so it never has to read
  // anyone's fill-up records to count them.

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

      <div className="tm-page">
        {loadingFillups ? (
          <HomeSkeleton />
        ) : (
          <>
            {/* Hero: the last measured consumption, the personal average, and
                which of the two is the more economical result. */}
            <section data-testid="consumption-summary" className="tm-rise flex flex-col gap-2.5 py-2 text-ink">
              <div className="flex items-start justify-between gap-2">
                <span className="flex flex-none items-center">
                  <Label className="text-muted">צריכה אחרונה</Label>
                  <button
                    type="button"
                    aria-label="מה המספרים האלה"
                    aria-haspopup="dialog"
                    aria-expanded={explainerOpen}
                    onClick={() => setExplainerOpen(true)}
                    className="flex size-10 items-center justify-center rounded-full text-muted transition-[color,scale] duration-200 active:scale-[0.96]"
                  >
                    <InfoIcon size={15} />
                  </button>
                </span>

                {comparison ? (
                  <span
                    className={`mt-1 inline-flex items-center gap-1.5 rounded-pill px-1 py-1 text-[12px] font-semibold ${
                      comparison.outcome === "better"
                        ? "text-success-ink"
                        : comparison.outcome === "worse"
                          ? "text-danger-ink"
                          : "text-muted"
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
                <Num className="font-display text-[64px] font-bold leading-[0.88] tracking-[-0.03em]">
                  {hero.value}
                </Num>
                <span className="text-[15px] font-semibold text-muted">{hero.unit}</span>
              </span>

              <HeroSpark segments={stats.segments} units={units} average={stats.avgKmPerLiter} />

              {stats.avgKmPerLiter !== null ? (
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[13.5px]">
                  <span>
                    ממוצע כולל <Num className="font-semibold">{average.value}</Num>{" "}
                    {average.unit}
                  </span>
                  <span className="text-muted">
                    מבוסס על <Num>{stats.segments.length}</Num>{" "}
                    {stats.segments.length === 1 ? "מקטע" : "מקטעים"} ·{" "}
                    <Num>{stats.records.fillupCount}</Num> תדלוקים
                  </span>
                </div>
              ) : (
                <div className="border-t border-line pt-3 text-[14px] text-muted">
                  הצריכה תחושב אחרי שני תדלוקים
                </div>
              )}

              <OpenSegmentNote stats={stats} />
            </section>

            <div className="tm-rise tm-statpair" style={{ animationDelay: "70ms" }}>
              <MonthSpendCard stats={stats} lastFillupDate={lastFillup?.date ?? null} />
              <span className="tm-statpair-divider" aria-hidden="true" />
              <FuelPriceCard />
            </div>

            <MyTankCard />

            <SectionTitle
              action={
                fillups.length > 0 ? (
                  <Link to="/history" className="inline-flex min-h-10 items-center text-[14px] font-semibold text-accent">
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
                <span className="max-w-[250px] text-[14px] leading-relaxed text-muted">
                  הוסיפו תדלוק ראשון כדי להתחיל.
                </span>
              </Card>
            ) : (
              <div className="tm-timeline -mt-5" data-testid="recent-fillups-timeline">
                {recent.map((fillup) => {
                  const kmPerLiter = consumptionByEndId.get(fillup.id) ?? null;
                  return (
                    <Link
                      key={fillup.id}
                      to={`/fillup/${fillup.id}`}
                      className="tm-timeline-row"
                    >
                      <StationBrandMark brand={fillup.station?.brand} name={fillup.station?.name} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[15px] font-semibold text-ink">
                          {fillup.station?.name || "ללא מיקום"}
                        </span>
                        <span className="text-[13px] text-muted">
                          {dayMonthShort(fillup.date)} · <Num>{num(fillup.liters, 1)}</Num> ל׳ ·{" "}
                          <Num>{shekel(fillup.totalCost)}</Num>
                        </span>
                      </span>

                      {resolveEndState(fillup).state !== "full" ? (
                        <span className="flex-none text-[14px] font-semibold text-muted">
                          {resolveEndState(fillup).state === "partial" ? "חלקי" : "לא צוין"}
                        </span>
                      ) : kmPerLiter !== null ? (
                        <ConsumptionValue
                          kmPerLiter={kmPerLiter}
                          units={units}
                          className="flex-none text-[15px] font-bold text-ink"
                          unitClassName="text-[13px] font-semibold text-muted"
                        />
                      ) : null}

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
        title={<h2 className="text-[18px] font-semibold text-ink">איך זה מחושב</h2>}
      >
        <div className="flex flex-col gap-3 px-1 text-[14px] leading-relaxed text-ink/85">
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
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Label>הוצאה החודש</Label>

      {month ? (
        <>
          {/* dir="ltr" inside an RTL card left-aligns by default; the amount
              belongs on the card's start edge, which is the right. */}
          <Num className="self-start whitespace-nowrap font-display text-[26px] font-bold leading-tight text-ink">
            {shekel(month.cost)}
          </Num>
          <span className="text-[14px] text-muted">
            <Num>{month.count}</Num> {month.count === 1 ? "תדלוק" : "תדלוקים"} ·{" "}
            {heMonthName(new Date().getMonth() + 1)}
          </span>
        </>
      ) : (
        <>
          <span className="text-[19px] font-bold leading-tight text-ink">טרם תודלק</span>
          <span className="text-[14px] text-muted">
            {lastFillupDate !== null ? `אחרון: ${dayMonthShort(lastFillupDate)}` : "עדיין אין תדלוקים"}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The current fuel price, for THIS vehicle's fuel type.
 *
 * The regulated maximum in Israel covers 95-octane self-service and nothing
 * else. A diesel or 98 vehicle therefore gets "אין מחיר עדכני" rather than the
 * 95 figure wearing its label — unless an admin entered one, in which case it
 * is shown and named as a manual entry. Same resolver as the fill-up form.
 */
function FuelPriceCard() {
  const { prices, activeVehicle } = useData();
  const fuelType = activeVehicle?.fuelType ?? "95";

  // Sampled once per mount: the card is about today's figure, and a render is
  // not an event.
  const [today] = useState(() => Date.now());
  const lookup = useMemo(() => officialPriceFor(prices, fuelType, today), [prices, fuelType, today]);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Label>מחיר דלק נוכחי</Label>
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <Num className="font-display text-[26px] font-bold leading-tight text-ink">
          {lookup.price !== null ? price(lookup.price) : "—"}
        </Num>
        {lookup.price !== null ? (
          <span className="text-[12px] text-muted">לליטר</span>
        ) : null}
      </span>
      <span className="truncate text-[14px] text-muted">
        {lookup.price === null
          ? `אין מחיר עדכני · ${FUEL_TYPE_SHORT[fuelType]}`
          : lookup.isRegulated ? '95 · שירות עצמי' : `${FUEL_TYPE_SHORT[fuelType]} · ידני`}
      </span>
    </div>
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
      <span className="text-[14px] text-muted">
        עדיין אין נקודת התחלה. התדלוק הבא יפתח את החישוב.
      </span>
    );
  }

  if (open.pendingFillups === 0) return null;

  return (
    <span className="text-[14px] text-muted">
      במקטע הפתוח נשמרו <Quantity value={open.liters} digits={1} /> מ־
      <Num>{open.pendingFillups}</Num>{" "}
      {open.pendingFillups === 1 ? "תדלוק" : "תדלוקים"} — הם ייכללו בחישוב
      בתדלוק הבא.
    </span>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-[208px] rounded-card" />
      <div className="flex gap-3">
        <Skeleton className="h-[92px] flex-1 rounded-card" />
        <Skeleton className="h-[92px] flex-1 rounded-card" />
      </div>
      <Skeleton className="h-[210px] rounded-card" />
      <Skeleton className="h-[176px] rounded-card" />
    </div>
  );
}
