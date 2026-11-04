import { useEffect, useRef } from "react";
import type { DraftEvaluation, Fillup, Segment } from "../../lib/stats";
import type { Units } from "../../lib/types";
import { consumption, num, price } from "../../lib/format";
import { consumptionComparison } from "../../lib/consumptionPresentation";
import { Button } from "../Button";
import { CloseIcon, CheckIcon } from "../icons";
import { ConsumptionValue, Distance, Money, NumRun, NumericText, Percent, Quantity } from "../Fmt";

export interface SavedFillupResult {
  written: Readonly<Fillup>;
  evaluation: DraftEvaluation;
  segment: Segment | null;
  average: number | null;
  manufacturer: number | null;
  manufacturerLabel: string;
  personalBest: boolean;
  costKnown: boolean;
  historyComplete: boolean;
}
export type SavedWriteState = "pending" | "accepted" | "attention";
export type PumpWriteState = "idle" | "journaling" | "pending" | "accepted" | "attention";

export interface FillupSavedProps {
  result: SavedFillupResult;
  units: Units;
  deadline: number;
  secondsLeft: number;
  writeState: SavedWriteState;
  undoBusy: boolean;
  onUndo: () => void;
  onDone: () => void;
  onReviewWrite: () => void;
  canConfirm: boolean;
  pumpDifferent: boolean;
  pumpPrice: string;
  onPumpPrice: (value: string) => void;
  onSamePrice: () => void;
  onDifferentPrice: () => void;
  onSavePumpPrice: () => void;
  pumpWriteState: PumpWriteState;
  pumpError: string | null;
  pumpScopeKind: "catalog" | "name" | "receipt" | null;
  ruleStatus: "loading" | "ready" | "unavailable";
}

/** All mutations and their lifetime locks belong to the controller. */
export function FillupSaved({ result, units, deadline, secondsLeft, writeState, undoBusy,
  onUndo, onDone, onReviewWrite, canConfirm, pumpDifferent, pumpPrice, onPumpPrice,
  onSamePrice, onDifferentPrice, onSavePumpPrice, pumpWriteState, pumpError, pumpScopeKind,
  ruleStatus,
}: FillupSavedProps) {
  const segment = result.historyComplete ? result.segment : null;
  const comparison = consumptionComparison(segment?.kmPerLiter ?? null, result.average);
  const shown = consumption(segment?.kmPerLiter ?? null, units);
  const busy = pumpWriteState === "journaling" || pumpWriteState === "pending";
  const answered = pumpWriteState === "accepted" || pumpWriteState === "attention";
  const retainedPosted = result.written.postedPricePerLiter != null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const pumpResultRef = useRef<HTMLParagraphElement>(null);
  const pumpHadFocus = useRef(false);
  const undoHadFocus = useRef(false);
  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => {
    if (secondsLeft > 0 || !undoHadFocus.current) return;
    undoHadFocus.current = false;
    if (document.activeElement === document.body) {
      footerRef.current?.querySelector<HTMLButtonElement>('[data-testid="fillup-saved-done"]')?.focus();
    }
  }, [secondsLeft]);
  useEffect(() => {
    if (answered && pumpHadFocus.current && document.hasFocus() && document.activeElement === document.body) {
      pumpResultRef.current?.focus();
    }
  }, [answered]);

  return <main className="fillup-saved" data-testid="fillup-saved" data-undo-deadline={deadline}
    data-write-state={writeState}>
    <div className="fillup-saved-content">
      <header className="fillup-saved-header">
        <h1 ref={headingRef} tabIndex={-1} className="fillup-saved-stamp"><span><CheckIcon size={18} /></span>נשמר</h1>
        <button type="button" className="tm-icon-button" aria-label="סגירת מסך השמירה" onClick={onDone}><CloseIcon size={20} /></button>
      </header>
      <div className="fillup-saved-write-state" data-testid="fillup-saved-status" role="status">
        {writeState === "pending" ? "נשמר במכשיר · ממתין לאישור מהענן" : writeState === "attention"
          ? <button type="button" onClick={onReviewWrite}>השמירה דורשת בדיקה</button> : ""}
      </div>

      {segment ? <>
        <section className="fillup-saved-hero" data-testid="fillup-saved-segment">
          <NumRun block className="fillup-saved-number">{shown.value}</NumRun>
          <p className="fillup-saved-unit"><NumericText>{units === "kmPerLiter" ? "ק״מ לליטר במקטע שנסגר" : "ל׳ ל-100 ק״מ במקטע שנסגר"}</NumericText></p>
          {result.personalBest ? <p>השיא שלך עד היום</p> : comparison ? <p data-testid="fillup-saved-comparison">
            {comparison.tone === "neutral" ? "בדיוק כמו הרגיל שלך" : <><Percent value={comparison.percent} /> {comparison.tone === "worse" ? "יותר" : "פחות"} דלק לק״מ מהרגיל שלך</>}
          </p> : null}
        </section>
        <dl className="fillup-saved-comparisons">
          {result.average !== null ? <div><dt>הממוצע שלך</dt><dd><ConsumptionValue kmPerLiter={result.average} units={units} /></dd></div> : null}
          {result.manufacturer !== null ? <div><dt>{result.manufacturerLabel}</dt><dd><ConsumptionValue kmPerLiter={result.manufacturer} units={units} /></dd></div> : null}
          <div><dt>המקטע</dt><dd><Distance value={segment.km} /> · <Quantity value={segment.liters} digits={1} /></dd></div>
          <div><dt>עלות לק״מ</dt><dd>{result.costKnown ? <><NumRun>{num(segment.cost / segment.km * 100, 0)}</NumRun> אג׳</> : <NumRun>—</NumRun>}</dd></div>
        </dl>
        {!result.costKnown ? <p className="fillup-saved-note">עלות חסרה באחד התדלוקים במקטע.</p> : null}
      </> : <section className="fillup-saved-hero" data-testid="fillup-saved-open" data-outcome={result.evaluation.outcome}>
        <NumRun block className="fillup-saved-liters">{num(result.written.liters, 1)}</NumRun>
        <p className="fillup-saved-unit">ליטרים · <Money value={result.written.totalCost} /></p>
        <p>{!result.historyComplete ? "ההיסטוריה לא הייתה זמינה במלואה בשמירה הזו."
          : result.evaluation.outcome === "baseline"
            ? result.evaluation.startsNewPeriod ? "נקודת התחלה חדשה נקבעה. במילוי המלא הבא נוכל למדוד שוב." : "נקודת ההתחלה נקבעה. במילוי המלא הבא נדע כמה נסעתם על כל ליטר."
            : result.evaluation.outcome === "partialNoBaseline" ? "תדלוק חלקי נשמר. נתחיל למדוד אחרי מילוי עד הסוף."
              : result.evaluation.outcome === "unknownRetained" ? "התדלוק נשמר בלי בחירה של מצב המיכל."
                : "תדלוק חלקי נשמר. הליטרים יצטרפו לחישוב במילוי המלא הבא."}</p>
      </section>}

      {!retainedPosted ? <section className="fillup-pump-question" data-testid="fillup-pump-question" data-state={pumpWriteState} aria-label="מחיר המשאבה"
        onFocusCapture={() => { pumpHadFocus.current = true; }}
        onBlurCapture={event => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) pumpHadFocus.current = false;
        }}>
        {!answered ? <>
          <p>{pumpDifferent ? "מה המחיר שהיה כתוב במשאבה?" : <>המחיר במשאבה היה <NumRun>{price(result.written.pricePerLiter)}</NumRun>?</>}</p>
          {pumpDifferent ? <div className="fillup-pump-answer">
            <label htmlFor="fillup-pump-price" className="sr-only">מחיר המשאבה</label>
            <span className="fillup-pump-price-field"><input id="fillup-pump-price" data-testid="fillup-pump-price" dir="ltr" inputMode="decimal"
              autoFocus value={pumpPrice} onChange={event => onPumpPrice(event.currentTarget.value)} placeholder="0.00"
              disabled={busy} aria-invalid={pumpError ? true : undefined} aria-describedby={pumpError ? "fillup-pump-error" : undefined} />
              <span>₪ לליטר</span></span>
            <button type="button" data-testid="fillup-pump-confirm" disabled={!canConfirm || busy || ruleStatus !== "ready"}
              onClick={onSavePumpPrice}>{pumpWriteState === "journaling" ? "שומרים…" : "שמירה"}</button>
          </div> : <div className="fillup-pump-choices">
            <button type="button" className="fillup-pump-yes" data-testid="fillup-pump-yes" disabled={!canConfirm || busy} onClick={onSamePrice}>כן</button>
            <button type="button" data-testid="fillup-pump-no" disabled={!canConfirm || busy} onClick={onDifferentPrice}>לא, היה אחר</button>
          </div>}
          {pumpDifferent ? <small>ההפרש יירשם כהנחה או התאמה אישית, ולא כמחיר התחנה.</small> : null}
          {pumpDifferent && ruleStatus !== "ready" ? <small role="status">{ruleStatus === "loading" ? "טוענים את ההנחות שלך…" : "ההנחות שלך לא זמינות כרגע. אפשר לסיים ולבדוק בהמשך."}</small> : null}
          {!canConfirm && !busy ? <small data-testid="fillup-pump-waiting">{writeState !== "accepted" ? "האישור ייפתח אחרי שהתדלוק יישמר בענן." : "אפשר לאשר אחרי שזמן הביטול יסתיים."}</small> : null}
          {pumpWriteState === "pending" ? <p role="status" data-testid="fillup-pump-pending">הבקשה נשמרה במכשיר · ממתינים לאישור</p> : null}
        </> : pumpWriteState === "accepted" ? <p ref={pumpResultRef} tabIndex={-1} className="fillup-pump-result" role="status" data-testid="fillup-pump-confirmed">
          {pumpDifferent ? pumpScopeKind === "receipt" ? "ההתאמה נשמרה לתדלוק הזה בלבד." : "ההתאמה האישית נשמרה לתדלוקים הבאים כאן." : "מחיר המשאבה אושר."}
        </p> : <p ref={pumpResultRef} tabIndex={-1} className="fillup-pump-result" role="status" data-testid="fillup-pump-attention">הבקשה שמורה במכשיר ודורשת בדיקה. <button type="button" onClick={onReviewWrite}>לבדיקה</button></p>}
        {pumpError ? <p id="fillup-pump-error" className="fillup-pump-error" role="alert"><NumericText>{pumpError}</NumericText></p> : null}
      </section> : null}
    </div>
    <footer ref={footerRef} className="fillup-bottom-bar fillup-saved-bottom">
      <Button variant="ink" full onClick={onDone} data-testid="fillup-saved-done">סיום</Button>
      {secondsLeft > 0 ? <button type="button" className="fillup-saved-undo" data-testid="fillup-saved-undo" disabled={undoBusy} onClick={onUndo}
        onFocus={() => { undoHadFocus.current = true; }} onBlur={event => { if (event.relatedTarget) undoHadFocus.current = false; }}>
        {undoBusy ? "רושמים ביטול…" : <>ביטול השמירה (<NumRun>{secondsLeft}</NumRun>)</>}
      </button> : null}
    </footer>
  </main>;
}
