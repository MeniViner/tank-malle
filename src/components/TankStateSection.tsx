import { useState } from "react";
import { Card, IconTile } from "./Card";
import { Sheet } from "./Sheet";
import { TankGauge } from "./TankGauge";
import { Num } from "./Num";
import { CheckIcon, ChevronDown, GaugeIcon, InfoIcon } from "./icons";
import { derivePreFillLevel, projectAfterFill } from "../lib/tank/balance";
import { levelLabel } from "../lib/tank/gaugeInteraction";
import { EMPTY_TANK_DRAFT, type TankStateDraft } from "../lib/tank/draft";
import type { RefuelReason } from "../lib/tank/types";

/**
 * The optional tank-state interaction inside the fill-up form.
 *
 * Genuinely optional: someone recording odometer, litres, amount and station
 * can save without ever opening this. Nothing here blocks the financial record,
 * and no interaction means no observation — a skipped section produces no
 * training label rather than a fabricated one.
 */

const REASONS: { value: RefuelReason; label: string }[] = [
  { value: "routine", label: "כרגיל" },
  { value: "low-fuel", label: "הדלק נמוך" },
  { value: "before-trip", label: "לפני נסיעה ארוכה" },
  { value: "good-price", label: "מחיר משתלם / עצירה נוחה" },
  { value: "unsure", label: "לא בטוח" },
];

export function TankStateSection({
  draft,
  onChange,
  litersAdded,
  capacityLiters,
  capacityNote,
  onReviewCapacity,
}: {
  draft: TankStateDraft;
  onChange: (next: TankStateDraft) => void;
  litersAdded: number;
  /** Resolved capacity, or null when nothing supports one. */
  capacityLiters: number | null;
  /** Set when that capacity is an approximation, so the UI can say so. */
  capacityNote?: string | null;
  onReviewCapacity?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [editingAfter, setEditingAfter] = useState(false);

  const patch = (next: Partial<TankStateDraft>) => onChange({ ...draft, ...next });

  // The one place the after-state is computed. The component never writes its
  // own version of `before × capacity + litres`.
  const projection = projectAfterFill({
    beforeLevel: draft.beforeLevel,
    litersAdded,
    capacityLiters,
    confirmedFull: draft.confirmedFull,
  });

  const afterLevel = draft.afterLevelOverride ?? projection.level;
  const inconsistent = projection.state === "overCapacity";

  // Case C: a confirmed full plus the litres bought says what was in the tank,
  // even though the user never touched the gauge. Shown as a derived figure.
  const derivedBefore =
    draft.beforeLevel === null && draft.confirmedFull
      ? derivePreFillLevel(litersAdded, capacityLiters)
      : null;

  const hasAnswer =
    draft.beforeLevel !== null || draft.confirmedFull || draft.afterLevelOverride !== null;

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex min-h-[58px] items-center gap-2 px-4 py-2.5">
          <IconTile tone={hasAnswer ? "success" : "muted"}>
            <GaugeIcon size={18} />
          </IconTile>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 flex-col gap-0.5 py-1 text-start"
          >
            <span className="text-[15px] font-semibold text-ink">מצב המיכל</span>
            <span className="truncate text-[12px] text-muted">
              {hasAnswer
                ? summarise(draft, afterLevel)
                : "עוזר להעריך כמה נשאר וללמוד מתי אתם נוהגים לתדלק"}
            </span>
          </button>

          <button
            type="button"
            aria-label="מה זה מצב המיכל"
            aria-haspopup="dialog"
            onClick={() => setInfoOpen(true)}
            className="flex size-10 flex-none items-center justify-center rounded-full text-muted/70 transition-[color,scale] duration-200 active:scale-[0.96]"
          >
            <InfoIcon size={16} />
          </button>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? "סגירת מצב המיכל" : "פתיחת מצב המיכל"}
            aria-expanded={open}
            className="flex size-10 flex-none items-center justify-center rounded-full text-muted transition-[transform] duration-200"
          >
            <ChevronDown size={18} className={open ? "rotate-180" : ""} />
          </button>
        </div>

        {open ? (
          <div className="flex flex-col gap-4 border-t border-line p-4">
            {/* RTL: before on the right, after on the left. `flex-row-reverse`
                is not needed — the document is already RTL, so the first child
                lands on the right. */}
            <div className="flex items-start justify-center gap-5">
              <TankGauge
                label="לפני"
                ariaLabel="כמה דלק נשאר לפני התדלוק"
                level={draft.beforeLevel ?? derivedBefore}
                onChange={(level) => patch({ beforeLevel: level })}
                caption={
                  draft.beforeLevel === null && derivedBefore !== null
                    ? "משוער לפי הכמות"
                    : capacityLiters && draft.beforeLevel !== null
                      ? litersCaption(draft.beforeLevel * capacityLiters)
                      : undefined
                }
              />

              <TankGauge
                label="אחרי"
                ariaLabel="מצב המיכל אחרי התדלוק"
                level={afterLevel}
                onChange={editingAfter ? (level) => patch({ afterLevelOverride: level }) : undefined}
                confirmedFull={draft.confirmedFull}
                tone={inconsistent ? "warning" : "accent"}
                caption={
                  projection.liters !== null && !draft.confirmedFull
                    ? litersCaption(draft.afterLevelOverride !== null && capacityLiters
                        ? draft.afterLevelOverride * capacityLiters
                        : projection.liters)
                    : undefined
                }
              />
            </div>

            {/* One compact, explicit confirmation. Never selected on its own. */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                aria-pressed={draft.confirmedFull}
                onClick={() =>
                  patch({
                    confirmedFull: !draft.confirmedFull,
                    afterLevelOverride: null,
                  })
                }
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-pill px-4 text-[13.5px] font-bold transition-[background-color,scale] duration-200 active:scale-[0.97] ${
                  draft.confirmedFull
                    ? "bg-accent text-accent-contrast"
                    : "border border-line bg-surface text-ink"
                }`}
              >
                {draft.confirmedFull ? <CheckIcon size={15} /> : null}
                מילאתי מיכל מלא
              </button>

              {!draft.confirmedFull && afterLevel !== null ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingAfter(true);
                    if (draft.afterLevelOverride === null) patch({ afterLevelOverride: afterLevel });
                  }}
                  className="min-h-[44px] rounded-pill px-3 text-[13px] font-semibold text-accent"
                >
                  {editingAfter ? "אפשר לגרור את המד השמאלי" : "לא נראה נכון?"}
                </button>
              ) : null}
            </div>

            {inconsistent ? (
              <Reconciliation
                impliedLevel={projection.impliedLevel}
                onAdjustBefore={() =>
                  patch({
                    beforeLevel:
                      capacityLiters && capacityLiters > 0
                        ? Math.max(0, 1 - litersAdded / capacityLiters)
                        : null,
                  })
                }
                onMarkFull={() => patch({ confirmedFull: true, afterLevelOverride: null })}
                onReviewCapacity={onReviewCapacity}
                onDiscard={() => onChange(EMPTY_TANK_DRAFT)}
              />
            ) : null}

            {capacityLiters === null ? (
              <p className="text-[12.5px] leading-relaxed text-muted">
                בלי נפח מיכל אפשר לשמור את המצב באחוזים, אבל לא להציג ליטרים או טווח.
                אפשר להוסיף את הנפח בהגדרות הרכב מתי שנוח.
              </p>
            ) : capacityNote ? (
              <button
                type="button"
                onClick={onReviewCapacity}
                className="text-start text-[12px] leading-relaxed text-muted"
              >
                {capacityNote} · <span className="font-semibold text-accent">לאישור או תיקון</span>
              </button>
            ) : null}

            <details className="group">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-[13.5px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                למה תדלקת עכשיו? (לא חובה)
                <ChevronDown size={17} className="text-muted group-open:rotate-180" />
              </summary>
              <div className="flex flex-wrap gap-2 pt-2">
                {REASONS.map((reason) => (
                  <button
                    key={reason.value}
                    type="button"
                    aria-pressed={draft.reason === reason.value}
                    onClick={() =>
                      patch({ reason: draft.reason === reason.value ? null : reason.value })
                    }
                    className={`min-h-[40px] rounded-pill px-3.5 text-[13px] font-semibold transition-[background-color] duration-200 ${
                      draft.reason === reason.value
                        ? "bg-accent-soft text-accent"
                        : "border border-line bg-surface text-muted"
                    }`}
                  >
                    {reason.label}
                  </button>
                ))}
              </div>
            </details>

            {hasAnswer ? (
              <button
                type="button"
                onClick={() => {
                  onChange(EMPTY_TANK_DRAFT);
                  setEditingAfter(false);
                }}
                className="min-h-[44px] text-[13px] font-semibold text-muted"
              >
                ניקוי מצב המיכל
              </button>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Sheet
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title={<h2 className="text-[17px] font-bold text-ink">מצב המיכל</h2>}
      >
        <div className="flex flex-col gap-3 px-1 text-[13.5px] leading-relaxed text-ink/85">
          <span>
            עדכון קצר עוזר להעריך כמה דלק נשאר וללמוד מתי בדרך כלל תרצו לתדלק. אפשר לדלג
            ולעדכן בהמשך.
          </span>
          <span>
            ככל שמעדכנים מדי פעם כמה דלק נשאר, טנק מלא לומד טוב יותר מתי אתם בדרך כלל
            מתדלקים וכמה זמן צפוי להישאר עד התדלוק הבא.
          </span>
          <span className="text-muted">
            המד הוא הערכה גסה, לא מדידה מדויקת — וזה בסדר גמור. גם עדכון מדי פעם עוזר.
          </span>
        </div>
      </Sheet>
    </>
  );
}

function litersCaption(liters: number): string {
  return `כ־${Math.round(liters)} ליטר`;
}

function summarise(draft: TankStateDraft, afterLevel: number | null): string {
  const before = draft.beforeLevel !== null ? `לפני ${levelLabel(draft.beforeLevel)}` : null;
  const after = draft.confirmedFull
    ? "אחרי מלא"
    : afterLevel !== null
      ? `אחרי ${levelLabel(afterLevel)}`
      : null;
  return [before, after].filter(Boolean).join(" · ") || "עודכן";
}

/**
 * A physically impossible result, offered rather than silently clamped.
 *
 * The financial record is never touched by any of this: the worst outcome is
 * that the optional tank observation is dropped.
 */
function Reconciliation({
  impliedLevel,
  onAdjustBefore,
  onMarkFull,
  onReviewCapacity,
  onDiscard,
}: {
  impliedLevel: number | null;
  onAdjustBefore: () => void;
  onMarkFull: () => void;
  onReviewCapacity?: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-warning/40 bg-warning-soft p-3">
      <span className="text-[13px] font-semibold text-warning-ink">
        הנתונים לא לגמרי מסתדרים עם נפח המיכל
      </span>
      {impliedLevel !== null ? (
        <span className="text-[12.5px] text-warning-ink/85">
          לפי המצב שסימנת והכמות שמילאת יוצא <Num>{Math.round(impliedLevel * 100)}%</Num> —
          יותר ממיכל מלא.
        </span>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-0.5">
        <ReconcileAction label="התאמת המצב לפני" onClick={onAdjustBefore} />
        <ReconcileAction label="מילאתי מיכל מלא" onClick={onMarkFull} />
        {onReviewCapacity ? (
          <ReconcileAction label="בדיקת נפח המיכל" onClick={onReviewCapacity} />
        ) : null}
        <ReconcileAction label="המשך בלי מצב המיכל" onClick={onDiscard} />
      </div>
    </div>
  );
}

function ReconcileAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[40px] rounded-pill border border-warning/40 bg-surface px-3 text-[12.5px] font-semibold text-warning-ink"
    >
      {label}
    </button>
  );
}
