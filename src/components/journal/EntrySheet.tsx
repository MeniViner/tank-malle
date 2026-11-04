import { useState } from "react";
import { useData, type ObservationDeletionSnapshot } from "../../context/DataContext";
import { useVehicleData } from "../../context/VehicleDataContext";
import { fullDate, price, time } from "../../lib/format";
import { fillupEndLabel, observationLevelLabel, serviceMileageWarning } from "../../lib/journal/presentation";
import { EXPENSES, serviceJobs, type ServiceEvent, type VehicleExpense } from "../../lib/maintenance/model";
import type { Stats } from "../../lib/stats";
import type { RefuelReason, TankObservation } from "../../lib/tank/types";
import type { Fillup } from "../../lib/types";
import type { LedgerRow } from "../../lib/vehicle/derived";
import { vehicleDay, vehicleMoney } from "../../lib/vehicle/format";
import { Button } from "../Button";
import { GroupRow } from "../DesignPrimitives";
import { ConsumptionValue, Distance, NumericText, NumRun, Percent, Quantity, SignedMoney } from "../Fmt";
import { PencilIcon, TrashIcon, WarningIcon } from "../icons";
import { Sheet } from "../Sheet";

export interface JournalEntrySelection {
  row: LedgerRow;
  observation: ObservationDeletionSnapshot | null;
}

const REASONS: Record<RefuelReason, string> = {
  "low-fuel": "כמעט נגמר", "good-price": "מחיר טוב", "before-trip": "לפני נסיעה",
  routine: "כרגיל", unsure: "לא בטוח",
};

/** The displayed receipt and its deletion base belong to the same opening snapshot. */
export function JournalEntrySheet({ row, stats, pending, attention, onClose, onEdit, onDelete, onSegment }: {
  row: LedgerRow;
  stats: Stats;
  pending: boolean;
  attention: boolean;
  onClose: () => void;
  onEdit: (row: LedgerRow) => void;
  onDelete: (selection: JournalEntrySelection) => void;
  onSegment: (endId: string) => void;
}) {
  const data = useData(), vehicle = useVehicleData();
  const [opened] = useState(() => ({
    row: { ...row, record: structuredClone(row.record) },
    observation: row.collection === "observations" ? data.captureObservation(row.record as TankObservation) : null,
    paidPriceKnown: row.collection === "fillups" && ((row.record as Fillup).pricePerLiter > 0 || data.fillupPriceKnown.get(row.id) === true),
  }));
  const entry = opened.row;
  const fuel = entry.collection === "fillups" ? entry.record as Fillup : null;
  const service = entry.collection === "serviceEvents" ? entry.record as ServiceEvent : null;
  const expense = entry.collection === "vehicleExpenses" ? entry.record as VehicleExpense : null;
  const observation = entry.collection === "observations" ? entry.record as TankObservation : null;
  const refund = expense?.category === "refund";
  const segment = fuel ? stats.segments.find(item => item.endId === fuel.id) : null;
  const changed = JSON.stringify(row.record) !== JSON.stringify(entry.record);
  const mileageWarning = serviceMileageWarning(entry, vehicle.mileage);
  const stamp = entry.at === null ? vehicleDay(entry.day) : fullDate(entry.at) + ", " + time(entry.at);
  const state = attention ? "דורש בדיקה" : pending ? "ממתין לאישור" : "";
  return <Sheet open title={<h2><NumericText>{entry.title}</NumericText></h2>} onClose={onClose}>
    <div className="journal-entry-sheet" data-testid="journal-entry-sheet" data-entry-key={entry.key}>
      {state ? <p className={"journal-entry-status" + (attention ? " journal-warning" : "")} role="status">{state}</p> : null}
      {changed ? <p className="journal-entry-status journal-warning" role="status">הרשומה עודכנה. סגרו ופתחו אותה שוב כדי לראות את העדכון.</p> : null}
      <div className="journal-entry-headline">
        {entry.financial ? <div>
          {refund && entry.amountAgorot !== null ? <SignedMoney block value={Math.abs(entry.amountAgorot) / 100} className="journal-entry-amount journal-refund" />
            : <NumRun block className="journal-entry-amount">{entry.amountAgorot === null ? "—" : vehicleMoney(entry.amountAgorot)}</NumRun>}
          {entry.amountAgorot === null ? <p className="journal-entry-caption">הסכום לא תועד</p>
            : refund ? <p className="journal-entry-caption">חזר אליכם</p> : null}
        </div> : observation?.level != null ? <div>
          <Percent value={observation.level * 100} block className="journal-entry-amount" />
          <p className="journal-entry-caption">{observationLevelLabel(observation)}</p>
        </div> : entry.odometer !== null ? <div>
          <Distance value={entry.odometer} block className="journal-entry-reading" />
          <p className="journal-entry-caption">קילומטראז׳ שנרשם</p>
        </div> : null}
        {segment ? <button type="button" className="tm-chip journal-segment-chip" disabled={changed}
          data-testid="journal-entry-segment" aria-label="פרטי המקטע" onClick={() => onSegment(segment.endId)}>
          <ConsumptionValue kmPerLiter={segment.kmPerLiter} units={data.settings.units} />
        </button> : null}
      </div>
      <div className="tm-group">
        <GroupRow title="מתי" value={<NumericText>{stamp}</NumericText>} subtitle={entry.at === null ? "שעת האירוע לא תועדה" : undefined} testId="journal-entry-date" />
        {fuel ? <>
          <GroupRow title="ליטרים" value={<Quantity value={fuel.liters} digits={2} align="trailing" />} subtitle={fillupEndLabel(fuel)} testId="journal-entry-liters" />
          <GroupRow title="מחיר לליטר" value={<NumRun align="trailing">{opened.paidPriceKnown ? price(fuel.pricePerLiter) : "—"}</NumRun>}
            subtitle={fuel.postedPricePerLiter != null ? <span>מחיר משאבה שנרשם: <NumRun>{price(fuel.postedPricePerLiter)}</NumRun> לליטר</span> : undefined}
            testId="journal-entry-price" />
        </> : null}
        {service ? <GroupRow title="מה עשו ברכב" value={<NumericText>{serviceJobs(service)}</NumericText>} /> : null}
        {expense ? <GroupRow title="סוג" value={EXPENSES[expense.category]} /> : null}
        {entry.odometer !== null ? <GroupRow title="קילומטראז׳ שנרשם" value={<Distance value={entry.odometer} align="trailing" />} testId="entry-odometer" /> : null}
        {observation?.level != null ? <GroupRow title="מחוון הדלק"
          value={<Percent value={observation.level * 100} align="trailing" />} subtitle={observationLevelLabel(observation)} testId="entry-gauge" /> : null}
        {fuel?.continuityBreakBefore ? <GroupRow title="אחרי תדלוקים שלא נרשמו" subtitle="הצריכה אינה מחושבת דרך הפער הזה." /> : null}
        {fuel?.refuelReason ? <GroupRow title="סיבה" value={REASONS[fuel.refuelReason]} /> : null}
        {service?.garage ? <GroupRow title="מוסך" value={<NumericText>{service.garage}</NumericText>} /> : null}
        {service?.completedPlanIds.length ? <GroupRow title="תזכורות שקושרו לטיפול"
          value={<NumRun align="trailing">{service.completedPlanIds.length}</NumRun>}
          subtitle={<NumericText>{service.completedPlanIds.map(id => vehicle.care.data.maintenancePlans.find(plan => plan.id === id)?.title ?? "תזכורת שאינה זמינה").join(" · ")}</NumericText>} /> : null}
        {entry.notes.trim() ? <GroupRow title="הערה" subtitle={<span className="journal-entry-note"><NumericText>{entry.notes}</NumericText></span>} /> : null}
      </div>
      {mileageWarning ? <p className="journal-entry-warning"><WarningIcon size={18} /><span><NumericText>{mileageWarning}</NumericText></span></p> : null}
      <div className={"journal-entry-actions" + (observation ? " journal-entry-actions-single" : "")}>
        {!observation ? <Button variant="line" size="sm" data-testid="journal-entry-edit" onClick={() => onEdit(entry)}><PencilIcon size={18} />עריכה</Button> : null}
        <Button variant="danger" size="sm" data-testid="journal-entry-delete" disabled={changed}
          onClick={() => onDelete({ row: entry, observation: opened.observation })}><TrashIcon size={18} />מחיקה</Button>
      </div>
    </div>
  </Sheet>;
}
