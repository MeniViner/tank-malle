import { useCallback, useEffect, useState } from "react";

/**
 * Chrome fires this instead of showing its own install banner, and only when
 * the PWA criteria are met. It is not in lib.dom, so it is declared here.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState =
  /** Already running from the home screen / app drawer. */
  | "installed"
  /** The browser handed us a prompt we can fire. */
  | "available"
  /** Installable, but this browser (iOS Safari) has no programmatic prompt. */
  | "manual";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/**
 * Installing the app to the device's app drawer / home screen.
 *
 * `state` is never a guess: "available" means we are actually holding a
 * deferred prompt, and iOS — which has no such API — is reported as "manual"
 * with instructions rather than a button that would do nothing.
 */
export function useInstallPrompt(): {
  state: InstallState;
  install: () => Promise<boolean>;
} {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event is single-use, whatever the answer was.
    setDeferred(null);
    if (outcome === "accepted") setInstalled(true);
    return outcome === "accepted";
  }, [deferred]);

  const state: InstallState = installed
    ? "installed"
    : deferred
      ? "available"
      : "manual";

  return { state, install };
}
