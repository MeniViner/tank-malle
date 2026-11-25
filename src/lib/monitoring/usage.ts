import { nativeBuild } from '../native/platform';
import type { FirebasePerformance } from 'firebase/performance';

export type UsageEvent = 'usage_open' | 'fillup_started' | 'fillup_submitted' | 'fillup_queued' | 'fillup_save_failed';
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

function webEvent(name: UsageEvent) {
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
      for (const event of pending) element.contentWindow?.postMessage(event, location.origin);
      pending = [];
    };
    document.body.appendChild(element);
  }
  if (frameReady) frame.contentWindow?.postMessage(name, location.origin);
  else if (pending.length < 32) pending.push(name);
}

export function trackUsage(name: UsageEvent) {
  if (!measurementEnabled()) return;
  if (!nativeBuild) {
    try { webEvent(name); } catch { /* Collection must not interrupt the form. */ }
    return;
  }
  const generation = revision;
  void nativeSettings.then(async () => {
    const { FirebaseAnalytics } = await import('@capacitor-firebase/analytics');
    if (generation === revision && measurementEnabled()) await FirebaseAnalytics.logEvent({ name });
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
  try { localStorage.setItem(key, enabled ? '1' : '0'); } catch { return; }
  applyPreference();
  if (enabled) trackUsage('usage_open');
}

export function initializeMeasurement() {
  if (!measurementAvailable) return;
  window.addEventListener('storage', e => { if (e.key === key || e.key === null) applyPreference(); });
  applyPreference();
  trackUsage('usage_open');
}

export function subscribeMeasurement(update: () => void) {
  window.addEventListener('tm-measurement-change', update);
  return () => window.removeEventListener('tm-measurement-change', update);
}

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
    return FirebasePerformance;
  }).catch(() => undefined) : undefined;
  let finished = false;
  return (queued: boolean) => {
    if (finished) return;
    finished = true;
    if (nativeTrace) void nativeTrace.then(async sdk => {
      if (!sdk) return;
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
