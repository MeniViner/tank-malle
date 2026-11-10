import { useEffect, useId, useRef, useState } from "react";
import { Button, Spinner } from "../Button";
import { Field } from "../Field";
import { NumericText, NumRun } from "../Fmt";
import { Pill, PlateXL } from "../DesignPrimitives";
import { CheckIcon, ChevronStart, WarningIcon } from "../icons";
import { FUEL_TYPE_LABELS, int } from "../../lib/format";
import type { FuelType } from "../../lib/types";
import type { VehicleSpecs } from "../../lib/vehicleSpecs";
import { CatalogPicker } from "./CatalogPicker";
import { wizardIsEv, type WizardBattery, type WizardDraft, type WizardErrors } from "./wizardState";

/** "ev" is a manual choice of drivetrain, stored as fuelType "other" + powertrain "ev". */
type FuelChoice = FuelType | "ev";
const FUELS: FuelChoice[] = ["95", "98", "diesel", "other", "ev"];
const FUEL_CHOICE_LABEL: Record<FuelChoice, string> = { "95": "95", "98": "98", diesel: "סולר", other: "אחר", ev: "חשמלי" };

export function ConfirmStep({ draft, review, notice, errors, specs, loadingSpecs, battery, onChange, onBatteryChange, onCorrect, onNext }: {
  draft: WizardDraft; review: boolean; notice: string | null; errors: WizardErrors;
  specs: VehicleSpecs | null; loadingSpecs: boolean; battery: WizardBattery;
  onChange: (patch: Partial<WizardDraft>) => void; onBatteryChange: (key: keyof WizardBattery, value: string) => void;
  onCorrect: () => void; onNext: () => void;
}) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const fuelGroup = useId();
  const evNote = useId();
  useEffect(() => { heading.current?.focus(); }, [review]);
  const fieldError = (key: keyof WizardErrors) => errors[key] ? <NumericText>{errors[key]!}</NumericText> : undefined;
  const ev = wizardIsEv(draft, specs);
  const choice: FuelChoice = ev ? "ev" : draft.fuelType;
  const motorKw = specs?.motorKw ?? null;
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
        {ev ? <div><dt>הנעה</dt><dd data-testid="wizard-powertrain-value">חשמלי</dd></div>
          : <div><dt>סוג דלק</dt><dd><NumericText>{FUEL_TYPE_LABELS[draft.fuelType]}</NumericText></dd></div>}
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
              aria-label={fuel === "ev" ? "חשמלי" : FUEL_TYPE_LABELS[fuel]} checked={choice === fuel}
              onChange={() => onChange(fuel === "ev" ? { fuelType: "other", powertrain: "ev" } : { fuelType: fuel, powertrain: null })}/>
            <span><NumericText>{FUEL_CHOICE_LABEL[fuel]}</NumericText></span>
          </label>)}</div>
        </fieldset>
        <button type="button" className="wizard-catalog-button" data-testid="wizard-catalog-open" onClick={() => setCatalogOpen(true)}>
          <span>בחירה מרשימת הדגמים</span><ChevronStart size={20}/>
        </button>
      </>}
      {ev ? <section className="wizard-ev" data-testid="wizard-ev" aria-labelledby={evNote + "-title"} aria-describedby={evNote}>
        <h2 id={evNote + "-title"} className="sr-only">פרטי הנעה חשמלית</h2>
        <dl className="wizard-readonly">
          <div><dt>הספק מנוע</dt><dd data-testid="wizard-motor-value">{motorKw !== null ? <><NumRun>{int(motorKw)}</NumRun> kW</>
            : loadingSpecs ? <span className="wizard-ev-loading"><Spinner size={14}/>מאתרים…</span> : "לא ידוע"}</dd></div>
        </dl>
        <div className="wizard-ev-fields">
          <Field label="קיבולת סוללה" data-testid="wizard-battery-kwh" inputMode="decimal" suffix={<bdi dir="ltr">kWh</bdi>}
            value={battery.kwh.value} placeholder="לא ידוע" error={fieldError("batteryKwh")}
            onChange={event => onBatteryChange("kwh", event.currentTarget.value)}/>
          <Field label="טווח יצרן (WLTP)" data-testid="wizard-battery-wltp" inputMode="decimal" suffix="ק״מ"
            value={battery.wltp.value} placeholder="לא ידוע" error={fieldError("batteryWltp")}
            onChange={event => onBatteryChange("wltp", event.currentTarget.value)}/>
        </div>
        <p id={evNote} className="wizard-ev-note" data-testid="wizard-ev-note">ברכב חשמלי אין מיכל ונפח מנוע: ההספק מגיע ממשרד התחבורה, ואת קיבולת הסוללה וטווח היצרן, שאינם במאגר, אפשר להוסיף כאן (לא חובה).</p>
      </section> : null}
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
