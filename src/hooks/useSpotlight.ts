import { useEffect, useMemo, useState } from "react";
import { useData } from "../context/DataContext";
import { useVehicleData } from "../context/VehicleDataContext";
import { deriveSpotlight, readSpotlightDismissals, visibleSpotlight } from "../lib/home/spotlight";
import type { Stats } from "../lib/stats";
import { vehicleDocumentOccurrences, vehicleDocumentSpotlights } from "../lib/vehicle/documentNotifications";

function read(key: string) {
  try { return readSpotlightDismissals(localStorage.getItem(key)); } catch { return []; }
}

/** Dismissals are private to the account and vehicle, including across browser tabs. */
export function useSpotlight(stats: Stats) {
  const data = useData(), vehicle = useVehicleData();
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
  }), [vehicle.now, vehicle.today, data.activeVehicle, data.settings.units, stats, vehicle.ledger,
    data.outbox, data.outboxReady, data.outboxHealth.state, vehicle.reminders, vehicle.currentMileage, data.prices, historyComplete]);
  const items = visibleSpotlight(candidates, new Set(ids));
  const dismiss = (id: string) => {
    if (!candidates.some(item => item.id === id && !item.sticky)) return;
    const next = [...new Set([...read(key), ...ids, id])].slice(-200);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Keep the dismissal for this mounted view. */ }
    setDismissed({ key, ids: next });
  };
  return { items, dismiss };
}
