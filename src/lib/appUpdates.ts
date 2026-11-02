export const BEFORE_APP_UPDATE = 'tm:before-app-update';
export const APP_UPDATE_AVAILABLE = 'tm:app-update-available';
function announceAvailable(reload = false): 'available' {
  window.dispatchEvent(new CustomEvent(APP_UPDATE_AVAILABLE, { detail: { reload } }));
  return 'available';
}

/** Editors can refuse activation while a local save is incomplete. */
export function canReloadForUpdate(): boolean {
  return window.dispatchEvent(new Event(BEFORE_APP_UPDATE, { cancelable: true }));
}

/** An installed PWA can resume without navigation. Discover updates on
 * resume/reconnect; activation always remains the user's choice. */
export function watchAppUpdates(registration: ServiceWorkerRegistration): () => void {
  let lastCheck = -Infinity;
  let checking = false;
  const check = () => {
    if (document.visibilityState === 'hidden' || !navigator.onLine || checking ||
        registration.installing || Date.now() - lastCheck < 60_000) return;
    lastCheck = Date.now(); checking = true;
    void registration.update().then(() => { if (registration.waiting) announceAvailable(); })
      .catch(() => { /* Keep the working offline build. */ }).finally(() => { checking = false; });
  };
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', check);
  const timer = window.setInterval(check, 60 * 60_000);
  check();
  return () => {
    window.removeEventListener('focus', check);
    window.removeEventListener('online', check);
    document.removeEventListener('visibilitychange', check);
    window.clearInterval(timer);
  };
}

export interface BuildIdentity { version: string; commit: string; dirty: boolean }
export type UpdateCheck = 'available' | 'current' | 'offline' | 'error';
export interface UpdateCheckResult { status: UpdateCheck; release?: BuildIdentity }

function buildIdentity(value: unknown): BuildIdentity {
  const info = value as Partial<BuildIdentity> | null;
  if (!info || typeof info.version !== 'string' || !info.version.trim() ||
      typeof info.commit !== 'string' || !/^[a-f0-9]{40}$/.test(info.commit) ||
      typeof info.dirty !== 'boolean') throw new Error('Invalid release identity');
  return { version: info.version, commit: info.commit, dirty: info.dirty };
}

function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Update check timed out'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function installed(worker: ServiceWorker, signal: AbortSignal, activation = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { worker.removeEventListener('statechange', changed); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new Error('Update installation timed out')); };
    const changed = () => {
      if ((!activation && worker.state === 'installed') || worker.state === 'activated') { cleanup(); resolve(); }
      else if (worker.state === 'redundant') { cleanup(); reject(new Error('Update installation failed')); }
    };
    worker.addEventListener('statechange', changed);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else changed();
  });
}

/** An uncontrolled first tab does not receive a controlling event when the
 * waiting worker activates without clientsClaim. Bound that explicit action. */
export async function waitForWorkerActivation(worker: ServiceWorker): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try { await installed(worker, controller.signal, true); }
  finally { clearTimeout(timer); }
}

/** Check this origin's published build, not just whether a worker is waiting.
 * A newer worker may already be active while this tab still runs older JS.
 * No storage is cleared and activation/reload remains a guarded user action. */
export async function checkAppUpdate(current: BuildIdentity): Promise<UpdateCheckResult> {
  if (!navigator.onLine) return { status: 'offline' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let release: BuildIdentity | undefined;
  try {
    const response = await bounded(fetch('/build-info.json', {
      cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }, signal: controller.signal,
    }), controller.signal);
    if (!response.ok) throw new Error('Release identity unavailable');
    release = buildIdentity(await bounded(response.json(), controller.signal));
    const registration = 'serviceWorker' in navigator
      ? await bounded(navigator.serviceWorker.getRegistration(), controller.signal) : undefined;
    if (registration) {
      await bounded(registration.update(), controller.signal);
      if (registration.installing) await installed(registration.installing, controller.signal);
      if (registration.waiting) return { status: announceAvailable(), release };
    }
    const same = release.commit === current.commit && release.version === current.version && release.dirty === current.dirty;
    return { status: same ? 'current' : announceAvailable(true), release };
  } catch { return { status: navigator.onLine ? 'error' : 'offline', release }; }
  finally { clearTimeout(timer); }
}
