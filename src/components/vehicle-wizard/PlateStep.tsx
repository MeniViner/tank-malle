import { useEffect, useRef } from "react";
import { Button } from "../Button";
import { NumericText, NumRun } from "../Fmt";
import { WarningIcon } from "../icons";
import { formatPlate } from "../../lib/format";

export function PlateStep({ plate, onPlateChange, looking, error, canRetry, onLookup, onManual }: {
  plate: string; onPlateChange: (value: string) => void; looking: boolean;
  error: string | null; canRetry: boolean; onLookup: () => void; onManual: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="wizard-step">
    <div className="wizard-scroll">
      <h1 ref={heading} tabIndex={-1} data-testid="wizard-plate-title" className="wizard-title">מה מספר הרכב?</h1>
      <p className="wizard-intro">נחפש יצרן, דגם ושנה במאגר משרד התחבורה.</p>
      <div className="wizard-plate" dir="ltr">
        <span className="wizard-plate-il" aria-hidden="true">IL</span>
        <input data-testid="wizard-plate" aria-label="מספר רכב" inputMode="numeric" dir="ltr" autoComplete="off"
          value={formatPlate(plate)} placeholder="00-000-00"
          onChange={event => onPlateChange(event.currentTarget.value.replace(/\D/g, "").slice(0, 8))}
          onKeyDown={event => {
            if (event.key === "Enter" && plate.length >= 5 && !looking) { event.preventDefault(); onLookup(); }
          }}/>
      </div>
      {error ? <div className="wizard-notice" role="status" data-testid="wizard-lookup-status"
        data-state={canRetry ? "unavailable" : "not-found"}>
        <WarningIcon size={20}/><div><NumericText>{error}</NumericText>
          {canRetry ? <button type="button" className="wizard-text-action" data-testid="wizard-retry" disabled={looking} onClick={onLookup}>נסו שוב</button> : null}
        </div>
      </div> : null}
      <div className="wizard-keypad" dir="ltr" aria-label="לוח מקשים למספר הרכב">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(key => <button key={key} type="button"
          data-testid={"wizard-key-" + key} onClick={() => { if (plate.length < 8) onPlateChange(plate + key); }}><NumRun>{key}</NumRun></button>)}
        <button type="button" className="wizard-key-quiet" data-testid="wizard-key-clear" onClick={() => onPlateChange("")}>ניקוי</button>
        <button type="button" data-testid="wizard-key-0" onClick={() => { if (plate.length < 8) onPlateChange(plate + "0"); }}><NumRun>0</NumRun></button>
        <button type="button" className="wizard-key-quiet" data-testid="wizard-key-delete" aria-label="מחיקת ספרה" onClick={() => onPlateChange(plate.slice(0, -1))}>⌫</button>
      </div>
    </div>
    <div className="wizard-footer">
      <Button full data-testid="wizard-lookup" onClick={onLookup} loading={looking} disabled={plate.length < 5}>חיפוש הרכב</Button>
      <button type="button" className="wizard-text-action" data-testid="wizard-manual" onClick={onManual}>אין לוחית? הזנה ידנית</button>
    </div>
  </section>;
}
