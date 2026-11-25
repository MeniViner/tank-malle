import { nativeBuild } from '../native/platform';
import type { OutboxMeasurement } from '../outbox';
import type { FirebasePerformance } from 'firebase/performance';

export type UsageEvent = 'usage_open' | 'fillup_started' | 'fillup_submitted' | 'fillup_queued' | 'fillup_save_failed'
  | 'signin_viewed' | 'signin_started' | 'signin_completed' | 'vehicle_wizard_open'
  | 'vehicle_created' | 'first_action_saved' | 'write_local' | 'write_synced' | 'write_synced_after_minute';
const key = 'tm.measurement.enabled.v1';
export const measurementAvailable = import.meta.env.PROD && import.meta.env.VITE_FIREBASE_PROJECT_ID === 'tank-malle'
  && import.meta.env.VITE_USE_EMULATORS !== '1' && (!nativeBuild || import.meta.env.VITE_NATIVE_METRICS === '1');

export function measurementEnabled() {
  try { return measurementAvailable && localStorage.getItem(key) === '1'; } catch { return false; }
}

let frame: HTMLIFrameElement | undefined;
let pending: UsageEvent[] = [];
let frameReady = false;
let revision = 0;
let nativeSettings = Promise.resolve();
let perf: FirebasePerformance | undefined;
let nativeSaveInFlight = false;

// Each offline event has its own key so concurrent tabs cannot overwrite one another.
const deferredPrefix = 'tm.measurement.offline.';
let sequence = 0;
export function measurementSession() {
  try { return measurementEnabled() ? localStorage.getItem(key + '.session') || 'initial' : null; }
  catch { return null; }
}

function flushOfflineEvents() {
  if (navigator.onLine === false || !measurementEnabled() || !frameReady) return;
  const flush = () => {
    if (!frame?.contentWindow || !measurementEnabled()) return;
    for (const id of Object.keys(localStorage).filter(k => k.startsWith(deferredPrefix)).sort()) {
      const value = localStorage.getItem(id);
      if (value && Date.now() - Number(id.slice(deferredPrefix.length).split('.')[0]) < 72 * 3600000) {
        frame.contentWindow.postMessage(value, location.origin);
      }
      localStorage.removeItem(id);
    }
  };
  if (navigator.locks) void navigator.locks.request('tm-usage-flush', flush).catch(() => {});
  else flush();
}

function webEvent(name: UsageEvent) {
  if (navigator.onLine === false) {
    // Bound storage during long outages. Analytics is best effort.
    if (Object.keys(localStorage).filter(k => k.startsWith(deferredPrefix)).length < 256)
      localStorage.setItem(deferredPrefix + Date.now() + '.' + String(++sequence).padStart(8, '0') + '.' + crypto.randomUUID(), name);
    return;
  }
  ensureWebFrame();
  if (frameReady) frame?.contentWindow?.postMessage(name, location.origin);
  else if (pending.length < 32) pending.push(name);
}

function ensureWebFrame() {
  if (!frame) {
    const element = document.createElement('iframe');
    frame = element;
    element.hidden = true;
    element.title = 'Google Analytics';
    element.referrerPolicy = 'no-referrer';
    element.src = '/usage-metrics.html';
    element.onload = () => {
      if (frame !== element || !measurementEnabled()) return;
      frameReady = true;
      flushOfflineEvents();
      for (const event of pending) element.contentWindow?.postMessage(event, location.origin);
      pending = [];
    };
    document.body.appendChild(element);
  }
}

export function trackUsage(name: UsageEvent, syncDuration?: number) {
  if (!measurementEnabled()) return;
  if (!nativeBuild) {
    try { webEvent(name); } catch { /* Collection must not interrupt the form. */ }
    return;
  }
  const generation = revision;
  void nativeSettings.then(async () => {
    const { FirebaseAnalytics } = await import('@capacitor-firebase/analytics');
    if (generation === revision && measurementEnabled()) await FirebaseAnalytics.logEvent({
      name, ...(name === 'write_synced' && syncDuration !== undefined ? { params: { sync_duration_ms: syncDuration } } : {}),
    });
  }).catch(() => {});
}

function applyPreference() {
  revision++;
  const enabled = measurementEnabled();
  if (nativeBuild && measurementAvailable) {
    nativeSettings = nativeSettings.then(async () => {
      const [{ FirebaseAnalytics }, { FirebasePerformance }] = await Promise.all([
        import('@capacitor-firebase/analytics'), import('@capacitor-firebase/performance'),
      ]);
      await Promise.allSettled([FirebaseAnalytics.setEnabled({ enabled }), FirebasePerformance.setEnabled({ enabled })]);
    }).catch(() => {});
  }
  if (perf) perf.dataCollectionEnabled = enabled;
  if (!enabled) { frame?.remove(); frame = undefined; frameReady = false; pending = []; }
  window.dispatchEvent(new Event('tm-measurement-change'));
}

export function setMeasurement(enabled: boolean) {
  try {
    if (enabled && !measurementEnabled()) localStorage.setItem(key + '.session', crypto.randomUUID());
    localStorage.setItem(key, enabled ? '1' : '0');
    if (!enabled) for (const id of Object.keys(localStorage).filter(k => k.startsWith(deferredPrefix))) localStorage.removeItem(id);
  } catch { return; }
  applyPreference();
  if (enabled) trackUsage('usage_open');
}

export function initializeMeasurement() {
  if (!measurementAvailable) return;
  window.addEventListener('online', () => {
    if (nativeBuild || !measurementEnabled()) return;
    if (frameReady) flushOfflineEvents();
    else if (Object.keys(localStorage).some(k => k.startsWith(deferredPrefix))) ensureWebFrame();
  });
  window.addEventListener('storage', e => { if (e.key === key || e.key === null) applyPreference(); });
  applyPreference();
  trackUsage('usage_open');
}

export function subscribeMeasurement(update: () => void) {
  window.addEventListener('tm-measurement-change', update);
  return () => window.removeEventListener('tm-measurement-change', update);
}

export const outboxMeasurement: OutboxMeasurement = {
  session: measurementSession,
  saved(firstVehicle, firstAction) {
    trackUsage('write_local');
    if (firstVehicle) trackUsage('vehicle_created');
    if (firstAction) trackUsage('first_action_saved');
  },
  synced(start) {
    const duration = Math.max(1, Date.now() - start);
    trackUsage('write_synced', duration);
    if (duration >= 60_000) trackUsage('write_synced_after_minute');
    const generation = revision;
    // Android's Performance plugin cannot record a historical trace across restarts.
    // Its GA event carries the measured duration instead.
    if (!nativeBuild) {
      void Promise.all([import('firebase/performance'), import('../firebase')]).then(([sdk, { app }]) => {
        if (generation !== revision || !measurementEnabled()) return;
        perf ??= sdk.initializePerformance(app, { instrumentationEnabled: false, dataCollectionEnabled: true });
        sdk.trace(perf, 'journal_to_server').record(start, duration);
      }).catch(() => {});
    }
  },
};

/** Measure the local save handoff; synchronization is a separate outbox operation. */
export function beginFillupSave() {
  if (!measurementEnabled()) return () => {};
  const start = Date.now(), generation = revision;
  trackUsage('fillup_submitted');
  // The native plugins index open traces by name. A second editor may start
  // saving before the bridge has finished closing the first editor’s trace.
  const measureNative = nativeBuild && !nativeSaveInFlight;
  if (measureNative) nativeSaveInFlight = true;
  const nativeTrace = measureNative ? nativeSettings.then(async () => {
    const { FirebasePerformance } = await import('@capacitor-firebase/performance');
    if (generation !== revision || !measurementEnabled()) return;
    await FirebasePerformance.startTrace({ traceName: 'fillup_save' });
    return { sdk: FirebasePerformance };
  }).catch(() => undefined) : undefined;
  let finished = false;
  return (queued: boolean) => {
    if (finished) return;
    finished = true;
    if (nativeTrace) void nativeTrace.then(async result => {
      if (!result) return;
      const { sdk } = result;
      try {
        if (generation === revision && measurementEnabled()) {
          await sdk.putAttribute({ traceName: 'fillup_save', attribute: 'outcome', value: queued ? 'queued' : 'failed' });
        }
      } finally {
        await sdk.stopTrace({ traceName: 'fillup_save' });
      }
    }).catch(() => {}).finally(() => { nativeSaveInFlight = false; });
    if (generation !== revision || !measurementEnabled()) return;
    trackUsage(queued ? 'fillup_queued' : 'fillup_save_failed');
    if (nativeBuild) return;
    const duration = Math.max(1, Date.now() - start);
    void Promise.all([import('firebase/performance'), import('../firebase')]).then(([sdk, { app }]) => {
      if (generation !== revision || !measurementEnabled()) return;
      perf ??= sdk.initializePerformance(app, { instrumentationEnabled: false, dataCollectionEnabled: true });
      sdk.trace(perf, 'fillup_save').record(start, duration, { attributes: { outcome: queued ? 'queued' : 'failed' } });
    }).catch(() => {});
  };
}
