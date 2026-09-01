import { Link } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useStats } from "../hooks/useStats";
import { AppHeader } from "../components/AppHeader";
import { Card, Label, ListCard, SectionTitle, Skeleton } from "../components/Card";
import { InfoStrip } from "../components/Field";
import { Num } from "../components/Num";
import { Quantity, SignedPercent } from "../components/Fmt";
import {
  ArrowDown,
  ArrowUp,
  CalendarIcon,
  InfoIcon,
  PumpIcon,
} from "../components/icons";
import {
  consumption,
  dayMonthShort,
  fullDate,
  heMonthName,
  num,
  price,
  shekel,
} from "../lib/format";

/** Home dashboard (design 09 / 21). */
export function Home() {
  const { settings, fillups, loadingFillups, prices, activeVehicle } = useData();
  const stats = useStats();
  const units = settings.units;

  const hero = consumption(stats.lastSegment?.kmPerLiter ?? null, units);
  const average = consumption(stats.avgKmPerLiter, units);
  const delta = stats.lastVsAvgPercent;
  const better = delta !== null && delta >= 0;

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
            {/* Hero: last segment's consumption vs. the vehicle average. */}
            <Card className="tm-rise flex flex-col gap-2 rounded-hero p-[17px_18px_15px]">
              <span className="flex items-center justify-between">
                <Label>צריכה אחרונה</Label>
                <InfoIcon size={16} className="text-muted/70" />
              </span>

              <span className="flex flex-wrap items-center gap-3">
                <span className="flex items-baseline gap-1.5">
                  <Num className="text-[34px] font-bold leading-none text-accent">
                    {hero.value}
                  </Num>
                  <span className="text-[16px] font-semibold text-muted">{hero.unit}</span>
                </span>

                {delta !== null && Math.abs(delta) >= 0.5 ? (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-pill px-[11px] py-1 text-[12.5px] font-semibold ${
                      better
                        ? "bg-success-soft text-success-ink"
                        : "bg-danger-soft text-danger-ink"
                    }`}
                  >
                    {better ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                    <SignedPercent value={delta} />
                    {better ? "מעל הממוצע" : "מתחת לממוצע"}
                  </span>
                ) : null}
              </span>

              <span className="text-[13px] text-muted">
                {stats.avgKmPerLiter !== null ? (
                  <>
                    ממוצע הרכב: <Num>{average.value}</Num> {average.unit} · מבוסס על{" "}
                    <Num>{stats.segments.length}</Num>{" "}
                    {stats.segments.length === 1 ? "מקטע צריכה" : "מקטעי צריכה"} ·{" "}
                    <Num>{stats.records.fillupCount}</Num> תדלוקים
                  </>
                ) : (
                  "הצריכה תחושב אחרי שני תדלוקים שבסיומם המיכל היה מלא"
                )}
              </span>

              <OpenSegmentNote stats={stats} />
            </Card>

            <div className="tm-rise flex gap-3" style={{ animationDelay: "70ms" }}>
              <Card className="flex flex-1 flex-col gap-1.5 p-[14px_16px]">
                <Label className="text-[12.5px]">הוצאה החודש</Label>
                <Num className="text-[24px] font-bold leading-tight text-ink">
                  {shekel(stats.currentMonth?.cost ?? 0)}
                </Num>
                <span className="text-[12.5px] text-muted">
                  <Num>{stats.currentMonth?.count ?? 0}</Num> תדלוקים ·{" "}
                  {heMonthName(new Date().getMonth() + 1)}
                </span>
              </Card>

              <Card className="flex flex-1 flex-col gap-1.5 p-[14px_16px]">
                <Label className="text-[12.5px]">מחיר דלק נוכחי</Label>
                <span className="flex items-baseline gap-1.5">
                  <Num className="text-[24px] font-bold leading-tight text-ink">
                    {prices?.current ? price(prices.current.pricePerLiter) : "—"}
                  </Num>
                  <span className="text-[12px] text-muted">לליטר</span>
                </span>
                <span className="truncate text-[12.5px] text-muted">
                  {prices?.current?.updatedAt
                    ? `עודכן ${dayMonthShort(prices.current.updatedAt)}`
                    : "לא עודכן עדיין"}
                </span>
              </Card>
            </div>

            {activeVehicle?.tankLiters && stats.estimatedRangeKm ? (
              <InfoStrip icon={<PumpIcon size={17} />}>
                טווח נסיעה משוער במיכל מלא: <Num>{num(stats.estimatedRangeKm, 0)}</Num> ק״מ
              </InfoStrip>
            ) : (
              <NextPriceStrip />
            )}

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
                <span className="text-[16px] font-bold text-ink">עוד אין תדלוקים</span>
                <span className="max-w-[250px] text-[13.5px] leading-relaxed text-muted">
                  הוסיפו את התדלוק הראשון בלחיצה על כפתור התדלוק — זה לוקח בערך 15 שניות.
                </span>
              </Card>
            ) : (
              <ListCard className="tm-rise" style={{ animationDelay: "210ms" }}>
                {recent.map((fillup) => {
                  const kmPerLiter = consumptionByEndId.get(fillup.id) ?? null;
                  const formatted = consumption(kmPerLiter, units);
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
                        <Num className="flex-none rounded-pill bg-success-soft px-[11px] py-1.5 text-[12.5px] font-semibold text-success-ink">
                          {formatted.value} {formatted.unit}
                        </Num>
                      ) : (
                        <span className="flex-none rounded-pill bg-surface-2 px-[11px] py-1 text-[12.5px] font-semibold text-muted">
                          מיכל מלא
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
    </main>
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
        עדיין אין נקודת התחלה. סמנו “מילאתי עד מלא” בתדלוק הבא כדי להתחיל חישוב.
      </span>
    );
  }

  if (open.pendingFillups === 0) return null;

  return (
    <span className="text-[13px] text-muted">
      במקטע הפתוח נשמרו <Quantity value={open.liters} digits={1} /> מ־
      <Num>{open.pendingFillups}</Num>{" "}
      {open.pendingFillups === 1 ? "תדלוק חלקי" : "תדלוקים חלקיים"} — הם ייכללו בחישוב
      במילוי הבא עד מלא.
    </span>
  );
}

/**
 * Freshness of the regulated maximum price.
 *
 * It used to promise "the official price will update on the 1st of the month",
 * which no component in the running system actually does: the scheduled updater
 * is written but undeployed (Spark). This reports what is true instead.
 */
function NextPriceStrip() {
  const { prices } = useData();
  const updatedAt = prices?.current?.updatedAt ?? null;
  const thisMonth = updatedAt !== null && new Date(updatedAt).getMonth() === new Date().getMonth()
    && new Date(updatedAt).getFullYear() === new Date().getFullYear();

  return (
    <InfoStrip icon={<CalendarIcon size={17} />}>
      {updatedAt === null
        ? "מחיר מרבי מפוקח לבנזין 95 בשירות עצמי — עדיין לא הוזן"
        : thisMonth
          ? `המחיר המרבי המפוקח עודכן ידנית ב־${fullDate(updatedAt)}`
          : `המחיר המרבי המפוקח לא עודכן החודש · עדכון אחרון ${fullDate(updatedAt)}`}
    </InfoStrip>
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
