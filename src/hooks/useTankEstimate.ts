import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import {
  fitTankModel,
  projectTank,
  tankInputSignature,
  type TankEstimate,
} from "../lib/tank";
import { DEFAULT_TIME_ZONE } from "../lib/tank/config";
import type { NextUpdateKind } from "../lib/tank/types";

/**
 * The tank estimate for the active vehicle.
 *
 * Two memos, not one. Fitting the consumption, travel and habit models depends
 * only on the stored data; projecting that fit to "now" is cheap and has to
 * happen as time passes. Recomputing the whole model on every tick would refit
 * a weekly travel regression to tell somebody a day had gone by.
 *
 * Nothing derived is ever written back to Firestore.
 */

/** How often a visible screen re-projects. Local arithmetic, no network. */
const TICK_MS = 5 * 60_000;

/** The fit's clock is rounded to the hour, so it is not invalidated by a tick. */
const FIT_GRANULARITY_MS = 3600_000;

function dismissKey(uid: string | null, vehicleId: string | null): string {
  return `tm.tankPrompt.${uid ?? "-"}.${vehicleId ?? "-"}`;
}

function readDismissals(key: string): Partial<Record<NextUpdateKind, number>> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Partial<Record<NextUpdateKind, number>>)
      : {};
  } catch {
    // A private window or a cleared store is a normal state, not an error.
    return {};
  }
}

export interface TankEstimateHandle {
  estimate: TankEstimate;
  /** Silence the current next-update prompt for its cooldown. */
  dismissPrompt: (kind: NextUpdateKind) => void;
}

export function useTankEstimate(): TankEstimateHandle {
  const { user } = useAuth();
  const { activeVehicle, fillups, observations, plans, tankPreferences } = useData();
  const uid = user?.uid ?? null;

  const [now, setNow] = useState(() => Date.now());
  const [dismissals, setDismissals] = useState<Partial<Record<NextUpdateKind, number>>>({});

  const storageKey = dismissKey(uid, activeVehicle?.id ?? null);
  useEffect(() => setDismissals(readDismissals(storageKey)), [storageKey]);

  /**
   * A tick that only runs while the screen is actually being looked at, plus an
   * immediate refresh on resume — a phone that was in a pocket for six hours
   * must not come back showing a six-hour-old estimate, and an interval that
   * kept firing in the background would have cost battery to avoid it.
   */
  useEffect(() => {
    let timer: number | undefined;

    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        start();
      } else {
        stop();
      }
    };

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, []);

  const signature = useMemo(
    () =>
      tankInputSignature({
        uid,
        vehicle: activeVehicle,
        fillups,
        observations,
        plans,
        preferences: tankPreferences,
      }),
    [uid, activeVehicle, fillups, observations, plans, tankPreferences],
  );

  // Stabilised so a small model change does not make the headline oscillate.
  const previousLevel = useRef<number | null>(null);

  const fitNow = Math.floor(now / FIT_GRANULARITY_MS) * FIT_GRANULARITY_MS;

  const fit = useMemo(
    () => {
      const result = fitTankModel({
        fillups,
        observations,
        vehicle: activeVehicle,
        preferences: tankPreferences,
        now: fitNow,
        timeZone: DEFAULT_TIME_ZONE,
        previousDisplayLevel: previousLevel.current,
      });
      previousLevel.current = result.habit.displayLevel;
      return result;
    },
    // Keyed on the SIGNATURE rather than on the arrays themselves: it covers
    // every field the model reads, so an edit, a delete, an import rollback, a
    // capacity change or an account switch all invalidate the fit, while a
    // fresh array with identical contents does not.
    [signature, fitNow],
  );

  const estimate = useMemo(
    () =>
      projectTank({
        fit,
        vehicle: activeVehicle,
        preferences: tankPreferences,
        plans,
        now,
        dismissedPrompts: dismissals,
        inputSignature: signature,
      }),
    [fit, activeVehicle, tankPreferences, plans, now, dismissals, signature],
  );

  const dismissPrompt = useCallback(
    (kind: NextUpdateKind) => {
      const next = { ...readDismissals(storageKey), [kind]: Date.now() };
      setDismissals(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Dismissal is a convenience; failing to persist it is not worth an error.
      }
    },
    [storageKey],
  );

  return { estimate, dismissPrompt };
}
