import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useStats } from "../hooks/useStats";
import { useToast } from "../context/ToastContext";
import { Segmented } from "../components/Segmented";
import { Sheet, ConfirmDialog } from "../components/Sheet";
import { Card, Skeleton } from "../components/Card";
import { Num } from "../components/Num";
import { ConsumptionValue } from "../components/Fmt";
import {
  ChevronStart,
  PencilIcon,
  PinIcon,
  PumpIcon,
  SearchIcon,
  TrashIcon,
} from "../components/icons";
import {
  heMonthShort,
  monthYear,
  num,
  shekel,
} from "../lib/format";
import { monthKey, type Fillup } from "../lib/stats";

type Filter = "all" | "full" | "partial" | "anomaly";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "הכול" },
  { value: "full", label: "טנק מלא" },
  { value: "partial", label: "חלקי" },
  { value: "anomaly", label: "חריגים" },
];

/** History grouped by month (designs 14–16). */
export function History() {
  const navigate = useNavigate();
  const { settings, loadingFillups, deleteFillup, restoreFillup } = useData();
  const { showToast } = useToast();
  const stats = useStats();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Fillup | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Fillup | null>(null);

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
    return [...stats.fillups]
      .sort((a, b) => b.date - a.date)
      .filter((fillup) => {
        if (filter === "full" && !fillup.isFullTank) return false;
        if (filter === "partial" && fillup.isFullTank) return false;
        if (filter === "anomaly" && !anomalyIds.has(fillup.id)) return false;
        if (!term) return true;
        return (
          (fillup.station?.name ?? "").toLowerCase().includes(term) ||
          (fillup.notes ?? "").toLowerCase().includes(term)
        );
      });
  }, [stats.fillups, query, filter, anomalyIds]);

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

  async function remove(fillup: Fillup) {
    const snapshot: Fillup = { ...fillup };
    setConfirmDelete(null);
    setSelected(null);
    await deleteFillup(fillup.id);
    showToast({
      tone: "success",
      title: "התדלוק נמחק",
      detail: "הצריכה חושבה מחדש",
      undoLabel: "שחזור",
      duration: 5000,
      onUndo: () => restoreFillup(snapshot),
    });
  }

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
          <Segmented
            size="sm"
            value={filter}
            options={FILTERS}
            onChange={setFilter}
            ariaLabel="סינון תדלוקים"
          />
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
                      <button
                        type="button"
                        onClick={() => setSelected(fillup)}
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
                            <Num>{shekel(fillup.totalCost)}</Num> ·{" "}
                            {fillup.isFullTank ? "טנק מלא" : "תדלוק חלקי"}
                          </span>
                        </span>

                        {!fillup.isFullTank ? (
                          <span className="flex-none rounded-pill border border-line px-[11px] py-1 text-[12px] font-semibold text-muted">
                            חלקי
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

      {/* Row action sheet (design 15). */}
      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={
          selected ? (
            <div className="flex flex-col gap-1 pb-1">
              <span className="text-[16px] font-bold text-ink">
                {selected.station?.name || "ללא מיקום"}
              </span>
              <span className="text-[13px] text-muted">
                <Num>{new Date(selected.date).getDate()}</Num>{" "}
                {heMonthShort(new Date(selected.date).getMonth() + 1)} ·{" "}
                <Num>{num(selected.liters, 1)}</Num> ל׳ ·{" "}
                <Num>{shekel(selected.totalCost)}</Num>
              </span>
            </div>
          ) : null
        }
      >
        <div className="flex flex-col">
          <SheetAction
            icon={<PencilIcon size={19} />}
            label="עריכת פרטי התדלוק"
            onClick={() => {
              if (selected) navigate(`/fillup/${selected.id}`);
              setSelected(null);
            }}
          />
          <SheetAction
            icon={<PinIcon size={19} />}
            label="שינוי תחנה"
            onClick={() => {
              if (selected) navigate(`/fillup/${selected.id}`);
              setSelected(null);
            }}
          />
          <SheetAction
            icon={<TrashIcon size={19} />}
            label="מחיקת רשומה"
            tone="danger"
            onClick={() => setConfirmDelete(selected)}
          />

          <button
            type="button"
            onClick={() => setSelected(null)}
            className="mt-2 min-h-[52px] rounded-pill bg-surface-2 text-[15px] font-bold text-ink transition-[background-color,scale] duration-200 active:scale-[0.97]"
          >
            סגירה
          </button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="למחוק את התדלוק?"
        body="הרשומה תוסר והצריכה של הקטע תחושב מחדש אוטומטית."
        confirmLabel="מחיקה"
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </main>
  );
}

function SheetAction({
  icon,
  label,
  onClick,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[56px] items-center gap-3 rounded-[12px] border-b border-line px-2 text-start transition-[background-color] duration-150 last:border-b-0 active:bg-surface-2"
    >
      <span className={tone === "danger" ? "text-danger" : "text-muted"}>{icon}</span>
      <span
        className={`flex-1 text-[15px] font-semibold ${
          tone === "danger" ? "text-danger" : "text-ink"
        }`}
      >
        {label}
      </span>
      <ChevronStart size={17} className="text-muted" />
    </button>
  );
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
