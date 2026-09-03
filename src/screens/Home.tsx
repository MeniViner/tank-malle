import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useStats } from "../hooks/useStats";
import { usePublishSummary } from "../hooks/usePublishSummary";
import { AppHeader } from "../components/AppHeader";
import { Card, Label, ListCard, SectionTitle, Skeleton } from "../components/Card";
import { InfoStrip } from "../components/Field";
import { Sheet } from "../components/Sheet";
import { Num } from "../components/Num";
import { ConsumptionValue, Quantity } from "../components/Fmt";
import { InfoIcon, PumpIcon, SparkleIcon, WarningIcon } from "../components/icons";
import { compareToPersonalAverage } from "../lib/efficiency";
import { adaptLegacyConfig, regulatedMaxPrice } from "../lib/prices/regulated";
import {
  FUEL_TYPE_SHORT,
  consumption,
  dayMonthShort,
  heMonthName,
  num,
  price,
  shekel,
} from "../lib/format";

/** Home dashboard (design 09 / 21). */
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
            <Card className="tm-rise flex flex-col gap-2 rounded-hero p-[17px_18px_15px]">
              <span className="flex items-center justify-between">
                <Label>צריכה אחרונה</Label>
                <button
                  type="button"
                  aria-label="מה המספרים האלה"
                  aria-haspopup="dialog"
                  aria-expanded={explainerOpen}
                  onClick={() => setExplainerOpen(true)}
                  className="-me-2 flex size-9 items-center justify-center rounded-full text-muted/70 transition-[color,scale] duration-200 active:scale-[0.96]"
                >
                  <InfoIcon size={16} />
                </button>
              </span>

              <span className="flex flex-wrap items-center gap-3">
                <span className="flex items-baseline gap-1.5">
                  <Num className="text-[34px] font-bold leading-none text-accent">
                    {hero.value}
                  </Num>
                  <span className="text-[16px] font-semibold text-muted">{hero.unit}</span>
                </span>

                {comparison ? (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-pill px-[11px] py-1 text-[12.5px] font-semibold ${
                      comparison.outcome === "better"
                        ? "bg-success-soft text-success-ink"
                        : comparison.outcome === "worse"
                          ? "bg-danger-soft text-danger-ink"
                          : "bg-surface-2 text-muted"
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
              </span>

              {stats.avgKmPerLiter !== null ? (
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13.5px] text-ink/85">
                    הממוצע שלך: <Num className="font-semibold">{average.value}</Num>{" "}
                    {average.unit}
                  </span>
                  <span className="text-[12px] text-muted">
                    <Num>{stats.segments.length}</Num>{" "}
                    {stats.segments.length === 1 ? "מקטע" : "מקטעים"} ·{" "}
                    <Num>{stats.records.fillupCount}</Num> תדלוקים
                  </span>
                </span>
              ) : (
                <span className="text-[13px] text-muted">
                  הצריכה תחושב אחרי שני תדלוקים
                </span>
              )}

              <OpenSegmentNote stats={stats} />
            </Card>

            <div className="tm-rise flex gap-3" style={{ animationDelay: "70ms" }}>
              <Card className="flex flex-1 flex-col gap-1.5 p-[14px_16px]">
                <Label className="text-[12.5px]">הוצאה החודש</Label>
                {/* dir="ltr" inside an RTL card left-aligns by default; the
                    amount belongs on the card's start edge, which is the right. */}
                <Num className="text-end text-[24px] font-bold leading-tight text-ink">
                  {shekel(stats.currentMonth?.cost ?? 0)}
                </Num>
                <span className="text-[12.5px] text-muted">
                  <Num>{stats.currentMonth?.count ?? 0}</Num> תדלוקים ·{" "}
                  {heMonthName(new Date().getMonth() + 1)}
                </span>
              </Card>

              <FuelPriceCard />
            </div>

            {/* Range needs a tank capacity the user actually confirmed. When
                there is none the strip is simply absent — nothing takes its
                place, least of all a regulated-price notice. */}
            {stats.estimatedRangeKm ? (
              <InfoStrip icon={<PumpIcon size={17} />}>
                טווח נסיעה משוער במיכל מלא: <Num>{num(stats.estimatedRangeKm, 0)}</Num> ק״מ
              </InfoStrip>
            ) : null}

            <div className="tm-rise" style={{ animationDelay: "170ms" }} />
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
              <ListCard className="tm-rise" style={{ animationDelay: "210ms" }}>
                {recent.map((fillup) => {
                  const kmPerLiter = consumptionByEndId.get(fillup.id) ?? null;
                  return (
                    <Link
                      key={fillup.id}
                      to={`/fillup/${fillup.id}`}
                      className="flex min-h-[58px] items-center justify-between gap-3 px-4 py-3 transition-[background-color] duration-150 active:bg-surface-2"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-[15px] font-semibold text-ink">
                          {fillup.station?.name || "ללא מיקום"}
                        </span>
                        <span className="text-[13px] text-muted">
                          {dayMonthShort(fillup.date)} · <Num>{num(fillup.liters, 1)}</Num> ל׳ ·{" "}
                          <Num>{shekel(fillup.totalCost)}</Num>
                        </span>
                      </span>

                      {!fillup.isFullTank ? (
                        <span className="flex-none rounded-pill border border-line px-[11px] py-1 text-[12.5px] font-semibold text-muted">
                          חלקי
                        </span>
                      ) : kmPerLiter !== null ? (
                        <ConsumptionValue
                          kmPerLiter={kmPerLiter}
                          units={units}
                          className="flex-none rounded-pill bg-success-soft px-[11px] py-1.5 text-[12.5px] font-semibold text-success-ink"
                        />
                      ) : (
                        <span className="flex-none rounded-pill bg-surface-2 px-[11px] py-1 text-[12.5px] font-semibold text-muted">
                          טנק מלא
                        </span>
                      )}
                    </Link>
                  );
                })}
              </ListCard>
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
            <b className="text-ink">צריכה אחרונה</b> — התוצאה של המקטע האחרון שנסגר.
          </span>
          <span>
            <b className="text-ink">הממוצע שלך</b> — ממוצע כל המקטעים, משוקלל לפי מרחק.
          </span>
          <span>
            חישוב לא חוצה נקודה שסימנתם בה תדלוקים שלא תועדו.
          </span>
        </div>
      </Sheet>
    </main>
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
      <span className="text-[13px] text-muted">
        עדיין אין נקודת התחלה. התדלוק הבא יפתח את החישוב.
      </span>
    );
  }

  if (open.pendingFillups === 0) return null;

  return (
    <span className="text-[13px] text-muted">
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
      <Skeleton className="h-[118px] rounded-hero" />
      <div className="flex gap-3">
        <Skeleton className="h-[92px] flex-1 rounded-card" />
        <Skeleton className="h-[92px] flex-1 rounded-card" />
      </div>
      <Skeleton className="h-[44px] rounded-[14px]" />
      <Skeleton className="h-[176px] rounded-card" />
    </div>
  );
}
