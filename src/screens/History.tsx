import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useStats } from "../hooks/useStats";
import { Segmented } from "../components/Segmented";
import { Card, Skeleton } from "../components/Card";
import { Num } from "../components/Num";
import { ConsumptionValue } from "../components/Fmt";
import { PumpIcon, SearchIcon, WarningIcon } from "../components/icons";
import {
  heMonthShort,
  monthYear,
  num,
  shekel,
} from "../lib/format";
import { monthKey, type Fillup } from "../lib/stats";
import { resolveEndState } from "../lib/tank/observations";

/**
 * Scope, not classification.
 *
 * The old control filtered by "full tank" vs "partial" — an internal detail of
 * the consumption engine that nobody browsing their own history is looking
 * for. What people actually reach for is a period, so that is the control;
 * "needs a look" (records the engine flagged) is a separate toggle beside the
 * search, and it only exists when there is something to flag.
 */
type Period = "all" | "month" | "3m" | "year";

const PERIODS: { value: Period; label: string }[] = [
  { value: "all", label: "הכול" },
  { value: "month", label: "החודש" },
  { value: "3m", label: "3 חודשים" },
  { value: "year", label: "השנה" },
];

/** Inclusive lower bound of a period, or null for "everything". */
function periodStart(period: Period, now: number): number | null {
  const date = new Date(now);
  if (period === "month") return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  if (period === "3m") return new Date(date.getFullYear(), date.getMonth() - 2, 1).getTime();
  if (period === "year") return new Date(date.getFullYear(), 0, 1).getTime();
  return null;
}

/** History grouped by month (designs 14–16). */
export function History() {
  const navigate = useNavigate();
  const { settings, loadingFillups } = useData();
  const stats = useStats();

  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const anomalyIds = useMemo(
    () => new Set(stats.anomalies.map((anomaly) => anomaly.fillupId)),
    [stats.anomalies],
  );
  const consumptionByEndId = useMemo(
    () => new Map(stats.segments.map((segment) => [segment.endId, segment.kmPerLiter])),
    [stats.segments],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const from = periodStart(period, Date.now());
    return [...stats.fillups]
      .sort((a, b) => b.date - a.date)
      .filter((fillup) => {
        if (from !== null && fillup.date < from) return false;
        if (onlyFlagged && !anomalyIds.has(fillup.id)) return false;
        if (!term) return true;
        return (
          (fillup.station?.name ?? "").toLowerCase().includes(term) ||
          (fillup.notes ?? "").toLowerCase().includes(term)
        );
      });
  }, [stats.fillups, query, period, onlyFlagged, anomalyIds]);

  // Group into months, preserving the newest-first order.
  const groups = useMemo(() => {
    const map = new Map<string, Fillup[]>();
    for (const fillup of filtered) {
      const key = monthKey(fillup.date);
      const list = map.get(key);
      if (list) list.push(fillup);
      else map.set(key, [fillup]);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <main className="flex flex-1 flex-col pb-[104px] pt-safe">
      <header className="flex flex-none items-baseline justify-between gap-2 px-5 pb-2 pt-4">
        <h1 className="text-[22px] font-bold text-ink">היסטוריה</h1>
        <span className="text-[13px] text-muted">
          <Num>{stats.records.fillupCount}</Num> תדלוקים
        </span>
      </header>

      {stats.fillups.length > 0 ? (
        <div className="flex flex-none flex-col gap-2.5 px-5 pb-3">
          <div className="flex min-h-[46px] items-center gap-2 rounded-[14px] border border-line bg-surface px-3.5">
            <SearchIcon size={17} className="text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="חיפוש תחנה או הערה…"
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Segmented
                size="sm"
                value={period}
                options={PERIODS}
                onChange={setPeriod}
                ariaLabel="טווח זמן"
              />
            </div>
            {stats.anomalies.length > 0 ? (
              <button
                type="button"
                aria-pressed={onlyFlagged}
                onClick={() => setOnlyFlagged((value) => !value)}
                className={`flex min-h-[36px] flex-none items-center gap-1.5 rounded-pill px-3 text-[12.5px] font-semibold transition-[background-color,color] duration-200 ${
                  onlyFlagged
                    ? "bg-warning-soft text-warning-ink"
                    : "border border-line bg-surface text-muted"
                }`}
              >
                <WarningIcon size={14} />
                לבדיקה
                <Num>{stats.anomalies.length}</Num>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 px-5">
        {loadingFillups ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-[196px] rounded-card" />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-[132px] rounded-card" />
          </div>
        ) : stats.fillups.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <Card className="px-6 py-10 text-center text-[14px] text-muted">
            לא נמצאו תדלוקים תואמים
          </Card>
        ) : (
          groups.map(([key, list]) => {
            const monthCost = list.reduce((sum, fillup) => sum + fillup.totalCost, 0);
            const monthLiters = list.reduce((sum, fillup) => sum + fillup.liters, 0);

            return (
              <section key={key} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between px-1">
                  <h2 className="text-[15px] font-bold text-ink">{monthYear(key)}</h2>
                  <span className="text-[12.5px] text-muted">
                    <Num>{shekel(monthCost)}</Num> · <Num>{num(monthLiters, 1)}</Num> ל׳
                  </span>
                </div>

                <Card className="overflow-hidden">
                  {list.map((fillup, index) => {
                    const kmPerLiter = consumptionByEndId.get(fillup.id) ?? null;
                    const date = new Date(fillup.date);
                    // "חלקי" and "לא ידוע" are different claims: one says the
                    // tank was not filled, the other says nobody stated either
                    // way. The boolean projection cannot tell them apart.
                    const endLabel = endStateLabel(fillup);

                    return (
                      <Fragment key={fillup.id}>
                        {fillup.continuityBreakBefore ? (
                          <div
                            className={`flex items-center gap-2 bg-surface-2 px-3.5 py-2 ${
                              index > 0 ? "border-t border-line" : ""
                            }`}
                          >
                            <span className="h-px flex-1 bg-line" />
                            <span className="flex-none text-[11.5px] font-semibold text-muted">
                              התחלת תקופה חדשה
                            </span>
                            <span className="h-px flex-1 bg-line" />
                          </div>
                        ) : null}
                      {/* The whole row navigates straight to the record's own
                          editor. The intermediate sheet only ever offered
                          "edit", "change station" — which was the same screen —
                          and "delete", which lives there too. */}
                      <button
                        type="button"
                        onClick={() => navigate(`/fillup/${fillup.id}`)}
                        className={`flex min-h-[66px] w-full items-center gap-3 px-3.5 py-3 text-start transition-[background-color] duration-150 active:bg-surface-2 ${
                          index > 0 && !fillup.continuityBreakBefore
                            ? "border-t border-line"
                            : ""
                        }`}
                      >
                        <span className="flex w-[38px] flex-none flex-col items-center">
                          <Num className="text-[17px] font-bold leading-none text-ink">
                            {date.getDate()}
                          </Num>
                          <span className="text-[11.5px] text-muted">
                            {heMonthShort(date.getMonth() + 1)}
                          </span>
                        </span>

                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[15px] font-semibold text-ink">
                              {fillup.station?.name || "ללא מיקום"}
                            </span>
                            {anomalyIds.has(fillup.id) ? (
                              <span className="flex-none rounded-pill bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning-ink">
                                חריג
                              </span>
                            ) : null}
                          </span>
                          <span className="truncate text-[12.5px] text-muted">
                            <Num>{num(fillup.liters, 1)}</Num> ל׳ ·{" "}
                            <Num>{shekel(fillup.totalCost)}</Num>
                          </span>
                          {/* Mileage as its own small metric, distinct from
                              fuel economy — they are different numbers and
                              used to share a line. */}
                          <span className="truncate text-[11.5px] text-muted/80">
                            <Num>{num(fillup.odometer, 0)}</Num> ק״מ
                          </span>
                        </span>

                        {endLabel !== null ? (
                          <span className="flex-none rounded-pill border border-line px-[11px] py-1 text-[12px] font-semibold text-muted">
                            {endLabel}
                          </span>
                        ) : kmPerLiter !== null ? (
                          <ConsumptionValue
                            kmPerLiter={kmPerLiter}
                            units={settings.units}
                            className="flex-none rounded-pill bg-success-soft px-[11px] py-1.5 text-[12px] font-semibold text-success-ink"
                          />
                        ) : null}
                      </button>
                      </Fragment>
                    );
                  })}
                </Card>
              </section>
            );
          })
        )}
      </div>

    </main>
  );
}

/**
 * The chip a row shows instead of a consumption figure.
 *
 * Null means "show the consumption figure". A legacy record answers from its
 * boolean exactly as before; a new record can also say that nobody stated the
 * end state, which is not the same as declaring a partial fill.
 */
function endStateLabel(fillup: Fillup): string | null {
  const { state, source } = resolveEndState(fillup);
  if (state === "full") return null;
  if (state === "unknown" && source !== "legacy-assumption") return "לא צוין";
  return "חלקי";
}

function EmptyState() {
  return (
    <Card className="flex flex-col items-center gap-3 px-7 py-12 text-center">
      <span className="flex size-[64px] items-center justify-center rounded-[22px] bg-accent-soft text-accent">
        <PumpIcon size={30} />
      </span>
      <span className="text-[17px] font-bold text-ink">אין עדיין תדלוקים</span>
      <span className="max-w-[260px] text-[13.5px] leading-relaxed text-muted">
        הוסיפו תדלוק ראשון כדי להתחיל.
      </span>
    </Card>
  );
}
