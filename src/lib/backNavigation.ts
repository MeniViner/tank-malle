import { useLayoutEffect, useRef } from "react";

type BackPriority = "modal" | "screen";
type BackLayer = { onBack: () => void; priority: BackPriority };

// Keep these tied to the lifetime of the UI, not to the browser history. X,
// backdrop and successful saves all unmount the same layer as system Back.
const layers: BackLayer[] = [];
const guards: (() => boolean)[] = [];
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((subscriber) => subscriber());

export function subscribeBackLayers(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => { subscribers.delete(subscriber); };
}

export function registerBackLayer(onBack: () => void, priority: BackPriority = "modal") {
  const layer = { onBack, priority };
  layers.push(layer);
  notify();
  return () => {
    const index = layers.indexOf(layer);
    if (index < 0) return;
    layers.splice(index, 1);
    notify();
  };
}

function closeTopBackLayer() {
  const layer = [...layers].reverse().find(({ priority }) => priority === "modal") ?? layers.at(-1);
  if (!layer) return false;
  layer.onBack();
  return true;
}

export function useBackLayer(active: boolean, onBack: () => void) {
  const latest = useRef(onBack);
  useLayoutEffect(() => { latest.current = onBack; }, [onBack]);
  useLayoutEffect(() => {
    if (active) return registerBackLayer(() => latest.current(), "screen");
  }, [active]);
}

export function useBackGuard(active: boolean, canLeave: () => boolean) {
  const latest = useRef(canLeave);
  useLayoutEffect(() => { latest.current = canLeave; }, [canLeave]);
  useLayoutEffect(() => {
    if (!active) return;
    const guard = () => latest.current();
    guards.push(guard);
    notify();
    return () => {
      guards.splice(guards.indexOf(guard), 1);
      notify();
    };
  }, [active]);
}

export const EXIT_WINDOW_MS = 2000;

type BackDestination = {
  navigateBack?: () => void;
  returnHome?: () => void;
  canMinimize: boolean;
};

export function createBackController({
  closeLayer = closeTopBackLayer, canLeave = () => guards.every((guard) => guard()),
  promptExit, clearExitPrompt, minimize, now = () => performance.now(),
}: {
  closeLayer?: () => boolean;
  canLeave?: () => boolean;
  promptExit: () => void;
  clearExitPrompt: () => void;
  minimize: () => void;
  now?: () => number;
}) {
  let armedAt: number | null = null;
  let navigating = false;
  function resetExit() {
    if (armedAt === null) return;
    armedAt = null;
    clearExitPrompt();
  }
  return {
    resetExit,
    routeChanged() {
      navigating = false;
      resetExit();
    },
    back({ navigateBack, returnHome, canMinimize }: BackDestination) {
      // history.go() is asynchronous. A rapid second press must not skip a
      // screen or arm the exit guard while the first transition is pending.
      if (navigating) return;
      if (closeLayer() || !canLeave()) {
        resetExit();
        return;
      }
      const navigate = navigateBack ?? returnHome;
      if (navigate) {
        resetExit();
        navigating = true;
        navigate();
        return;
      }
      if (!canMinimize) {
        resetExit();
        return;
      }
      const pressedAt = now();
      if (armedAt !== null && pressedAt - armedAt < EXIT_WINDOW_MS) {
        resetExit();
        minimize();
        return;
      }
      resetExit();
      armedAt = pressedAt;
      promptExit();
    },
  };
}

/**
 * Where system Back goes from a screen: never through the visit history (Home → Journal → Home →
 * Journal would replay every tab). A nested screen returns to its tab, a tab returns to Home, and
 * Home asks before leaving the app.
 */
export function parentRoute(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return null;
  if (path.startsWith("/vehicle/")) return "/vehicle";
  if (path.startsWith("/settings/")) return "/account";
  return "/";
}
