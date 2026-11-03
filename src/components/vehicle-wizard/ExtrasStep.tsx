import { useEffect, useRef } from "react";
import { Button, Spinner } from "../Button";
import { Field } from "../Field";
import { NumericText } from "../Fmt";
import { num, parseDecimal } from "../../lib/format";
import type { VehicleSpecs } from "../../lib/vehicleSpecs";
import type { WizardDraft, WizardErrors, WizardNumbers } from "./wizardState";

export function ExtrasStep({ draft, numbers, nickname, specs, loadingSpecs, saving, errors, onTankChange, onDeclaredChange, onNicknameChange, onSave }: {
  draft: WizardDraft; numbers: WizardNumbers; nickname: string; specs: VehicleSpecs | null;
  loadingSpecs: boolean; saving: boolean; errors: WizardErrors;
  onTankChange: (value: string) => void; onDeclaredChange: (value: string) => void;
  onNicknameChange: (value: string) => void; onSave: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const tankCleared = numbers.tank.authored && !numbers.tank.value.trim();
  const declaredCleared = numbers.declared.authored && !numbers.declared.value.trim();
  const shownDeclared = numbers.declared.value.trim() && specs?.declaredSource === "exact-year"
    && numbers.declared.value === String(specs.declaredKmPerLiter);
  const estimatedDeclared = shownDeclared && !specs?.consumptionIsOfficial;
  const tankHint = tankCleared ? "ללא נתון מיכל" : numbers.tank.authored && specs?.trustedTankLiters !== parseDecimal(numbers.tank.value)
    ? "הערך שהקלדתם" : specs?.trustedTankLiters
    ? "מפרט יצרן · " + num(specs.trustedTankLiters, 2) + " ליטר"
    : specs?.suggestedTankLiters ? "הערכה · " + num(specs.suggestedTankLiters, 2) + " ליטר" : undefined;
  const declaredHint = declaredCleared ? "ללא נתון צריכה" : numbers.declared.authored && !shownDeclared ? "הערך שהקלדתם"
    : specs?.declaredKmPerLiter ? (specs.declaredSource === "other-year" ? "נתון משנה אחרת" : specs.consumptionIsOfficial ? "נתון תקינה אירופאי" : "הערכה מנתוני CO₂")
      + (specs.matchedYear ? " · " + specs.matchedYear : "")
      + (!numbers.declared.value.trim() ? " · " + num(specs.declaredKmPerLiter, 1) + " ק״מ לליטר" : "") : undefined;
  const fieldError = (key: keyof WizardErrors) => errors[key] ? <NumericText>{errors[key]!}</NumericText> : undefined;

  return <section className="wizard-step">
    <div className="wizard-scroll">
      <h1 ref={heading} tabIndex={-1} className="wizard-title">עוד שני פרטים</h1>
      <p className="wizard-intro">לא חובה. אפשר להשלים אחר כך בפרטי הרכב.</p>
      {loadingSpecs ? <div className="wizard-specs-loading" role="status"><Spinner size={18}/>מאתרים נתוני רכב…</div> : null}
      <fieldset disabled={saving} className="wizard-extra-fields">
        <Field label="איך קוראים לרכב?" data-testid="wizard-nickname" dir="auto" value={nickname} maxLength={60}
          placeholder={[draft.make, draft.model].filter(Boolean).join(" ")} error={fieldError("nickname")}
          onChange={event => onNicknameChange(event.currentTarget.value)}/>
        <div className="wizard-extra-numbers">
          <Field label="נפח מיכל" data-testid="wizard-tank" inputMode="decimal" suffix="ליטר" value={numbers.tank.value}
            placeholder={!tankCleared && specs?.suggestedTankLiters ? num(specs.suggestedTankLiters, 2) : "לא ידוע"}
            hint={tankHint ? <NumericText>{tankHint}</NumericText> : undefined} error={fieldError("tank")}
            onChange={event => onTankChange(event.currentTarget.value)}/>
          <Field label={estimatedDeclared ? "צריכת ייחוס משוערת" : "נתון יצרן"} data-testid="wizard-declared" inputMode="decimal"
            suffix="ק״מ/ל׳" value={numbers.declared.value} placeholder="לא ידוע"
            hint={declaredHint ? <NumericText>{declaredHint}</NumericText> : undefined} error={fieldError("declared")}
            onChange={event => onDeclaredChange(event.currentTarget.value)}/>
        </div>
      </fieldset>
    </div>
    <div className="wizard-footer">
      <Button full data-testid="wizard-save" loading={saving} onClick={onSave}>שמירת הרכב</Button>
      <button type="button" className="wizard-text-action" data-testid="wizard-skip" disabled={saving} onClick={onSave}>אשלים אחר כך</button>
    </div>
  </section>;
}
