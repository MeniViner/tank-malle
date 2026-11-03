import { forwardRef, useId, useState } from "react";
import { formatCivilDay, parseCivilDay } from "../lib/civilDate";
import { CalendarIcon } from "./icons";
import { NumericText } from "./Fmt";
import "../vehicle-page-design.css";

interface CivilDateFieldProps {
  label: string;
  draftText: string;
  onDraftTextChange: (text: string) => void;
  error?: string | null;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  "data-testid"?: string;
}

/** The visible draft is the only input authority; callers parse it again on Save. */
export const CivilDateField = forwardRef<HTMLInputElement, CivilDateFieldProps>(function CivilDateField({
  label, draftText, onDraftTextChange, error, disabled = false, required = false, id, "data-testid": testId,
}, ref) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [blurred, setBlurred] = useState(false);
  const day = parseCivilDay(draftText);
  const message = error || (blurred && draftText.trim() && !day ? "תאריך לא תקין — למשל 05/09/2026" : null);
  const normalize = () => {
    setBlurred(true);
    if (day) {
      const formatted = formatCivilDay(day);
      if (formatted !== draftText) onDraftTextChange(formatted);
    }
  };
  const openPicker = (element: HTMLInputElement) => {
    try { element.showPicker?.(); } catch { /* The native control remains available. */ }
  };

  return <div className="tm-civil-field">
    <label htmlFor={inputId} className="tm-vehicle-field-label">{label}</label>
    <div className="tm-civil-control" data-invalid={!!message || undefined}>
      <input ref={ref} id={inputId} data-testid={testId} className="tm-civil-input" type="text" dir="ltr" inputMode="numeric"
        autoComplete="off" placeholder="DD/MM/YYYY" value={draftText} disabled={disabled}
        aria-required={required || undefined} aria-invalid={!!message || undefined}
        aria-describedby={message ? `${inputId}-error` : undefined}
        onChange={event => onDraftTextChange(event.target.value)} onBlur={normalize}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); normalize(); } }} />
      <span className="tm-civil-picker" data-disabled={disabled || undefined}>
        <CalendarIcon size={20} aria-hidden="true" />
        <input type="date" className="tm-civil-native" value={day ?? ""} min="1900-01-01" max="2199-12-31"
          disabled={disabled} aria-label={`${label} — בחירה מלוח השנה`}
          onClick={event => openPicker(event.currentTarget)}
          onKeyDown={event => {
            if ((event.key === "Enter" || event.key === " ") && typeof event.currentTarget.showPicker === "function") {
              event.preventDefault(); openPicker(event.currentTarget);
            }
          }}
          onChange={event => {
            const next = event.currentTarget.value;
            onDraftTextChange(next ? formatCivilDay(next) || next : "");
            setBlurred(false);
          }} />
      </span>
    </div>
    {message ? <p id={`${inputId}-error`} role="alert" className="tm-vehicle-error"><NumericText>{message}</NumericText></p> : null}
  </div>;
});
