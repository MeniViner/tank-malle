import { useEffect, useRef } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import {
  SUMMARY_VERSION,
  summariseVehicle,
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
  const { activeVehicle, activeVehicles, ready } = useData();
  const lastWritten = useRef<Record<string, VehicleSummary>>({});

  useEffect(() => {
    if (!ready || !user || !activeVehicle) return;

    const next = summariseVehicle(activeVehicle, stats);
    if (!summaryChanged(lastWritten.current[activeVehicle.id], next)) return;
    lastWritten.current[activeVehicle.id] = next;

    void setDoc(
      doc(db, "userSummaries", user.uid),
      {
        version: SUMMARY_VERSION,
        vehicleCount: activeVehicles.length,
        vehicles: { [activeVehicle.id]: next },
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ).catch(() => {
      // A summary is telemetry. Failing to write one must never surface to the
      // user or block anything they were doing.
    });
  }, [ready, user, activeVehicle, activeVehicles.length, stats]);
}
