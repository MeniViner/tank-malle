import type { ReactNode, Ref } from "react";
import { PumpDisplay, PumpDisplayRow } from "../DesignPrimitives";
import { Segmented } from "../Segmented";
import { ConsumptionValue, NumRun, NumericText, Quantity } from "../Fmt";
import { WarningIcon } from "../icons";
import { int, price } from "../../lib/format";
import type { ReceiptConflict, ReceiptField, ReceiptState } from "../../lib/receipt";
import { FILLUP_LIMITS, type FieldError } from "../../lib/fillupSerializer";
import type { DraftEvaluation, SoftWarning, odometerBounds } from "../../lib/stats";
import type { TankEndChoice } from "../../lib/tank/draft";
import type { Units } from "../../lib/types";

export interface FillupEssentialsProps {
  receipt: ReceiptState;
  onReceiptChange: (field: ReceiptField, value: string) => void;
  odometer: string;
  odometerValue: number;
  onOdometerChange: (value: string) => void;
  bounds: ReturnType<typeof odometerBounds>;
  errors: Partial<Record<FieldError["field"], string>>;
  odometerError: string | null;
  priceCaption: ReactNode;
  priceValue: number;
  conflict: ReceiptConflict | null;
  receiptBlocked: boolean;
  warnings: SoftWarning[];
  evaluation: DraftEvaluation | null;
  units: Units;
  endChoice: TankEndChoice | null;
  onEndChoice: (value: TankEndChoice | null) => void;
  shaking: boolean;
  totalRef: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  historyComplete: boolean;
  /** False for an EV: no tank end state and no tank-based preview (DESIGN-V3 §7.4). */
  tankFields?: boolean;
}

/** The controller owns every editable string and all canonical calculations. */
export function FillupEssentials({ receipt, onReceiptChange, odometer, odometerValue,
  onOdometerChange, bounds, errors, odometerError, priceCaption, priceValue, conflict, receiptBlocked,
  warnings, evaluation, units, endChoice, onEndChoice, shaking, totalRef, autoFocus,
  historyComplete, tankFields = true,
}: FillupEssentialsProps) {
  const authored = new Set(receipt.authored);
  const totalDerived = !authored.has("totalCost") && receipt.totalCost.trim() !== "";
  const litersDerived = !authored.has("liters") && receipt.liters.trim() !== "";
  const priceDerived = !authored.has("pricePerLiter") && authored.has("liters") && authored.has("totalCost");
  const rangeCaption = odometerError && Number.isFinite(odometerValue) && odometerValue > 0
    ? bounds.min !== null && bounds.max !== null
      ? <>הזינו בין <NumRun>{int(bounds.min)}</NumRun> ל־<NumRun>{int(bounds.max)}</NumRun></>
      : bounds.min !== null && odometerValue < bounds.min
        ? <>הזינו <NumRun>{int(bounds.min)}</NumRun> ומעלה</>
        : bounds.max !== null && odometerValue > bounds.max
          ? <>הזינו עד <NumRun>{int(bounds.max)}</NumRun></>
          : <NumericText>{odometerError}</NumericText>
    : odometerError ? <NumericText>{odometerError}</NumericText> : undefined;
  const previousCaption = bounds.prev
    ? odometer.trim() && Number.isFinite(odometerValue) && !odometerError
      ? <><NumRun>+{int(odometerValue - bounds.prev.odometer)}</NumRun> ק״מ מהרישום הקודם</>
      : <>אחרון: <NumRun>{int(bounds.prev.odometer)}</NumRun></>
    : "הקריאה בלוח הקילומטרים";

  return <section className="fillup-essentials" data-testid="fillup-essentials">
    <div role="group" aria-label="נתוני המשאבה" className={shaking ? "fillup-pump-shake" : undefined}>
      <PumpDisplay>
        <PumpDisplayRow ref={totalRef} id="fillup-total" data-testid="fillup-total" label="סכום" unit="₪"
          aria-label="סכום" value={receipt.totalCost} autoFocus={autoFocus} placeholder="0.00"
          onChange={event => onReceiptChange("totalCost", event.currentTarget.value)}
          error={errors.totalCost ? <NumericText>{errors.totalCost}</NumericText> : undefined}
          caption={totalDerived ? "חושב מהליטרים ומהמחיר · הקלידו לשינוי" : undefined} />
        <PumpDisplayRow id="fillup-liters" data-testid="fillup-liters" label="ליטרים" unit="ל׳"
          value={receipt.liters} placeholder="0.00"
          onChange={event => onReceiptChange("liters", event.currentTarget.value)}
          error={errors.liters ? <NumericText>{errors.liters}</NumericText> : undefined}
          caption={litersDerived && Number.isFinite(priceValue)
            ? <>חושב לפי <NumRun>{price(priceValue)}</NumRun> לליטר · הקלידו לשינוי</> : undefined} />
        <PumpDisplayRow id="fillup-price" data-testid="fillup-price" label="מחיר לליטר" unit="₪" small
          value={receipt.pricePerLiter} placeholder="0.00"
          onChange={event => onReceiptChange("pricePerLiter", event.currentTarget.value)}
          error={errors.pricePerLiter ? <NumericText>{priceValue > FILLUP_LIMITS.pricePerLiterMax
            ? `המחיר לליטר חייב להיות עד ${price(FILLUP_LIMITS.pricePerLiterMax)}` : errors.pricePerLiter}</NumericText> : undefined}
          caption={priceDerived ? "חושב מהסכום ומהליטרים" : authored.has("pricePerLiter") ? "המחיר שהקלדתם" : priceCaption} />
        <PumpDisplayRow id="fillup-odometer" data-testid="fillup-odometer" label="קילומטראז׳" unit="ק״מ"
          inputMode="numeric" value={odometer} placeholder={bounds.min !== null ? String(bounds.min) : "0"}
          onChange={event => onOdometerChange(event.currentTarget.value)}
          error={rangeCaption ?? (errors.odometer ? <NumericText>{errors.odometer}</NumericText> : undefined)}
          caption={previousCaption} />
      </PumpDisplay>
    </div>

    {conflict ? <div className="fillup-warning" data-testid="fillup-receipt-conflict">
      <WarningIcon size={18} />
      <span>{receiptBlocked ? "הסכום, הליטרים והמחיר לא מסתדרים. בדקו את המספרים."
        : "הסכום, הליטרים והמחיר לא מסתדרים. נשמור את מה שהקלדתם, בלי לשנות אף מספר."}</span>
    </div> : null}

    {tankFields ? <><div data-testid="fillup-end-state">
      <Segmented<TankEndChoice | "unanswered"> value={endChoice ?? "unanswered"}
        ariaLabel="מצב המיכל בסוף התדלוק"
        options={[{ value: "full", label: "מילאתי עד הסוף" }, { value: "partial", label: "תדלוק חלקי" }]}
        onChange={choice => { if (choice !== "unanswered") onEndChoice(choice === endChoice ? null : choice); }} />
    </div>
    {endChoice === "unknown" ? <p className="fillup-small-status">מצב המיכל לא ידוע</p> : null}
    <div className="fillup-live-preview" data-testid="fillup-live-preview" aria-live="polite">
      {!historyComplete ? <span>ההיסטוריה לא זמינה במלואה לחישוב</span>
        : evaluation ? <DraftPreview evaluation={evaluation} units={units} />
          : <span>מלאו סכום וקילומטראז׳ ונראה מה יצא</span>}
    </div></> : null}
    {warnings.map((warning, index) => <div key={`${warning.field}-${index}`} className="fillup-warning" data-testid="fillup-soft-warning">
      <WarningIcon size={18} /><span><NumericText>{warning.message}</NumericText>
        {warning.field === "odometer" ? <span> · פספסתם תדלוק? אפשר לסמן בפרטים הנוספים.</span> : null}
      </span>
    </div>)}
  </section>;
}

function DraftPreview({ evaluation, units }: { evaluation: DraftEvaluation; units: Units }) {
  if (evaluation.outcome === "closedSegment" && evaluation.segment) return <>
    <ConsumptionValue kmPerLiter={evaluation.segment.kmPerLiter} units={units} long />
    <span>צפוי למקטע הזה</span>
  </>;
  if (evaluation.outcome === "baseline") return <span>{evaluation.startsNewPeriod
    ? "טנק מלא ראשון אחרי הפספוס: מכאן נתחיל למדוד"
    : "טנק מלא ראשון: מכאן נתחיל למדוד"}</span>;
  if (evaluation.outcome === "partialNoBaseline") return <span>תדלוק חלקי · נתחיל למדוד אחרי מילוי עד הסוף</span>;
  if (evaluation.outcome === "unknownRetained") return <span>מצב המיכל לא צוין · אפשר לשמור כך</span>;
  return <span>תדלוק חלקי: <Quantity value={evaluation.openSegment.liters} digits={1} /> במקטע הפתוח</span>;
}
