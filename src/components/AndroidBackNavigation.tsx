import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { createBackController, EXIT_WINDOW_MS, parentRoute, subscribeBackLayers } from "../lib/backNavigation";
import { listenForNativeBack, minimizeNativeApp } from "../lib/nativeBack";

/** One system Back listener for the whole Capacitor app, including entry flows. */
export function AndroidBackNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading, signingOut } = useAuth();
  const { ready, accountDeletionPending } = useData();
  const { showToast, dismissToast } = useToast();
  const controller = useRef<ReturnType<typeof createBackController> | null>(null);
  const onBack = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    onBack.current = () => {
      // Back follows the app's hierarchy, never the visit history (see parentRoute).
      // The address at the moment of the press: a Back right after a link may beat React's commit.
      const parent = parentRoute(window.location.pathname);
      const atRoot = parent === null;
      const waiting = loading || signingOut || (Boolean(user) && !ready);
      controller.current?.back({
        returnHome: parent !== null && !waiting && !accountDeletionPending
          ? () => navigate(parent, { replace: true }) : undefined,
        canMinimize: atRoot && !waiting && !accountDeletionPending,
      });
    };
  }, [location.pathname, navigate, user, ready, loading, signingOut, accountDeletionPending]);

  useLayoutEffect(() => { controller.current?.routeChanged(); }, [location.key]);
  useLayoutEffect(() => { controller.current?.resetExit(); }, [user, ready, loading, signingOut, accountDeletionPending]);

  useEffect(() => {
    let toast: number | null = null;
    const back = createBackController({
      promptExit: () => { toast = showToast({ tone: "info", title: "לחץ שוב כדי לצאת", duration: EXIT_WINDOW_MS }); },
      clearExitPrompt: () => {
        if (toast !== null) dismissToast(toast);
        toast = null;
      },
      minimize: minimizeNativeApp,
    });
    controller.current = back;
    const unsubscribe = subscribeBackLayers(back.resetExit);
    const stop = listenForNativeBack(() => onBack.current?.(), back.resetExit);
    // The history traversal can finish before React commits an intermediate
    // location. Release the guard even when React only sees the original key.
    window.addEventListener("popstate", back.routeChanged);
    const onVisibilityChange = () => { if (document.hidden) back.resetExit(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      unsubscribe();
      controller.current = null;
      window.removeEventListener("popstate", back.routeChanged);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [showToast, dismissToast]);
  return null;
}
