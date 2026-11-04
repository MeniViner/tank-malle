import { useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { parseDecimal } from "../../lib/format";
import { addLocalDays } from "../../lib/tank/calendar";
import { DEFAULT_TIME_ZONE } from "../../lib/tank/config";
import { Button } from "../Button";
import { Field } from "../Field";
import { NumericText } from "../Fmt";
import { CalendarIcon, RoadIcon } from "../icons";
import { Segmented, type SegmentedOption } from "../Segmented";
import { Sheet } from "../Sheet";
import { useAccountScope } from "../account/useAccountScope";

type TripDay = "0" | "1" | "3" | "7";
type TripMode = "additional" | "replaces";

const DAYS: SegmentedOption<TripDay>[] = [
  { value: "0", label: "היום" },
  { value: "1", label: "מחר" },
  { value: "3", label: "בעוד 3 ימים" },
  { value: "7", label: "בעוד שבוע" },
];

const MODES: SegmentedOption<TripMode>[] = [
  { value: "additional", label: "בנוסף לנהיגה הרגילה" },
  { value: "replaces", label: "במקום הנהיגה הרגילה" },
];

/** Mounted for one editor session. A plan changes the forecast, never measured travel. */
export function TankTripSheet({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { activeVehicle, addPlan } = useData();
  const { showToast } = useToast();
  const captureScope = useAccountScope(user && activeVehicle ? `${user.uid}/${activeVehicle.id}` : null);
  const busyRef = useRef(false);
  const [distance, setDistance] = useState("");
  const [buffer, setBuffer] = useState("");
  const [days, setDays] = useState<TripDay>("1");
  const [mode, setMode] = useState<TripMode>("additional");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const parsedDistance = parseDecimal(distance);
  const valid = Number.isFinite(parsedDistance) && parsedDistance > 0;

  async function save() {
    if (!user || !activeVehicle || !valid || busyRef.current) return;
    const current = captureScope();
    const parsedBuffer = parseDecimal(buffer);
    busyRef.current = true;
    setSaving(true);
    setError("");
    try {
      await addPlan({
        date: addLocalDays(Date.now(), Number(days), DEFAULT_TIME_ZONE),
        distanceKm: parsedDistance,
        mode,
        bufferKm: Number.isFinite(parsedBuffer) && parsedBuffer > 0 ? parsedBuffer : null,
      });
      if (!current()) return;
      // addPlan returns after durable journaling and SDK handoff, before server ACK.
      showToast({ tone: "info", title: "הנסיעה נשמרה במכשיר", detail: "ממתינה לאישור השרת." });
      onClose();
    } catch {
      if (current()) setError("השמירה לא הושלמה. נסו שוב.");
    } finally {
      busyRef.current = false;
      if (current()) setSaving(false);
    }
  }

  return <Sheet open onClose={onClose} title="נסיעה מתוכננת">
    <div className="tm-tank-form" data-testid="tank-trip-sheet">
      <fieldset disabled={saving} className="tm-tank-form-fields">
        <Field big label="מרחק צפוי" inputMode="decimal" suffix="ק״מ" value={distance}
          icon={<RoadIcon size={22} />} data-testid="tank-trip-distance" placeholder="0"
          onChange={event => setDistance(event.target.value)} />
        <Field label="מרווח ביטחון (לא חובה)" inputMode="decimal" suffix="ק״מ" value={buffer}
          data-testid="tank-trip-buffer" placeholder="0" onChange={event => setBuffer(event.target.value)} />
        <div className="tm-tank-form-choice tm-tank-trip-days" data-testid="tank-trip-days">
          <span className="tm-tank-form-label"><CalendarIcon size={18} />מתי</span>
          <Segmented value={days} options={DAYS} onChange={setDays} ariaLabel="מועד הנסיעה" size="sm" />
        </div>
        <div className="tm-tank-form-choice tm-tank-trip-mode" data-testid="tank-trip-mode">
          <span className="tm-tank-form-label">הנסיעה היא</span>
          <Segmented value={mode} options={MODES} onChange={setMode} ariaLabel="אופי הנסיעה" />
        </div>
      </fieldset>
      <p className="tm-tank-note">הנסיעה משנה את התחזית בלבד. היא לא מתווספת לקילומטראז׳ או לדלק שנצרך.</p>
      {error ? <p role="alert" className="tm-tank-error"><NumericText>{error}</NumericText></p> : null}
      <Button full data-testid="tank-save-trip" loading={saving} disabled={!valid || !user || !activeVehicle}
        onClick={() => void save()}>שמירה</Button>
    </div>
  </Sheet>;
}
