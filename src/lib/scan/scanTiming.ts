import { cloudPilot } from './cloudPilot';
import type { DisplayKind } from './engine';
import type { ScanSource } from './samples';

export function recordScanTiming(start: number, source: ScanSource, kind: DisplayKind, read: boolean, fallback: boolean) {
  if (!cloudPilot || import.meta.env.VITE_USE_EMULATORS === '1') return;
  const duration = Date.now() - start;
  if (duration <= 0) return;
  // Loading and submitting telemetry never delays filling in the form.
  void Promise.all([import('firebase/performance'), import('../firebase')]).then(([sdk, {app}]) => {
    const perf = sdk.initializePerformance(app, { instrumentationEnabled: false, dataCollectionEnabled: true });
    sdk.trace(perf, 'display_scan').record(start, duration, {
      attributes: { source, kind, fallback: String(fallback), outcome: read ? 'read' : 'unreadable' },
    });
  }).catch(() => {});
}
