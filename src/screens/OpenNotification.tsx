import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useData } from "../context/DataContext";
import { parseNotificationLink } from "../lib/push/link";
import { Splash } from "./Splash";

/**
 * Landing route of a phone notification: selects the vehicle the notification is
 * about, then continues to its screen. A vehicle that is gone or archived, or a
 * link that does not parse, ends at the notifications list.
 */
export default function OpenNotification() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { vehicles, activeVehicle, setActiveVehicle } = useData();
  const switching = useRef(false);
  const target = parseNotificationLink(params);
  const vehicleId = target?.vehicleId ?? null, to = target?.to ?? null;
  const known = vehicles.some(v => v.id === vehicleId && !v.archived && !v.deletionPending);
  const active = activeVehicle?.id ?? null;

  useEffect(() => {
    if (!vehicleId || !to || !known) { navigate("/notifications", { replace: true }); return; }
    if (active === vehicleId) { navigate(to, { replace: true }); return; }
    if (switching.current) return;
    switching.current = true;
    // The selection re-renders this screen with the new active vehicle, which then navigates.
    setActiveVehicle(vehicleId).catch(() => navigate("/notifications", { replace: true }));
  }, [vehicleId, to, known, active, navigate, setActiveVehicle]);

  return <Splash />;
}
