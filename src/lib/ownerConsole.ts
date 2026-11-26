import { doc, getDocFromServer } from 'firebase/firestore';
import { db } from './firebase';
import { nativeBuild } from './native/platform';

// Fullscreen Chrome is still a desktop browser. Keep the installed standalone app on its own layout.
const DESKTOP_CONSOLE = '(min-width: 1024px) and (display-mode: browser), (min-width: 1024px) and (display-mode: fullscreen)';

export function isDesktopConsole() {
  return !nativeBuild && window.matchMedia(DESKTOP_CONSOLE).matches;
}

export function subscribeDesktopConsole(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_CONSOLE);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export async function getConsoleAccess(uid: string) {
  return (await getDocFromServer(doc(db, 'ownerConsole', 'access'))).data()?.uid === uid;
}

export interface ConsoleProbe {
  at: number;
  hostingMs: number | null;
  firestoreMs: number | null;
  registryMs: number | null;
  version: string | null;
  commit: string | null;
}

export interface ConsoleTelemetry {
  checkedAt: number;
  probes: ConsoleProbe[];
  latency: { end: number; p50: (number | null)[]; p95: (number | null)[] } | null;
  inventory: Record<string, number | null>;
  backups: { at: number; expiresAt: number | null; state: string }[] | null;
}

export async function getConsoleTelemetry(): Promise<ConsoleTelemetry | null> {
  const info = (await getDocFromServer(doc(db, 'ownerConsole', 'telemetry'))).data();
  return info?.version === 1 && Array.isArray(info.probes) ? info as ConsoleTelemetry : null;
}

export async function getDeliveryReport() {
  const data = (await getDocFromServer(doc(db, 'ownerConsole', 'delivery'))).data();
  if (!data || typeof data.checkedAt !== 'number') return null;
  return data as { checkedAt: number; devices: number; messages: number; failed: number; removed: number };
}
