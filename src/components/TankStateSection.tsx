import { useState } from "react";
import { Card, IconTile } from "./Card";
import { Sheet } from "./Sheet";
import { TankGauge } from "./TankGauge";
import { Num } from "./Num";
import { ChevronDown, GaugeIcon, InfoIcon } from "./icons";
import { levelLabel } from "../lib/tank/gaugeInteraction";
import {
  EMPTY_TANK_DRAFT,
  effectiveEndChoice,
  withEndChoice,
  type TankOutcome,
  type TankStateDraft,
} from "../lib/tank/draft";
import type { ResolvedCapacity } from "../lib/tank/capacity";
import type { RefuelReason } from "../lib/tank/types";

/**
 * The optional before/after gauges inside the fill-up form.
 *
 * Genuinely optional: someone recording odometer, litres, amount and station
 * can save without ever opening this. The end state (full / partial /
 * unknown) is chosen at form level; this section only adds the gauges and
 * the reason. It computes NOTHING about fuel: every number it shows comes
 * from the one `TankOutcome` the form resolved, the same one that is stored.
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
  outcome,
  capacity,
  capacityNote,
  onReviewCapacity,
}: {
  draft: TankStateDraft;
  onChange: (next: TankStateDraft) => void;
  /** The canonical outcome for the current draft, litres and capacity. */
  outcome: TankOutcome;
  capacity: ResolvedCapacity;
  /** Set when that capacity is an approximation, so the UI can say so. */
  capacityNote?: string | null;
  onReviewCapacity?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  /**
   * The after-gauge editor being open is a UI state. It is NOT a correction:
   * only an actual drag or key press sets `afterLevelOverride`, so opening
   * and closing the editor leaves the payload and its provenance untouched.
   */
  const [editingAfter, setEditingAfter] = useState(false);

  const patch = (next: Partial<TankStateDraft>) => onChange({ ...draft, ...next });

  const capacityLiters = capacity.liters;
  const endChoice = effectiveEndChoice(draft);
  const confirmedFull = endChoice === "full";
  const afterLevel = outcome.displayAfterLevel;
  const inconsistent =
    outcome.state === "overCapacity" ||
    outcome.state === "capacitySuspect" ||
    outcome.state === "conflict";

  const hasAnswer =
    draft.beforeLevel !== null || draft.afterLevelOverride !== null || draft.reason !== null;

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
            <span className="text-[15px] font-semibold text-ink">מד הדלק לפני ואחרי</span>
            <span className="truncate text-[12px] text-muted">
              {hasAnswer || confirmedFull
                ? summarise(draft, afterLevel, confirmedFull)
                : "לא חובה · עוזר להעריך כמה נשאר וללמוד מתי אתם נוהגים לתדלק"}
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
            <div className="flex items-start justify-center gap-5">
              <TankGauge
                label="לפני"
                ariaLabel="כמה דלק נשאר לפני התדלוק"
                level={outcome.displayBeforeLevel}
                onChange={(level) => patch({ beforeLevel: level })}
                caption={
                  outcome.beforeIsDerived
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
                onChange={
                  editingAfter && !confirmedFull
                    ? (level) => patch({ afterLevelOverride: level })
                    : undefined
                }
                confirmedFull={confirmedFull}
                tone={inconsistent ? "warning" : "accent"}
                caption={
                  outcome.state === "unknownLiters"
                    ? "הזינו ליטרים כדי לחשב"
                    : afterLevel !== null && capacityLiters && !confirmedFull
                      ? litersCaption(afterLevel * capacityLiters)
                      : undefined
                }
              />
            </div>

            {!confirmedFull && afterLevel !== null ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {editingAfter ? (
                  <>
                    <span className="text-[13px] text-muted">אפשר לגרור את המד השמאלי</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAfter(false);
                        patch({ afterLevelOverride: null });
                      }}
                      className="min-h-[44px] rounded-pill px-3 text-[13px] font-semibold text-accent"
                    >
                      {draft.afterLevelOverride !== null ? "ביטול התיקון" : "סגירה"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingAfter(true)}
                    className="min-h-[44px] rounded-pill px-3 text-[13px] font-semibold text-accent"
                  >
                    {draft.afterLevelOverride !== null ? "תיקון המד אחרי" : "לא נראה נכון?"}
                  </button>
                )}
              </div>
            ) : null}

            {inconsistent ? (
              <Reconciliation
                message={outcome.message}
                impliedLevel={outcome.impliedAfterLevel}
                state={outcome.state}
                onAdjustBefore={
                  outcome.state !== "conflict"
                    ? () =>
                        patch({
                          beforeLevel:
                            capacityLiters && capacityLiters > 0 && outcome.impliedAfterLevel !== null
                              ? Math.max(
                                  0,
                                  (draft.beforeLevel ?? 0) - (outcome.impliedAfterLevel - 1),
                                )
                              : null,
                        })
                    : undefined
                }
                onMarkFull={
                  !confirmedFull ? () => onChange(withEndChoice(draft, "full")) : undefined
                }
                onReviewCapacity={onReviewCapacity}
                onDiscard={() => onChange(withEndChoice(EMPTY_TANK_DRAFT, endChoice))}
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
                  // Clears the gauges and the reason; the end choice made at
                  // form level is the user's and stays.
                  onChange(withEndChoice(EMPTY_TANK_DRAFT, endChoice));
                  setEditingAfter(false);
                }}
                className="min-h-[44px] text-[13px] font-semibold text-muted"
              >
                ניקוי המדים
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

function summarise(draft: TankStateDraft, afterLevel: number | null, confirmedFull: boolean): string {
  const before = draft.beforeLevel !== null ? `לפני ${levelLabel(draft.beforeLevel)}` : null;
  const after = confirmedFull
    ? "אחרי מלא"
    : afterLevel !== null
      ? `אחרי ${levelLabel(afterLevel)}`
      : null;
  return [before, after].filter(Boolean).join(" · ") || "עודכן";
}

/**
 * A result that does not add up, offered rather than silently clamped.
 *
 * The financial record is never touched by any of this: the worst outcome is
 * that the optional tank observation is dropped.
 */
function Reconciliation({
  message,
  impliedLevel,
  state,
  onAdjustBefore,
  onMarkFull,
  onReviewCapacity,
  onDiscard,
}: {
  message: string | null;
  impliedLevel: number | null;
  state: TankOutcome["state"];
  onAdjustBefore?: () => void;
  onMarkFull?: () => void;
  onReviewCapacity?: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-warning/40 bg-warning-soft p-3">
      <span className="text-[13px] font-semibold text-warning-ink">
        {state === "capacitySuspect"
          ? "נראה שנפח המיכל גדול מההערכה"
          : "הנתונים לא לגמרי מסתדרים עם נפח המיכל"}
      </span>
      {message ? <span className="text-[12.5px] text-warning-ink/85">{message}</span> : null}
      {impliedLevel !== null && state !== "capacitySuspect" ? (
        <span className="text-[12.5px] text-warning-ink/85">
          לפי המצב שסימנת והכמות שמילאת יוצא <Num>{Math.round(impliedLevel * 100)}%</Num> —
          יותר ממיכל מלא.
        </span>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-0.5">
        {onAdjustBefore ? <ReconcileAction label="התאמת המצב לפני" onClick={onAdjustBefore} /> : null}
        {onMarkFull ? <ReconcileAction label="מילאתי מיכל מלא" onClick={onMarkFull} /> : null}
        {onReviewCapacity ? (
          <ReconcileAction label="בדיקת נפח המיכל" onClick={onReviewCapacity} />
        ) : null}
        <ReconcileAction label="המשך בלי המדים" onClick={onDiscard} />
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
