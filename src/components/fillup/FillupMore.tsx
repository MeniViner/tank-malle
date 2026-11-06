import { useState } from "react";
import { Gauge } from "../DesignPrimitives";
import { Toggle } from "../Segmented";
import { NumericText, NumRun, Percent, Quantity } from "../Fmt";
import { Sheet } from "../Sheet";
import { ChevronDown, InfoIcon, WarningIcon } from "../icons";
import { price } from "../../lib/format";
import { EMPTY_TANK_DRAFT, effectiveEndChoice, withEndChoice, type TankOutcome, type TankStateDraft } from "../../lib/tank/draft";
import type { ResolvedCapacity } from "../../lib/tank/capacity";

export interface FillupMoreProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tankDraft: TankStateDraft;
  onTankChange: (draft: TankStateDraft) => void;
  outcome: TankOutcome;
  capacity: ResolvedCapacity;
  capacityNote: string | null;
  onReviewCapacity: () => void;
  continuityBreak: boolean;
  onContinuityChange: (value: boolean) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  notesError?: string;
  legacyEndState: boolean;
  storedPostedPrice: number | null;
  clearStoredPosted: boolean;
  onClearStoredPosted: (clear: boolean) => void;
  postedPriceError?: string;
}

/** Optional readings remain controlled; disclosure state never changes their provenance. */
export function FillupMore({ open, onOpenChange, tankDraft,
  onTankChange, outcome, capacity, capacityNote, onReviewCapacity, continuityBreak,
  onContinuityChange, notes, onNotesChange, notesError, legacyEndState,
  storedPostedPrice, clearStoredPosted, onClearStoredPosted, postedPriceError,
}: FillupMoreProps) {
  const [editingAfter, setEditingAfter] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const choice = effectiveEndChoice(tankDraft);
  const confirmedFull = choice === "full";
  const patch = (next: Partial<TankStateDraft>) => onTankChange({ ...tankDraft, ...next });
  const resetReadings = () => {
    onTankChange(withEndChoice({ ...EMPTY_TANK_DRAFT, reason: tankDraft.reason }, choice));
    setEditingAfter(false);
  };
  const inconsistent = ["overCapacity", "capacitySuspect", "conflict"].includes(outcome.state);
  const hasReadings = tankDraft.beforeLevel !== null || tankDraft.afterLevelOverride !== null;
  const beforeSource = outcome.fields.preFillLevelSource;
  const afterSource = outcome.fields.postFillLevelSource;
  const afterCapacity = outcome.fields.capacityLitersAtEntry ?? capacity.liters;
  const beforeCaption = outcome.beforeIsDerived ? " · משוער לפי הכמות"
    : beforeSource === "direct-gauge" || beforeSource === "user-correction" ? " · לפי הסימון שלכם" : " · מהרשומה הקיימת";
  const afterCaption = afterSource === "user-correction" ? " · תיקון שלכם"
    : afterSource === "direct-gauge" ? " · לפי הסימון שלכם"
      : outcome.fields.postFillLevel !== null && (afterSource === "imported-legacy" || afterSource === "unknown" || afterSource === null)
        ? " · מהרשומה הקיימת" : " · מחושב לפי הכמות";

  return <section className="fillup-more" data-testid="fillup-more">
    <button type="button" className="fillup-disclosure" aria-expanded={open} aria-controls="fillup-more-content"
      data-testid="fillup-more-toggle" onClick={() => onOpenChange(!open)}>
      <span>עוד פרטים<small>מחוון דלק, רצף תדלוקים, הערה</small></span>
      <ChevronDown size={20} className={open ? "fillup-chevron-open" : ""} />
    </button>
    {open ? <div id="fillup-more-content" className="fillup-more-content">
      <div className="fillup-gauge-field">
        <div className="fillup-field-heading">
          <span>כמה היה במיכל לפני התדלוק? <small>(לא חובה)</small></span>
          <button type="button" className="tm-icon-button" aria-label="על עדכון מצב המיכל" onClick={() => setInfoOpen(true)}><InfoIcon size={18} /></button>
        </div>
        <Gauge value={outcome.displayBeforeLevel} label="כמה דלק נשאר לפני התדלוק" onChange={level => patch({ beforeLevel: level })} />
        <div className="fillup-gauge-caption">
          {outcome.displayBeforeLevel === null ? <span>הקישו על המחוון</span>
            : <span><Percent value={outcome.displayBeforeLevel * 100} />{beforeCaption}</span>}
          {tankDraft.beforeLevel !== null ? <button type="button" onClick={() => patch({ beforeLevel: null })}>ניקוי הסימון</button> : null}
        </div>
      </div>
      <div className="fillup-continuity-row">
        <span><b>פספסתי תדלוקים לפני זה</b><small>נתחיל מדידה חדשה מכאן, וההיסטוריה נשארת</small></span>
        <Toggle checked={continuityBreak} onChange={onContinuityChange} ariaLabel="פספסתי תדלוקים לפני זה" />
      </div>
      <label className="fillup-note-field" htmlFor="fillup-notes">הערה
        <textarea id="fillup-notes" data-testid="fillup-notes" value={notes} onChange={event => onNotesChange(event.currentTarget.value)}
          placeholder="למשל: שטיפה כלולה" rows={2} aria-invalid={notesError ? true : undefined}
          aria-describedby={notesError ? "fillup-notes-error" : undefined} />
        {notesError ? <span id="fillup-notes-error" className="fillup-error" role="alert"><NumericText>{notesError}</NumericText></span> : null}
      </label>
      {storedPostedPrice !== null ? <div className="fillup-previous-price" data-testid="fillup-previous-pump-price">
        <span>מחיר משאבה שאושר: <NumRun>{price(storedPostedPrice)}</NumRun></span>
        <button type="button" className="fillup-text-action" aria-pressed={clearStoredPosted} onClick={() => onClearStoredPosted(!clearStoredPosted)}>
          {clearStoredPosted ? "החזרת האישור הקודם" : "הסרת האישור"}
        </button>
        {clearStoredPosted ? <small>האישור יוסר בשמירה. המחיר ששילמתם לא ישתנה.</small> : null}
        {postedPriceError ? <span className="fillup-error" role="alert"><NumericText>{postedPriceError}</NumericText></span> : null}
      </div> : null}
      <details className="fillup-tank-advanced" data-testid="fillup-tank-advanced">
        <summary>מצב המיכל אחרי התדלוק <ChevronDown size={18} /></summary>
        <div className="fillup-tank-advanced-body">
          {legacyEndState ? <p className="fillup-small-status">מצב המיכל מהרשומה הקיימת יישאר כמו שנשמר, עד שתבחרו אחרת.</p> : null}
          <div className="fillup-chips">
            <button type="button" className="tm-chip" data-testid="fillup-end-unknown" aria-pressed={choice === "unknown"}
              onClick={() => onTankChange(withEndChoice(tankDraft, choice === "unknown" ? null : "unknown"))}>לא יודע</button>
            {choice !== null ? <button type="button" className="tm-chip" onClick={() => onTankChange(withEndChoice(tankDraft, null))}>ניקוי הבחירה</button> : null}
          </div>
          <Gauge value={outcome.displayAfterLevel} label="מצב המיכל אחרי התדלוק" low={inconsistent}
            onChange={editingAfter && !confirmedFull ? level => onTankChange({ ...withEndChoice(tankDraft, "partial"), afterLevelOverride: level }) : undefined} />
          <p className="fillup-small-status">
            {confirmedFull ? "מלא לפי הבחירה שלכם" : outcome.displayAfterLevel === null ? "עדיין אין הערכה"
              : <><Percent value={outcome.displayAfterLevel * 100} />{afterCaption}
                {afterCapacity ? <> · כ־<Quantity value={outcome.displayAfterLevel * afterCapacity} digits={1} /></> : null}</>}
          </p>
          {!confirmedFull ? <div className="fillup-chips">
            <button type="button" className="tm-chip" aria-expanded={editingAfter} onClick={() => setEditingAfter(!editingAfter)}>
              {editingAfter ? "סיום תיקון המד" : tankDraft.afterLevelOverride !== null ? "תיקון המד אחרי" : "לא נראה נכון?"}
            </button>
            {tankDraft.afterLevelOverride !== null ? <button type="button" className="tm-chip" onClick={() => patch({ afterLevelOverride: null })}>הסרת המד אחרי</button> : null}
          </div> : null}
          {inconsistent ? <div className="fillup-warning fillup-reconciliation" data-testid="fillup-tank-reconciliation">
            <WarningIcon size={18} /><div>
              <b>{outcome.state === "capacitySuspect" ? "נראה שנפח המיכל גדול מההערכה" : "הנתונים לא מסתדרים עם נפח המיכל"}</b>
              {outcome.message ? <p><NumericText>{outcome.message}</NumericText></p> : null}
              {outcome.impliedAfterLevel !== null && outcome.state !== "capacitySuspect" ? <p>לפי הסימון והכמות יוצא <Percent value={outcome.impliedAfterLevel * 100} />.</p> : null}
              <div className="fillup-chips">
                {outcome.state !== "conflict" ? <button type="button" className="tm-chip" onClick={() => patch({ beforeLevel:
                  capacity.liters && capacity.liters > 0 && outcome.impliedAfterLevel !== null
                    ? Math.max(0, (tankDraft.beforeLevel ?? 0) - (outcome.impliedAfterLevel - 1)) : null,
                })}>התאמת המצב לפני</button> : null}
                {!confirmedFull ? <button type="button" className="tm-chip" onClick={() => onTankChange(withEndChoice(tankDraft, "full"))}>מילאתי עד הסוף</button> : null}
                <button type="button" className="tm-chip" onClick={onReviewCapacity}>בדיקת נפח המיכל</button>
                <button type="button" className="tm-chip" onClick={resetReadings}>המשך בלי המדים</button>
              </div>
            </div>
          </div> : null}
          {capacity.liters === null ? <button type="button" className="fillup-text-action" onClick={onReviewCapacity}>הוספת נפח מיכל</button>
            : capacityNote ? <button type="button" className="fillup-text-action" onClick={onReviewCapacity}><NumericText>{capacityNote}</NumericText> · לאישור או תיקון</button> : null}
          {hasReadings ? <button type="button" className="fillup-text-action" onClick={resetReadings}>ניקוי המדים</button> : null}
        </div>
      </details>
    </div> : null}
    <Sheet open={infoOpen} onClose={() => setInfoOpen(false)} title="מצב המיכל">
      <p className="fillup-sheet-copy">הסימון הוא הערכה לפי המחוון ברכב. אפשר לשמור תדלוק גם בלעדיו ולעדכן בהמשך.</p>
      <p className="fillup-sheet-copy">הערכה מחושבת מבוססת על הסימון, הליטרים ונפח המיכל. נתון מהרשומה הקיימת נשמר כפי שנרשם. פתיחת התיקון אינה משנה את הנתונים.</p>
    </Sheet>
  </section>;
}
