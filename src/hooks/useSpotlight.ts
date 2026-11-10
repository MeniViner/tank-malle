import { useEffect, useMemo, useState } from "react";
import { useData } from "../context/DataContext";
import { useVehicleData } from "../context/VehicleDataContext";
import { deriveSpotlight, readSpotlightDismissals, visibleSpotlight, type PlannedTripWarning } from "../lib/home/spotlight";
import { localDay } from "../lib/maintenance/model";
import type { TankEstimate } from "../lib/tank";
import type { Stats } from "../lib/stats";
import { vehicleDocumentOccurrences, vehicleDocumentSpotlights } from "../lib/vehicle/documentNotifications";

function read(key: string) {
  try { return readSpotlightDismissals(localStorage.getItem(key)); } catch { return []; }
}

/** Dismissals are private to the account and vehicle, including across browser tabs. */
export function useSpotlight(stats: Stats, tank?: TankEstimate) {
  const data = useData(), vehicle = useVehicleData();
  const pullsForward = !!tank?.available && tank.tripPullsForward;
  const rangeToReserveKm = tank?.rangeToReserveKm ?? null;
  // The forecast says a planned trip moves the refuel earlier; name the next such trip.
  const trip = useMemo<PlannedTripWarning | null>(() => {
    if (!pullsForward) return null;
    const next = data.plans
      .map(plan => ({ plan, day: localDay(new Date(plan.date)) }))
      .filter(({ day }) => day >= vehicle.today)
      .sort((a, b) => a.plan.date - b.plan.date)[0];
    return next ? { planId: next.plan.id, day: next.day, distanceKm: next.plan.distanceKm, rangeToReserveKm } : null;
  }, [pullsForward, data.plans, vehicle.today, rangeToReserveKm]);
  const key = `tm.spotlight.v2.${vehicle.uid}.${vehicle.vehicleId}`;
  const historyComplete = !data.loadingFillups && !data.fillupsError && !data.malformedFillups.length && !vehicle.incomplete;
  const [dismissed, setDismissed] = useState(() => ({ key, ids: read(key) }));
  const ids = dismissed.key === key ? dismissed.ids : read(key);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setDismissed({ key, ids: read(key) });
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);
  const candidates = useMemo(() => deriveSpotlight({
    now: vehicle.now, today: vehicle.today, vehicle: data.activeVehicle, units: data.settings.units,
    stats, ledger: vehicle.ledger, outbox: data.outbox, historyComplete,
    storageUnknown: data.outboxReady && data.outboxHealth.state !== "ok",
    reminders: vehicle.reminders, mileage: vehicle.currentMileage, prices: data.prices,
    documents: vehicleDocumentSpotlights(vehicleDocumentOccurrences(data.activeVehicle, vehicle.today)),
    ownerId: vehicle.uid, fillups: data.fillups, dismissedIds: ids, trip,
  }), [trip, vehicle.now, vehicle.today, data.activeVehicle, data.settings.units, stats, vehicle.ledger,
    data.outbox, data.outboxReady, data.outboxHealth.state, vehicle.reminders, vehicle.currentMileage, data.prices, historyComplete,
    vehicle.uid, data.fillups, ids]);
  const items = visibleSpotlight(candidates, new Set(ids));
  const dismiss = (id: string) => {
    const item = candidates.find(item => item.id === id && !item.sticky);
    if (!item) return;
    const next = [...new Set([...read(key), ...ids, ...(item.dismisses ?? []), id])].slice(-200);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Keep the dismissal for this mounted view. */ }
    setDismissed({ key, ids: next });
  };
  return { items, dismiss };
}
