import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../Button";
import { Field } from "../Field";
import { NumericText } from "../Fmt";
import { Pill, PlateXL } from "../DesignPrimitives";
import { CheckIcon, ChevronStart, WarningIcon } from "../icons";
import { FUEL_TYPE_LABELS } from "../../lib/format";
import type { FuelType } from "../../lib/types";
import { CatalogPicker } from "./CatalogPicker";
import type { WizardDraft, WizardErrors } from "./wizardState";

const FUELS: FuelType[] = ["95", "98", "diesel", "other"];
export function ConfirmStep({ draft, review, notice, errors, onChange, onCorrect, onNext }: {
  draft: WizardDraft; review: boolean; notice: string | null; errors: WizardErrors;
  onChange: (patch: Partial<WizardDraft>) => void; onCorrect: () => void; onNext: () => void;
}) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const fuelGroup = useId();
  useEffect(() => { heading.current?.focus(); }, [review]);
  const fieldError = (key: keyof WizardErrors) => errors[key] ? <NumericText>{errors[key]!}</NumericText> : undefined;
  return <section className="wizard-step">
    <div className="wizard-scroll">
      {draft.fromRegistry && !notice ? <Pill tone="better"><CheckIcon size={17}/>נמצא במאגר משרד התחבורה</Pill> : null}
      <h1 ref={heading} tabIndex={-1} data-testid="wizard-confirm-title" className="wizard-title">{review ? "זה הרכב שלך?" : "פרטי הרכב"}</h1>
      {notice ? <div className="wizard-notice" role="status" data-testid="wizard-lookup-status" data-state="cached">
        <WarningIcon size={20}/><span><NumericText>{notice}</NumericText></span>
      </div> : null}
      {draft.plateNumber ? <PlateXL value={draft.plateNumber} className="wizard-confirm-plate"/> : null}
      {review ? <dl className="wizard-readonly" data-testid="wizard-confirmation">
        <div><dt>יצרן</dt><dd data-testid="wizard-make-value"><NumericText>{draft.make || "לא ידוע"}</NumericText></dd></div>
        <div><dt>דגם</dt><dd data-testid="wizard-model-value"><NumericText>{draft.model || "לא ידוע"}</NumericText></dd></div>
        <div><dt>שנת ייצור</dt><dd data-testid="wizard-year-value"><NumericText>{draft.year || "לא ידוע"}</NumericText></dd></div>
        <div><dt>סוג דלק</dt><dd><NumericText>{FUEL_TYPE_LABELS[draft.fuelType]}</NumericText></dd></div>
      </dl> : <>
        <div className="wizard-name-fields">
          <Field label="יצרן" data-testid="wizard-make" dir="auto" value={draft.make} maxLength={60}
            error={fieldError("make")} onChange={event => onChange({ make: event.currentTarget.value })} placeholder="למשל: מאזדה"/>
          <Field label="דגם" data-testid="wizard-model" dir="auto" value={draft.model} maxLength={80}
            error={fieldError("model")} onChange={event => onChange({ model: event.currentTarget.value })} placeholder="למשל: 3"/>
        </div>
        <Field label="שנת ייצור" data-testid="wizard-year" inputMode="numeric" value={draft.year} maxLength={4}
          error={fieldError("year")} onChange={event => onChange({ year: event.currentTarget.value.replace(/\D/g, "").slice(0, 4) })} placeholder="לא ידוע"/>
        <fieldset className="wizard-fuels">
          <legend>סוג דלק</legend>
          <div>{FUELS.map(fuel => <label key={fuel}>
            <input type="radio" name={fuelGroup} data-testid={"wizard-fuel-" + fuel} value={fuel}
              aria-label={FUEL_TYPE_LABELS[fuel]} checked={draft.fuelType === fuel} onChange={() => onChange({ fuelType: fuel })}/>
            <span><NumericText>{fuel === "95" || fuel === "98" ? fuel : fuel === "diesel" ? "סולר" : "אחר"}</NumericText></span>
          </label>)}</div>
        </fieldset>
        <button type="button" className="wizard-catalog-button" data-testid="wizard-catalog-open" onClick={() => setCatalogOpen(true)}>
          <span>בחירה מרשימת הדגמים</span><ChevronStart size={20}/>
        </button>
      </>}
      {review && Object.values(errors).some(Boolean) ? <p className="wizard-error" role="alert"><NumericText>{Object.values(errors).filter(Boolean).join(" · ")}</NumericText></p> : null}
    </div>
    <div className="wizard-footer">
      <Button full data-testid="wizard-confirm-next" disabled={!draft.make.trim()} onClick={onNext}>{review ? "כן, זה הרכב שלי" : "המשך"}</Button>
      {review ? <button type="button" className="wizard-text-action" data-testid="wizard-correct" onClick={onCorrect}>תיקון פרטים</button> : null}
    </div>
    {catalogOpen ? <CatalogPicker onClose={() => setCatalogOpen(false)} onPick={(make, model, year) => {
      onChange({ make, model, year: year === null ? draft.year : String(year), fromRegistry: false });
      setCatalogOpen(false);
    }}/> : null}
  </section>;
}
