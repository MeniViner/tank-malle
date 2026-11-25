import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('device usage preference', () => {
  const store = new Map<string, string>();
  const post = vi.fn(), remove = vi.fn(), append = vi.fn();
  const frame = { onload: () => {}, contentWindow: { postMessage: post }, remove };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    store.clear();
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'tank-malle');
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k), setItem: (k: string, v: string) => store.set(k, v) });
    vi.stubGlobal('document', { createElement: () => frame, body: { appendChild: append } });
    vi.stubGlobal('location', { origin: 'https://example.test' });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('only sends named events after opt-in and drops unfinished measurements on withdrawal', async () => {
    const usage = await import('./usage');
    usage.initializeMeasurement();
    usage.trackUsage('fillup_started');
    expect(append).not.toHaveBeenCalled();
    usage.setMeasurement(true);
    frame.onload();
    usage.trackUsage('fillup_started');
    const finish = usage.beginFillupSave();
    usage.setMeasurement(false);
    finish(true);
    expect(post.mock.calls.map(call => call[0])).toEqual(['usage_open', 'fillup_started', 'fillup_submitted']);
    expect(remove).toHaveBeenCalled();
  });

  it('does not collect from emulator builds even with an existing preference', async () => {
    vi.stubEnv('VITE_USE_EMULATORS', '1');
    store.set('tm.measurement.enabled.v1', '1');
    const usage = await import('./usage');
    usage.initializeMeasurement();
    usage.trackUsage('fillup_started');
    expect(append).not.toHaveBeenCalled();
  });
});
