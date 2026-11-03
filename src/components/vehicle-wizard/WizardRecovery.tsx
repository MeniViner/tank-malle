import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Button, Spinner } from "../Button";
import { NumericText } from "../Fmt";
import { outboxStatusText, type OutboxOperation } from "../../lib/outbox";
import type { VehicleCreationSubmission, VehicleSelectionResult } from "../../lib/vehicleCreation";

export type VehicleReceiptState = "pending" | "accepted" | "failed";
export function WizardRecovery({ state, operations, onDifferentVehicle }: {
  state: "loading" | "unknown" | "retained"; operations: readonly OutboxOperation[]; onDifferentVehicle: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="wizard-step" data-testid="wizard-recovery" data-state={state}>
    <div className="wizard-scroll">
      <h1 ref={heading} tabIndex={-1} data-testid="wizard-recovery-title" className="wizard-title">{state === "loading" ? "בודקים שמירות קודמות" : state === "unknown" ? "לא הצלחנו לבדוק את השמירה" : "פרטי הרכב כבר שמורים במכשיר"}</h1>
      {state === "loading" ? <div className="wizard-specs-loading" role="status"><Spinner/><span>רק רגע…</span></div>
        : state === "unknown" ? <p className="wizard-intro">אפשר לבדוק את השינויים שממתינים לענן.</p>
          : <>
            <p className="wizard-intro">המשיכו מהשמירה הקיימת.</p>
            <ul className="wizard-retained-list">
              {operations.map(operation => {
                const name = [operation.payload?.make, operation.payload?.model].filter(value => typeof value === "string").join(" ").trim();
                return <li key={operation.opId} data-testid="wizard-retained-creation" data-operation-id={operation.opId}
                  data-operation-version={operation.version} data-vehicle-id={operation.vehicleId ?? operation.docId}>
                  <b><NumericText>{name || "פרטי רכב"}</NumericText></b><span>{outboxStatusText(operation.status)}</span>
                </li>;
              })}
            </ul>
          </>}
    </div>
    {state !== "loading" ? <div className="wizard-footer">
      <Link className="tm-button tm-button-ink" data-testid="wizard-recover" to="/settings/unsynced">בדיקת השמירה הקיימת</Link>
      {state === "retained" ? <button type="button" className="wizard-text-action" data-testid="wizard-add-different" onClick={onDifferentVehicle}>הוספת רכב אחר</button> : null}
    </div> : null}
  </section>;
}

export function WizardCreationStatus({ submission, phase, selection, selectionPhase, selected, busy, error, onRetrySelection, onDone }: {
  submission: VehicleCreationSubmission; phase: VehicleReceiptState; selection: VehicleSelectionResult | null;
  selectionPhase: VehicleReceiptState; selected: boolean; busy: boolean; error: string | null;
  onRetrySelection: () => void; onDone: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const selectionBlocked = selection?.state === "blocked" && selection.reason !== "creation-unconfirmed"
    || selection?.state === "submitted" && selectionPhase === "failed";
  const chooseExisting = selection?.state === "blocked"
    && (selection.reason === "vehicle-selection-unverified" || selection.reason === "vehicle-selection-ended");
  return <section className="wizard-step" data-testid="wizard-create-status" data-write-state={phase}
    data-vehicle-id={submission.vehicleId} data-operation-id={submission.creation.opId} data-operation-version={submission.creation.version}>
    <div className="wizard-scroll">
      <h1 ref={heading} tabIndex={-1} data-testid="wizard-created-title" className="wizard-title">{phase === "accepted" ? "הרכב נשמר בענן" : "הרכב נשמר במכשיר"}</h1>
      <p className="wizard-intro">{phase === "failed" ? "השליחה לענן לא הושלמה. הפרטים שמורים לבדיקה." : phase === "pending" ? "ממתינים לאישור בענן."
        : selected ? "אפשר להתחיל לתעד תדלוקים." : selection?.state === "not-required" ? "הרכב נוסף לרשימה. אפשר לבחור אותו בניהול רכבים." : "בחירת הרכב עוד לא הושלמה."}</p>
      {selectionBlocked ? <div data-testid="wizard-selection-status" data-state={selection?.state}
        data-write-state={selectionPhase} className="wizard-notice" role="status">
        <div><b>בחירת הרכב עוד לא הושלמה</b>
          {selection?.state === "blocked" ? <p><NumericText>{selection.message}</NumericText></p> : null}
          {chooseExisting ? <Link to="/settings/vehicles" data-testid="wizard-choose-existing" className="wizard-text-action">בחירת רכב מהרשימה</Link>
            : <button type="button" data-testid="wizard-retry-selection" className="wizard-text-action" disabled={busy} onClick={onRetrySelection}>ניסיון נוסף לבחירה</button>}
        </div>
      </div> : null}
      {error ? <p role="alert" data-testid="wizard-error" className="wizard-error"><NumericText>{error}</NumericText></p> : null}
    </div>
    <div className="wizard-footer">
      {phase === "failed" || error ? <Link className="tm-button tm-button-ink" data-testid="wizard-recover" to="/settings/unsynced">בדיקת השליחה לענן</Link>
        : <Button full loading={busy} data-testid="wizard-created-done" onClick={onDone}>סיום</Button>}
    </div>
  </section>;
}
