import { useRef, useState, type ReactNode, type Ref } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { num, timeAgo } from "../../lib/format";
import { parseNumber } from "../../lib/numeric";
import type { TankEstimate } from "../../lib/tank";
import { GAUGE_SD_BY_SOURCE } from "../../lib/tank/config";
import { displayTankLevel } from "../../lib/tank/display";
import { snapLevel } from "../../lib/tank/gaugeInteraction";
import { useAccountScope } from "../account/useAccountScope";
import { Button } from "../Button";
import { Gauge } from "../DesignPrimitives";
import { Field } from "../Field";
import { NumericText, NumRun, Quantity } from "../Fmt";
import { Sheet } from "../Sheet";
import { TankLevel } from "./TankPresentation";

interface GaugeEditorProps {
  estimate: TankEstimate;
  onSaved: () => void;
  children?: ReactNode;
  controlRef?: Ref<HTMLDivElement>;
}

/** An estimate is a starting position, never evidence until the user selects it. */
export function GaugeObservationEditor({ estimate, onSaved, children, controlRef }: GaugeEditorProps) {
  const { user } = useAuth();
  const { activeVehicle, addObservation } = useData();
  const captureScope = useAccountScope(`${user?.uid ?? ""}/${activeVehicle?.id ?? ""}`);
  const [level, setLevel] = useState<number | null>(() => {
    const displayed = displayTankLevel(estimate);
    return displayed === null ? null : snapLevel(displayed, null);
  });
  const [userInteracted, setUserInteracted] = useState(false);
  const [odometer, setOdometer] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const parsedOdometer = parseNumber(odometer, "odometer");
  const hasOdometer = odometer.trim().length > 0;
  const odometerValid = !hasOdometer || Number.isInteger(parsedOdometer) && parsedOdometer > 0
    && parsedOdometer < 3_000_000 && (!estimate.lastOdometer || parsedOdometer >= estimate.lastOdometer.value);

  function chooseLevel(next: number) {
    if (busy.current) return;
    setLevel(next);
    setUserInteracted(true);
    setError("");
  }

  async function save() {
    if (busy.current || !user || !activeVehicle || !userInteracted || level === null || !odometerValid) return;
    const current = captureScope();
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      await addObservation({
        observedAt: Date.now(),
        kind: hasOdometer ? "both" : "level",
        odometer: hasOdometer ? parsedOdometer : null,
        level,
        levelUncertainty: GAUGE_SD_BY_SOURCE["direct-gauge"],
        levelSource: "direct-gauge",
        confirmed: true,
        phase: "standalone",
      });
      if (!current()) return;
      onSaved();
    } catch {
      if (current()) setError("העדכון לא נשמר. הפרטים שהקלדת נשארו כאן, ואפשר לנסות שוב.");
    } finally {
      busy.current = false;
      if (current()) setSaving(false);
    }
  }

  return <div className="tm-tank-gauge-editor">
    <div ref={controlRef} data-testid="tank-gauge">
      <Gauge value={level} habit={estimate.habit.canClaim || estimate.habit.overridden ? estimate.habit.typicalLevel : null}
        label="כמה דלק יש עכשיו במיכל" onChange={saving ? undefined : chooseLevel} />
      <span className="tm-tank-gauge-reading"><TankLevel level={level} /></span>
      {estimate.capacityLiters !== null && level !== null ? <span className="tm-tank-note">כ־<Quantity value={level * estimate.capacityLiters} digits={0} long />{estimate.capacityTrusted ? "" : " לפי נפח משוער"}</span> : null}
    </div>
    {children}
    <Field row label="קילומטראז׳ (לא חובה)" inputMode="numeric" suffix="ק״מ" value={odometer}
      disabled={saving} onChange={event => setOdometer(event.target.value)} placeholder="—"
      error={!odometerValid ? "הזינו קילומטראז׳ שלם שאינו נמוך מהקריאה האחרונה" : undefined} />
    {error ? <p role="alert" className="tm-tank-error">{error}</p> : null}
    <Button full data-testid="tank-save-gauge" disabled={!user || !activeVehicle || !userInteracted || level === null || !odometerValid}
      loading={saving} onClick={() => void save()}>עדכון המחוון</Button>
  </div>;
}

/** A typed odometer remains a standalone observation, with no litres or spending. */
export function TankOdometerSheet({ estimate, onClose }: { estimate: TankEstimate; onClose: () => void }) {
  const { user } = useAuth();
  const { activeVehicle, addObservation } = useData();
  const captureScope = useAccountScope(`${user?.uid ?? ""}/${activeVehicle?.id ?? ""}`);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const parsed = parseNumber(value, "odometer");
  const valid = Number.isInteger(parsed) && parsed > 0 && parsed < 3_000_000
    && (!estimate.lastOdometer || parsed >= estimate.lastOdometer.value);

  async function save() {
    if (busy.current || !user || !activeVehicle || !valid) return;
    const current = captureScope();
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      await addObservation({ observedAt: Date.now(), kind: "odometer", odometer: parsed, confirmed: true, phase: "standalone" });
      if (!current()) return;
      onClose();
    } catch {
      if (current()) setError("העדכון לא נשמר. אפשר לנסות שוב בלי להקליד מחדש.");
    } finally {
      busy.current = false;
      if (current()) setSaving(false);
    }
  }

  return <Sheet open onClose={onClose} title="עדכון קילומטראז׳">
    <div className="tm-tank-stack" data-testid="tank-odometer-sheet">
      <Field big label="קילומטראז׳ נוכחי" inputMode="numeric" suffix="ק״מ" value={value} disabled={saving}
        onChange={event => setValue(event.target.value)} placeholder="0"
        error={value.trim() && !valid ? "הזינו קילומטראז׳ שלם שאינו נמוך מהקריאה האחרונה" : undefined}
        hint={estimate.lastOdometer ? <>אחרון: <NumRun>{num(estimate.lastOdometer.value, 0)}</NumRun> · <NumericText>{timeAgo(estimate.lastOdometer.at)}</NumericText></>
          : "המספר שמופיע בלוח הקילומטרים. העדכון אינו תדלוק."} />
      {error ? <p role="alert" className="tm-tank-error">{error}</p> : null}
      <Button full loading={saving} disabled={!user || !activeVehicle || !valid} onClick={() => void save()}>שמירה</Button>
    </div>
  </Sheet>;
}
