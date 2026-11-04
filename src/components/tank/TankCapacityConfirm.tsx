import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../Button";
import { Quantity } from "../Fmt";
import { useAccountScope } from "../account/useAccountScope";
import { TankText } from "./TankPresentation";

/** Keep mounted during the sheet session, including the optimistic capacity update. */
export function TankCapacityConfirm({ liters, note, available = true }: {
  liters: number;
  note: string;
  available?: boolean;
}) {
  const { user } = useAuth();
  const { activeVehicle, updateVehicle } = useData();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const captureScope = useAccountScope(user && activeVehicle ? `${user.uid}/${activeVehicle.id}` : null);
  const busyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [attemptLiters, setAttemptLiters] = useState<number | null>(null);

  async function confirmCapacity() {
    if (!user || !activeVehicle || !available || !Number.isFinite(liters) || liters <= 0 || busyRef.current) return;
    const current = captureScope();
    const confirmedLiters = liters;
    const deadline = Date.now() + 6000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    busyRef.current = true;
    setAttemptLiters(confirmedLiters);
    setSaving(true);
    try {
      const receipt = await updateVehicle(activeVehicle.id, { tankLiters: confirmedLiters, tankLitersSource: "user" });
      if (!current()) return;
      const saved = await Promise.race([
        receipt.settled,
        new Promise<null>(resolve => {
          timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
        }),
      ]);
      if (!current()) return;
      if (saved === false) throw new Error("capacity-update-rejected");
      showToast({
        tone: saved === true ? "success" : "info",
        title: saved === true ? "נפח המיכל אושר" : "האישור נשמר במכשיר",
        detail: saved === true ? undefined : "ממתין לאישור השרת. אפשר לבדוק במסך שינויים שעוד לא עלו לענן.",
      });
    } catch {
      if (current()) showToast({
        tone: "error",
        title: "נפח המיכל לא אושר בשרת",
        detail: "נסו שוב או פתחו את השינויים שעוד לא עלו לענן.",
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      busyRef.current = false;
      if (current()) setSaving(false);
    }
  }

  const displayedLiters = saving && attemptLiters !== null ? attemptLiters : liters;
  if (!user || !activeVehicle || (!available && !saving) || !Number.isFinite(displayedLiters) || displayedLiters <= 0) return null;

  return <section className="tm-tank-capacity-confirm" aria-label="אישור נפח המיכל" data-testid="tank-capacity-prompt">
    <div className="tm-tank-capacity-copy">
      <span className="tm-tank-form-label">נפח המיכל המשוער</span>
      <Quantity value={displayedLiters} digits={0} long block className="tm-tank-capacity-number" />
      {note ? <p className="tm-tank-note"><TankText>{note}</TankText></p> : null}
    </div>
    <div className="tm-tank-capacity-actions">
      <Button size="sm" loading={saving} disabled={!available} data-testid="tank-capacity-confirm"
        onClick={() => void confirmCapacity()}>מאשר</Button>
      <Button size="sm" variant="line" disabled={saving} data-testid="tank-capacity-correct"
        onClick={() => navigate("/vehicle?tab=details")}>תיקון</Button>
    </div>
  </section>;
}
