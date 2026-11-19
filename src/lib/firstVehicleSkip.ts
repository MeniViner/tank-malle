import { useSyncExternalStore } from "react";

/**
 * "דלג לעכשיו" on the first-run vehicle wizard: someone without a car can still use the app.
 * Kept per account on this device only; anything that clears this device's local data clears it,
 * and the wizard is offered again. A vehicle can always be added from Home or the vehicle tab.
 */
const key = (uid: string) => `tm.first-vehicle-skipped.${uid}`;
const listeners = new Set<() => void>();
const memory = new Set<string>();   // when storage is unavailable, the skip lasts for this session

export function isFirstVehicleSkipped(uid: string | null | undefined): boolean {
  if (!uid) return false;
  if (memory.has(uid)) return true;
  try { return localStorage.getItem(key(uid)) === "1"; } catch { return false; }
}

export function skipFirstVehicle(uid: string): void {
  memory.add(uid);
  try { localStorage.setItem(key(uid), "1"); } catch { /* the in-memory skip still applies */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useFirstVehicleSkipped(uid: string | null | undefined): boolean {
  return useSyncExternalStore(subscribe, () => isFirstVehicleSkipped(uid), () => false);
}
