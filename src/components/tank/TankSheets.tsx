import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { dayMonthShort, timeAgo } from "../../lib/format";
import type { TankEstimate } from "../../lib/tank";
import { primaryNote } from "../../lib/tank/balance";
import { capacityNote } from "../../lib/tank/capacity";
import { NEXT_UPDATE_TEXT, REASON_TEXT, fillStyleSentence } from "../../lib/tank/copy";
import { displayTankLevel } from "../../lib/tank/display";
import { useAccountScope } from "../account/useAccountScope";
import { GroupRow } from "../DesignPrimitives";
import { ConsumptionValue, Distance, NumericText, Percent } from "../Fmt";
import { CalendarIcon, GaugeIcon } from "../icons";
import { Sheet } from "../Sheet";
import { TankCapacityConfirm } from "./TankCapacityConfirm";
import { GaugeObservationEditor, TankOdometerSheet } from "./TankObservationSheets";
import { TankPreferenceControls } from "./TankPreferenceControls";
import { TankHabitLevel, TankLevel, TankPassage, TankSource, TankText } from "./TankPresentation";
import { TankTripSheet } from "./TankTripSheet";
import type { TankSheetsProps } from "./types";
import "../../tank-design.css";

export type { TankSheetsProps, TankSheetEntry } from "./types";

/** Each opening and account/vehicle switch gets a fresh editor lifetime. */
export function TankSheets(props: TankSheetsProps) {
  const { user } = useAuth();
  const { activeVehicle } = useData();
  if (!props.entry || !activeVehicle || !props.handle.estimate.available) return null;
  return <TankSheetSession key={`${user?.uid ?? ""}/${activeVehicle.id}`} {...props} />;
}

function TankSheetSession({ handle, entry, enriching, onClose }: TankSheetsProps) {
  const { user } = useAuth();
  const { activeVehicle, plans, deletePlan, settings } = useData();
  const { showToast } = useToast();
  const captureScope = useAccountScope(`${user?.uid ?? ""}/${activeVehicle?.id ?? ""}`);
  const [nested, setNested] = useState<"odometer" | "trip" | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const busyPlan = useRef<string | null>(null);
  const gaugeControl = useRef<HTMLDivElement>(null);
  const { estimate } = handle;
  const level = displayTankLevel(estimate);
  const note = primaryNote(estimate.activeNotes);
  const capacitySuspect = estimate.capacityNotes.find(item => item.state === "capacitySuspect");
  const suggestion = estimate.capacity.suggestion;
  const offeredCapacity = !estimate.capacityTrusted && suggestion !== null;
  const prompt = estimate.nextUpdate.kind;
  const showPrompt = prompt !== "none" && prompt !== "updateGauge" && prompt !== "updateOdometer"
    && !(prompt === "confirmCapacity" && offeredCapacity);
  const fillStyle = fillStyleSentence(estimate.habit);

  function focusGauge() {
    gaugeControl.current?.querySelector<HTMLInputElement>('input[type="range"]')?.focus();
  }

  async function removePlan(id: string) {
    if (busyPlan.current || !user || !activeVehicle) return;
    const current = captureScope();
    busyPlan.current = id;
    setDeleting(id);
    setError("");
    try {
      await deletePlan(id);
      if (current()) showToast({ tone: "info", title: "בקשת מחיקת הנסיעה נשמרה במכשיר" });
    } catch {
      if (current()) setError("בקשת המחיקה לא נשמרה. אפשר לנסות שוב.");
    } finally {
      busyPlan.current = null;
      if (current()) setDeleting(null);
    }
  }

  return <>
    <Sheet open title="מה יש במיכל" onClose={onClose}>
      <div className="tm-tank-stack" data-testid="tank-sheet" data-entry={entry}>
        <p className="tm-tank-note">{level === null ? "עוד אין נקודת התחלה עדכנית. סמנו את כמות הדלק שמופיעה במחוון ברכב."
          : <><TankSource estimate={estimate} level={level} />. מסתכלים על המחוון ברכב? הקישו על המקום המתאים.</>}</p>
        <GaugeObservationEditor estimate={estimate} onSaved={onClose} controlRef={gaugeControl}>
          {level !== null ? <ForecastRows estimate={estimate} /> : null}
          <Assumptions estimate={estimate} units={settings.units} />
        </GaugeObservationEditor>

        {note ? <div className="tm-tank-warning"><TankText>{note.message}</TankText>
          <button type="button" className="tm-tank-action" onClick={focusGauge}>בדיקת המחוון</button></div> : null}

        {/* Keep the host mounted when the optimistic vehicle update becomes trusted. */}
        <TankCapacityConfirm available={offeredCapacity} liters={suggestion ?? estimate.capacity.liters ?? 0}
          note={capacitySuspect?.message ?? capacityNote(estimate.capacity) ?? ""} />
        {enriching ? <p className="tm-tank-note" role="status">משלים מפרט רכב…</p> : null}

        <div className="tm-group">
          <GroupRow testId="tank-open-odometer" icon={<GaugeIcon />} title="עדכון קילומטראז׳"
            subtitle={estimate.lastOdometer ? <>אחרון: <Distance value={estimate.lastOdometer.value} /> · <NumericText>{timeAgo(estimate.lastOdometer.at)}</NumericText></> : "קריאה מלוח הקילומטרים, בלי תדלוק"}
            onClick={() => setNested("odometer")} />
          <GroupRow testId="tank-open-trip" icon={<CalendarIcon />} title="יש לי נסיעה מתוכננת"
            subtitle="הנסיעה תשפיע על התחזית" onClick={() => setNested("trip")} />
        </div>

        {plans.length > 0 ? <section className="tm-tank-stack">
          <h3 className="tm-tank-section-title">נסיעות מתוכננות</h3>
          <div className="tm-group">{plans.map(plan => <div key={plan.id} data-testid={`tank-plan-${plan.id}`} className="tm-tank-plan-row">
            <span className="tm-tank-plan-copy"><span><NumericText>{dayMonthShort(plan.date)}</NumericText> · <Distance value={plan.distanceKm} /></span>
              <small>{plan.mode === "replaces" ? "במקום הנהיגה הרגילה" : "בנוסף לנהיגה הרגילה"}
                {plan.bufferKm != null && plan.bufferKm > 0 ? <> · מרווח <Distance value={plan.bufferKm} /></> : null}</small>
              {plan.note ? <small><TankText>{plan.note}</TankText></small> : null}</span>
            <button type="button" className="tm-tank-action tm-tank-action-danger" disabled={deleting !== null}
              aria-label={`מחיקת הנסיעה ב־${dayMonthShort(plan.date)}`} onClick={() => void removePlan(plan.id)}>{deleting === plan.id ? "מוחקים…" : "מחיקה"}</button>
          </div>)}</div>
        </section> : null}
        {error ? <p role="alert" className="tm-tank-error">{error}</p> : null}

        <TankPreferenceControls estimate={estimate} />

        {showPrompt ? <div className="tm-tank-prompt">
          <span>{NEXT_UPDATE_TEXT[prompt].title}</span>
          {prompt === "confirmCapacity" ? <Link className="tm-tank-action" to="/vehicle?tab=details"
            onClick={() => handle.dismissPrompt(prompt)}>הוספת נפח מיכל</Link>
            : <button type="button" className="tm-tank-action" onClick={() => handle.dismissPrompt(prompt)}>{NEXT_UPDATE_TEXT[prompt].action}</button>}
          <button type="button" className="tm-tank-action" onClick={() => handle.dismissPrompt(prompt)}>לא עכשיו</button>
        </div> : null}

        <details className="tm-tank-details">
          <summary>על מה מבוססת ההערכה</summary>
          <div className="tm-tank-stack">
            <div className="tm-group">
              <GroupRow title="אחרי התדלוק האחרון" value={estimate.lastRefuel && estimate.lastRefuel.level !== null
                ? <><TankLevel level={estimate.lastRefuel.level} /> · <NumericText>{dayMonthShort(estimate.lastRefuel.at)}</NumericText></> : "לא צוין"} />
              <GroupRow title="הסימון האחרון" value={estimate.lastLevelReport
                ? <><TankLevel level={estimate.lastLevelReport.level} /> · <NumericText>{timeAgo(estimate.lastLevelReport.at)}</NumericText></> : "עדיין אין"} />
              {fillStyle ? <GroupRow title="כמות רגילה" value={<TankText>{fillStyle}</TankText>} /> : null}
            </div>
            {handle.mileageNote ? <p className="tm-tank-note" data-testid="mileage-precision"><TankText>{handle.mileageNote}</TankText></p> : null}
            {estimate.current.level !== null ? <p className="tm-tank-note" aria-label="עדכון הערכת המיכל">
              {estimate.mobility.kmPerDay !== null && estimate.current.forecastKmSinceOdometer !== null
                ? <>מתעדכן לפי השימוש שנלמד · כ־<Distance value={estimate.current.forecastKmSinceOdometer} /> משוערים מאז העדכון</>
                : "לפי העדכון האחרון · עוד נסיעות יאפשרו עדכון אוטומטי"}
            </p> : null}
            {estimate.reasons.map(reason => <p key={reason} className="tm-tank-note"><TankText>{reason === "untrustedCapacity"
              ? "נפח המיכל משוער. אישור שלו ישפר את ההערכה." : REASON_TEXT[reason].replaceAll("מד הדלק", "מחוון הדלק")}</TankText></p>)}
            <p className="tm-tank-note">הטווחים הם הערכה לפי העדכונים שלך, בהנחה שלא היו תדלוקים שלא נרשמו.</p>
          </div>
        </details>
      </div>
    </Sheet>
    {nested === "odometer" ? <TankOdometerSheet estimate={estimate} onClose={() => setNested(null)} /> : null}
    {nested === "trip" ? <TankTripSheet onClose={() => setNested(null)} /> : null}
  </>;
}

function ForecastRows({ estimate }: { estimate: TankEstimate }) {
  const habit = estimate.habit;
  return <div className="tm-group">
    <GroupRow testId="tank-expected" title="מתי תרצה לתדלק" value={<TankPassage passage={estimate.expectedRefuel} />}
      subtitle={habit.overridden ? <>לפי ההעדפה שלך: כשנשארים <Percent value={habit.typicalLevel * 100} /></>
        : habit.canClaim ? <>לפי ההרגל שלך: כשנשארים <TankHabitLevel habit={habit} /></> : "עוד לומדים את ההרגלים שלך"} />
    <GroupRow testId="tank-recommended" title="מתי כדאי לתדלק לכל המאוחר" value={<TankPassage passage={estimate.recommendedRefuel} />}
      subtitle={estimate.tripPullsForward ? "כדאי לתדלק לפני הנסיעה המתוכננת" : <>לפני שיורדים מתחת ל־<Percent value={estimate.reserveLevel * 100} />, הרזרבה</>} />
    <GroupRow testId="tank-range" title="טווח משוער" subtitle="עד לרזרבה"
      value={estimate.rangeToReserveKm !== null ? <Distance value={estimate.rangeToReserveKm} align="trailing" /> : "לא ידוע"} />
  </div>;
}

function Assumptions({ estimate, units }: { estimate: TankEstimate; units: "kmPerLiter" | "litersPer100" }) {
  const consumption = estimate.consumption.kmPerLiter;
  const dailyKm = estimate.mobility.kmPerDay;
  return <p className="tm-tank-note">
    {consumption !== null ? <>{estimate.consumption.source === "history" ? "לפי הצריכה שנמדדה: " : "לפי נתון הצריכה של הרכב: "}
      <ConsumptionValue kmPerLiter={consumption} units={units} />. </> : "עוד אין נתון צריכה. "}
    {dailyKm !== null ? <>נסיעה יומית משוערת: כ־<Distance value={dailyKm} />.</> : "עוד אין קצב נסיעה יומי."}
  </p>;
}
