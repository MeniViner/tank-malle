import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useVehicleData } from "../../context/VehicleDataContext";
import { accountTotals, loadAccountExport, type AccountExport } from "../../lib/accountExport";
import { db } from "../../lib/firebase";

/** Preserve the all-vehicle server snapshot plus the ready active-vehicle overlay. */
export function useAccountSummary() {
  const { user } = useAuth();
  const uid = user?.uid;
  const { vehicles, activeVehicle, fillups, observations, plans, accountDeletionPending, ready,
    loadingFillups, fillupsError, malformedFillups, observationsStatus } = useData();
  const vehicleData = useVehicleData();
  const [accountSnapshot, setAccountSnapshot] = useState<{ uid: string; data: AccountExport; at: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  const catalogKey = vehicles.map(vehicle => vehicle.id).sort().join("/");

  useEffect(() => {
    if (!uid || !ready || accountDeletionPending) return;
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void loadAccountExport(db, uid).then(
        data => { if (current) setAccountSnapshot({ uid, data, at: Date.now() }); },
        () => { if (current) setError("לא ניתן לרענן את נתוני כל הרכבים. נדרש חיבור לשרת."); },
      ).finally(() => { if (current) setLoading(false); });
    }, 100);
    return () => { current = false; window.clearTimeout(timer); };
  }, [uid, ready, accountDeletionPending, attempt, catalogKey, activeVehicle?.id]);

  const snapshot = accountSnapshot?.uid === uid && !accountDeletionPending ? accountSnapshot : null;
  const liveReady = !!activeVehicle && vehicleData.uid === uid && vehicleData.vehicleId === activeVehicle.id
    && !vehicleData.care.loading && !vehicleData.care.errors.length && !vehicleData.care.malformed
    && !loadingFillups && !fillupsError && !malformedFillups.length
    && (observationsStatus === "ready" || observationsStatus === "cached");
  const records = useMemo(() => {
    if (!snapshot) return null;
    if (!liveReady || !activeVehicle) return accountTotals(snapshot.data, vehicleData.today);
    const id = activeVehicle.id;
    return accountTotals({
      ...snapshot.data,
      vehicles,
      rows: [...snapshot.data.rows.filter(row => row.vehicle?.id !== id), ...fillups.map(fillup => ({ vehicle: activeVehicle, fillup }))],
      observations: [...snapshot.data.observations.filter(row => row.vehicleId !== id), ...observations],
      plans: [...snapshot.data.plans.filter(row => row.vehicleId !== id), ...plans],
      vehicleCare: { ...snapshot.data.vehicleCare, [id]: vehicleData.care.data },
    }, vehicleData.today);
  }, [snapshot, liveReady, activeVehicle, vehicles, fillups, observations, plans, vehicleData.care.data, vehicleData.today]);

  return { records, snapshot, liveReady, loading, error, refresh, activeVehicle, vehicles,
    incomplete: vehicleData.incomplete, canRefresh: !!uid && !accountDeletionPending };
}

export type AccountSummary = ReturnType<typeof useAccountSummary>;
