import { NumericText, NumRun } from "../Fmt";
import { ChevronDown } from "../icons";
import { price } from "../../lib/format";

export interface FillupMoreProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  notesError?: string;
  storedPostedPrice: number | null;
  clearStoredPosted: boolean;
  onClearStoredPosted: (clear: boolean) => void;
  postedPriceError?: string;
}

/**
 * The optional extras: a note, and an earlier confirmed pump price. The tank gauges are gone
 * from the form ("full" already says the tank is full; the home gauge update covers the rest),
 * and "missed refuels" appears next to the warning that suggests it (FillupEssentials).
 */
export function FillupMore({ open, onOpenChange, notes, onNotesChange, notesError,
  storedPostedPrice, clearStoredPosted, onClearStoredPosted, postedPriceError,
}: FillupMoreProps) {
  return <section className="fillup-more" data-testid="fillup-more">
    <button type="button" className="fillup-disclosure" aria-expanded={open} aria-controls="fillup-more-content"
      data-testid="fillup-more-toggle" onClick={() => onOpenChange(!open)}>
      <span>עוד פרטים<small>הערה</small></span>
      <ChevronDown size={20} className={open ? "fillup-chevron-open" : ""} />
    </button>
    {open ? <div id="fillup-more-content" className="fillup-more-content">
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
    </div> : null}
  </section>;
}
