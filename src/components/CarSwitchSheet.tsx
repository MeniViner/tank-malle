import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { formatPlate, vehicleLabel, vehicleShort } from "../lib/format";
import { Button } from "./Button";
import { MiniPlate } from "./DesignPrimitives";
import { NumericText } from "./Fmt";
import { Sheet } from "./Sheet";
import { CarIcon, CheckIcon, PlusIcon } from "./icons";

/** A mounted sheet belongs to one account; a late selection cannot close a new sheet. */
export function CarSwitchSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeVehicle, activeVehicles, vehicles, setActiveVehicle } = useData();
  const { showToast } = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const uid = useRef(user?.uid);
  useLayoutEffect(() => { uid.current = user?.uid; }, [user?.uid]);
  const busy = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function select(vehicleId: string) {
    if (busy.current) return;
    const vehicle = activeVehicles.find(item => item.id === vehicleId);
    if (!vehicle || !user) return;
    if (vehicleId === activeVehicle?.id) { onClose(); return; }
    const owner = user.uid;
    busy.current = true;
    setPending(vehicleId);
    setError(null);
    try {
      await setActiveVehicle(vehicleId);
      if (!mounted.current || uid.current !== owner) return;
      onClose();
      showToast({ tone: "info", title: "הרכב הפעיל הוחלף" });
    } catch {
      if (mounted.current && uid.current === owner) setError("לא הצלחנו להחליף רכב. נסו שוב.");
    } finally {
      busy.current = false;
      if (mounted.current && uid.current === owner) setPending(null);
    }
  }

  function go(path: string) { onClose(); navigate(path); }

  return <Sheet open onClose={onClose} title="הרכבים שלי">
    <div className="tm-car-switch" data-testid="car-switch-sheet">
      <div className="tm-car-choices" aria-label="רכבים פעילים">
        {activeVehicles.map(vehicle => {
          const selected = vehicle.id === activeVehicle?.id;
          const detail = vehicle.nickname?.trim()
            ? `${vehicle.make} ${vehicle.model}${vehicle.year ? ` · ${vehicle.year}` : ""}`
            : vehicle.year ? String(vehicle.year) : "";
          return <button key={vehicle.id} type="button" className="tm-car-choice"
            data-testid={`car-switch-${vehicle.id}`} aria-pressed={selected}
            aria-label={`${vehicleLabel(vehicle)}${vehicle.plateNumber ? `, לוחית ${formatPlate(vehicle.plateNumber)}` : ""}${selected ? ", הרכב הפעיל" : ""}`}
            disabled={pending !== null} aria-busy={pending === vehicle.id || undefined}
            onClick={() => void select(vehicle.id)}>
            {vehicle.plateNumber ? <MiniPlate plate={vehicle.plateNumber} /> : <CarIcon size={24} />}
            <span className="tm-car-choice-copy">
              <strong><NumericText>{vehicleShort(vehicle)}</NumericText></strong>
              {detail ? <span><NumericText>{detail}</NumericText></span> : null}
            </span>
            {selected ? <CheckIcon size={22} className="shrink-0" /> : null}
          </button>;
        })}
        {activeVehicles.length === 0 ? <p className="tm-car-switch-empty">
          {vehicles.length ? "כל הרכבים נמצאים בארכיון." : "עוד אין רכב בחשבון."}
        </p> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-danger-ink">{error}</p> : null}
      <Button variant="line" full disabled={pending !== null} onClick={() => go("/vehicles/new")}>
        <PlusIcon size={20} />הוספת רכב
      </Button>
      <button type="button" className="tm-car-manage-link" disabled={pending !== null}
        onClick={() => go("/settings/vehicles")} data-testid="car-switch-manage">ניהול רכבים וארכיון</button>
    </div>
  </Sheet>;
}
