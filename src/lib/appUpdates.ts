export const BEFORE_APP_UPDATE = 'tm:before-app-update';
export const APP_UPDATE_AVAILABLE = 'tm:app-update-available';
function announceAvailable(): 'available' {
  window.dispatchEvent(new Event(APP_UPDATE_AVAILABLE));
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

export type UpdateCheck = 'available' | 'current' | 'offline' | 'unavailable' | 'error';
export async function checkAppUpdate(): Promise<UpdateCheck> {
  if (!navigator.onLine) return 'offline';
  if (!('serviceWorker' in navigator)) return 'unavailable';
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return 'unavailable';
    await registration.update();
    if (registration.waiting) return announceAvailable();
    const installing = registration.installing;
    if (installing) {
      await new Promise<void>((resolve, reject) => {
        const changed = () => {
          if (installing.state === 'installed' || installing.state === 'activated') {
            installing.removeEventListener('statechange', changed); resolve();
          } else if (installing.state === 'redundant') {
            installing.removeEventListener('statechange', changed); reject(new Error('Update installation failed'));
          }
        };
        installing.addEventListener('statechange', changed); changed();
      });
    }
    return registration.waiting ? announceAvailable() : 'current';
  } catch { return 'error'; }
}
