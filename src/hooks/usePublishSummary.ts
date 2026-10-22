import { useEffect, useRef } from "react";
import { doc, serverTimestamp, runTransaction } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useVehicleData } from '../context/VehicleDataContext';
import {
  SUMMARY_VERSION,
  summariseVehicle,
  summariseLedger,
  summaryChanged,
  type VehicleSummary,
} from "../lib/summary";
import type { Stats } from "../lib/stats";

/**
 * Publish this account's operational summary.
 *
 * The admin dashboard needs counts and averages. Producing them by reading
 * everyone's fill-up records is both a privacy cost and the unbounded read
 * pattern that made /admin a quota risk, so each client publishes what it has
 * already computed instead.
 *
 * Only the ACTIVE vehicle's figures are written, because those are the only
 * ones this client has loaded — writing anything about the others would be
 * inventing it. The document merges, so a household's second car appears once
 * its owner opens it, and each entry carries its own `updatedAt` so the
 * dashboard can say how current it is rather than implying it is live.
 *
 * Throttled to real changes. This runs on a screen people revisit constantly.
 */
export function usePublishSummary(stats: Stats): void {
  const { user } = useAuth();
  const vehicleData = useVehicleData();
  const { activeVehicle, activeVehicles, ready, loadingFillups, accountDeletionPending, loadVehicleCatalog } = useData();
  const lastWritten = useRef<Record<string, VehicleSummary>>({});
  const lastScope = useRef("");

  useEffect(() => {
    if (!ready || !user || loadingFillups || accountDeletionPending || (activeVehicle && vehicleData.incomplete)) return;
    const next = activeVehicle ? { ...summariseVehicle(activeVehicle, stats), ledger: summariseLedger(vehicleData.ledger) } : null;
    const scope = JSON.stringify([user.uid, activeVehicles.map((v) => v.id).sort()]);
    const key = `${user.uid}/${activeVehicle?.id ?? "none"}`;
    if (scope === lastScope.current && (!next || !summaryChanged(lastWritten.current[key], next))) return;
    lastScope.current = scope;
    if (next) lastWritten.current[key] = next;
    // A cached vehicle list must never erase another car's server summary.
    void loadVehicleCatalog().then((catalog) => runTransaction(db, async (transaction) => {
      const ref = doc(db, "userSummaries", user.uid);
      const current = await transaction.get(ref);
      const activeIds = new Set(catalog.filter((v) => !v.archived).map((v) => v.id));
      const vehicles = Object.fromEntries(Object.entries(current.data()?.vehicles ?? {}).filter(([id]) => activeIds.has(id)));
      if (activeVehicle && next && activeIds.has(activeVehicle.id)) vehicles[activeVehicle.id] = next;
      transaction.set(ref, { version: SUMMARY_VERSION, vehicleCount: activeIds.size, vehicles, updatedAt: serverTimestamp() });
    })).catch(() => {
      delete lastWritten.current[key];
      if (lastScope.current === scope) lastScope.current = "";
    });
  }, [ready, user, activeVehicle, activeVehicles, stats, loadingFillups, accountDeletionPending, loadVehicleCatalog, vehicleData.incomplete, vehicleData.ledger]);
}
