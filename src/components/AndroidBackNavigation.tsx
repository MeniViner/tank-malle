import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { createBackController, EXIT_WINDOW_MS, subscribeBackLayers } from "../lib/backNavigation";
import { listenForNativeBack, minimizeNativeApp } from "../lib/nativeBack";

/** One system Back listener for the whole Capacitor app, including entry flows. */
export function AndroidBackNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading, signingOut } = useAuth();
  const { ready, accountDeletionPending } = useData();
  const { showToast, dismissToast } = useToast();
  const toast = useRef<number | null>(null);
  const controller = useMemo(() => createBackController({
    promptExit: () => { toast.current = showToast({ tone: "info", title: "לחץ שוב כדי לצאת", duration: EXIT_WINDOW_MS }); },
    clearExitPrompt: () => {
      if (toast.current !== null) dismissToast(toast.current);
      toast.current = null;
    },
    minimize: minimizeNativeApp,
  }), [showToast, dismissToast]);

  const onBack = useRef((_: boolean) => {});
  useLayoutEffect(() => {
    onBack.current = (canGoBack) => {
      // React Router's index is relative to this app. WebView history can
      // include sign-in redirects and must never send Back outside the app.
      const index = window.history.state?.idx;
      const hasAppHistory = typeof index === "number" && index > 0
        && (canGoBack || window.history.length > 1);
      const atRoot = location.pathname === "/";
      const waiting = loading || signingOut || (Boolean(user) && !ready);
      controller.back({
        navigateBack: hasAppHistory ? () => navigate(-1) : undefined,
        returnHome: !atRoot && !waiting && !accountDeletionPending
          ? () => navigate("/", { replace: true }) : undefined,
        canMinimize: atRoot && !waiting && !accountDeletionPending,
      });
    };
  }, [controller, location.pathname, navigate, user, ready, loading, signingOut, accountDeletionPending]);

  useLayoutEffect(() => { controller.routeChanged(); }, [controller, location.key]);
  useLayoutEffect(() => { controller.resetExit(); }, [controller, user, ready, loading, signingOut, accountDeletionPending]);
  useLayoutEffect(() => subscribeBackLayers(controller.resetExit), [controller]);

  useEffect(() => {
    const stop = listenForNativeBack((canGoBack) => onBack.current(canGoBack), controller.resetExit);
    const onVisibilityChange = () => { if (document.hidden) controller.resetExit(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [controller]);
  return null;
}
