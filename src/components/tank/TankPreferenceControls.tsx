import { useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import type { TankEstimate } from "../../lib/tank";
import { useAccountScope } from "../account/useAccountScope";
import { Button } from "../Button";
import { Gauge, GroupRow } from "../DesignPrimitives";
import { GaugeIcon, RestoreIcon } from "../icons";
import { Toggle } from "../Segmented";
import { ConfirmDialog, Sheet } from "../Sheet";
import { TankHabitLevel, TankLevel } from "./TankPresentation";
import "../../tank-design.css";

/** Estimate-fed controls: Home reuses its existing fit; Vehicle owns its wrapper. */
export function TankPreferenceControls({ estimate, embedded = false }: { estimate: TankEstimate; embedded?: boolean }) {
  const { user } = useAuth();
  const { activeVehicle, tankPreferences, updateTankPreferences } = useData();
  const { showToast } = useToast();
  const captureScope = useAccountScope(`${user?.uid ?? ""}/${activeVehicle?.id ?? ""}`);
  const [editor, setEditor] = useState<"reserve" | "habit" | "reset" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const overridden = tankPreferences.refuelLevelOverride !== null;

  async function returnToLearning() {
    if (busy.current || !user || !activeVehicle) return;
    const current = captureScope();
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      await updateTankPreferences({ refuelLevelOverride: null });
      if (current()) showToast({ tone: "info", title: "הבחירה בלמידה אוטומטית נשמרה במכשיר" });
    } catch {
      if (current()) setError("ההעדפה לא נשמרה. אפשר לנסות שוב.");
    } finally {
      busy.current = false;
      if (current()) setSaving(false);
    }
  }

  if (!user || !activeVehicle || !estimate.available) return null;
  const rows = <>
    <GroupRow testId="tank-open-reserve" icon={<GaugeIcon />} title="רזרבה — מתי להתריע"
      value={<TankLevel level={tankPreferences.reserveFraction} />} disabled={saving} onClick={() => setEditor("reserve")} />
    <GroupRow testId="tank-open-habit" title="מתי נוח לתדלק"
      value={overridden ? <><TankLevel level={tankPreferences.refuelLevelOverride} /> · ידני</>
        : estimate.habit.canClaim ? <><TankHabitLevel habit={estimate.habit} /> · נלמד</> : "עוד לומדים"}
      disabled={saving} onClick={() => setEditor("habit")} />
    <fieldset disabled={saving} className="tm-tank-preference-toggle">
      <span>התאמה אישית אוטומטית</span>
      <Toggle checked={!overridden} ariaLabel="התאמה אישית אוטומטית"
        onChange={automatic => { if (busy.current) return; if (automatic) void returnToLearning(); else setEditor("habit"); }} />
    </fieldset>
    <GroupRow icon={<RestoreIcon />} title="איפוס פרופיל ההרגלים" subtitle="התדלוקים נשמרים — רק הלמידה מתחילה מחדש"
      disabled={saving} onClick={() => setEditor("reset")} />
  </>;

  return <>
    {embedded ? rows : <section className="tm-tank-stack">
      <h3 className="tm-tank-section-title">העדפות מיכל</h3><div className="tm-group">{rows}</div>
    </section>}
    {error ? <p role="alert" className="tm-tank-error">{error}</p> : null}
    {editor === "reserve" ? <PreferenceLevelSheet title="רזרבה"
      description="הרמה שממנה כדאי לתדלק. זו העדפה שלך, ולא נפח הרזרבה של היצרן או נורית הדלק."
      initial={tankPreferences.reserveFraction} success="הרזרבה נשמרה במכשיר"
      onSave={level => updateTankPreferences({ reserveFraction: level })} onClose={() => setEditor(null)} /> : null}
    {editor === "habit" ? <PreferenceLevelSheet title="מתי לתדלק"
      description="קביעה ידנית מחליפה את ההרגל שנלמד. אפשר לחזור ללמידה אוטומטית בכל רגע."
      initial={tankPreferences.refuelLevelOverride ?? estimate.habit.typicalLevel} success="ההעדפה נשמרה במכשיר"
      onSave={level => updateTankPreferences({ refuelLevelOverride: level })} onClose={() => setEditor(null)} /> : null}
    {editor === "reset" ? <ResetHabitDialog onClose={() => setEditor(null)} /> : null}
  </>;
}

function PreferenceLevelSheet({ title, description, initial, success, onSave, onClose }: {
  title: string; description: string; initial: number; success: string;
  onSave: (level: number) => Promise<void>; onClose: () => void;
}) {
  const { user } = useAuth();
  const { activeVehicle } = useData();
  const { showToast } = useToast();
  const captureScope = useAccountScope(`${user?.uid ?? ""}/${activeVehicle?.id ?? ""}`);
  const [level, setLevel] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);

  async function save() {
    if (busy.current || !user || !activeVehicle) return;
    const current = captureScope();
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(level);
      if (!current()) return;
      showToast({ tone: "info", title: success });
      onClose();
    } catch {
      if (current()) setError("ההעדפה לא נשמרה. הבחירה נשארה כאן, ואפשר לנסות שוב.");
    } finally {
      busy.current = false;
      if (current()) setSaving(false);
    }
  }

  return <Sheet open title={title} onClose={onClose}>
    <div className="tm-tank-stack">
      <p className="tm-tank-note">{description}</p>
      <div><Gauge value={level} label={title} onChange={saving ? undefined : setLevel} />
        <span className="tm-tank-gauge-reading"><TankLevel level={level} /></span></div>
      {error ? <p role="alert" className="tm-tank-error">{error}</p> : null}
      <Button full loading={saving} onClick={() => void save()}>שמירה</Button>
    </div>
  </Sheet>;
}

function ResetHabitDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { activeVehicle, updateTankPreferences } = useData();
  const { showToast } = useToast();
  const captureScope = useAccountScope(`${user?.uid ?? ""}/${activeVehicle?.id ?? ""}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);

  async function reset() {
    if (busy.current || !user || !activeVehicle) return;
    const current = captureScope();
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      await updateTankPreferences({ habitResetAt: Date.now() });
      if (!current()) return;
      showToast({ tone: "info", title: "איפוס ההרגלים נשמר במכשיר" });
      onClose();
    } catch {
      if (current()) setError("בקשת האיפוס לא נשמרה. אפשר לנסות שוב.");
    } finally {
      busy.current = false;
      if (current()) setSaving(false);
    }
  }

  return <ConfirmDialog open tone="accent" title="לאפס את פרופיל ההרגלים?"
    body={<div className="tm-tank-stack"><p>הלמידה של הרגלי התדלוק תתחיל מחדש. התדלוקים, ההוצאות והצריכה נשארים כפי שהם.</p>
      {error ? <p role="alert" className="tm-tank-error">{error}</p> : null}</div>}
    confirmLabel={saving ? "מאפסים…" : "איפוס"} onConfirm={() => void reset()} onCancel={onClose} />;
}
