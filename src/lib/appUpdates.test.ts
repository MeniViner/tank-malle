import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_UPDATE_AVAILABLE, BEFORE_APP_UPDATE, canReloadForUpdate, checkAppUpdate, waitForWorkerActivation, watchAppUpdates, type BuildIdentity } from './appUpdates';

const current: BuildIdentity = { version: '1.6.1', commit: 'a'.repeat(40), dirty: false };
const next: BuildIdentity = { ...current, commit: 'b'.repeat(40) };

describe('safe update discovery', () => {
  let win: EventTarget; let doc: EventTarget & { visibilityState: string }; let nav: { onLine: boolean; serviceWorker?: unknown };
  beforeEach(() => {
    vi.useFakeTimers();
    win = Object.assign(new EventTarget(), { setInterval, clearInterval });
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }); nav = { onLine: true };
    vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('navigator', nav);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => current }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const registration = (update = vi.fn().mockResolvedValue(undefined)) => ({ update, installing: null, waiting: null }) as unknown as ServiceWorkerRegistration;
  it('checks resume/reconnect without activating a worker, throttles event bursts and removes listeners', async () => {
    const update = vi.fn().mockResolvedValue(undefined); const stop = watchAppUpdates(registration(update));
    await Promise.resolve(); await Promise.resolve(); expect(update).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event('focus')); win.dispatchEvent(new Event('online')); expect(update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000); win.dispatchEvent(new Event('focus'));
    await Promise.resolve(); await Promise.resolve(); expect(update).toHaveBeenCalledTimes(2);
    stop(); await vi.advanceTimersByTimeAsync(60 * 60_000); win.dispatchEvent(new Event('focus'));
    expect(update).toHaveBeenCalledTimes(2);
  });
  it('does not check offline or in the background, and retries after a failed check on reconnect', async () => {
    nav.onLine = false; const update = vi.fn().mockRejectedValue(new Error('offline'));
    const stop = watchAppUpdates(registration(update)); expect(update).not.toHaveBeenCalled();
    nav.onLine = true; doc.visibilityState = 'hidden'; win.dispatchEvent(new Event('online')); expect(update).not.toHaveBeenCalled();
    doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve(); await Promise.resolve(); expect(update).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000); win.dispatchEvent(new Event('online'));
    await Promise.resolve(); await Promise.resolve(); expect(update).toHaveBeenCalledTimes(2); stop();
  });
  it('lets an editor refuse activation without changing any storage', () => {
    expect(canReloadForUpdate()).toBe(true);
    const block = (event: Event) => event.preventDefault(); win.addEventListener(BEFORE_APP_UPDATE, block);
    expect(canReloadForUpdate()).toBe(false); win.removeEventListener(BEFORE_APP_UPDATE, block); expect(canReloadForUpdate()).toBe(true);
  });
  it('only reports current after comparing the server identity, even without a service worker', async () => {
    expect(await checkAppUpdate(current)).toEqual({ status: 'current', release: current });
    expect(fetch).toHaveBeenCalledWith('/build-info.json', expect.objectContaining({ cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } }));
    nav.onLine = false;
    expect(await checkAppUpdate(current)).toEqual({ status: 'offline' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('manual checks distinguish waiting, current and failed worker responses', async () => {
    const reg = registration(); nav.serviceWorker = { getRegistration: async () => reg };
    expect((await checkAppUpdate(current)).status).toBe('current'); Object.assign(reg, { waiting: {} }); expect((await checkAppUpdate(current)).status).toBe('available');
    Object.assign(reg, { update: () => Promise.reject(new Error('network')) }); expect((await checkAppUpdate(current)).status).toBe('error');
  });
  it('finds a different commit under the same app version when no worker is waiting', async () => {
    const reg = registration(); nav.serviceWorker = { getRegistration: async () => reg };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => next } as Response);
    const available = vi.fn(); win.addEventListener(APP_UPDATE_AVAILABLE, available);
    expect(await checkAppUpdate(current)).toEqual({ status: 'available', release: next });
    expect(reg.update).toHaveBeenCalledOnce();
    expect(available.mock.calls[0][0].detail).toEqual({ reload: true });
  });
  it('stages a newly installed worker and requests guarded activation instead of a direct reload', async () => {
    const worker = Object.assign(new EventTarget(), { state: 'installing' });
    const reg = registration(); Object.assign(reg, { installing: worker });
    nav.serviceWorker = { getRegistration: async () => reg };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => next } as Response);
    const available = vi.fn(); win.addEventListener(APP_UPDATE_AVAILABLE, available);
    const check = checkAppUpdate(current);
    await vi.advanceTimersByTimeAsync(1);
    Object.assign(reg, { waiting: worker, installing: null }); worker.state = 'installed'; worker.dispatchEvent(new Event('statechange'));
    expect(await check).toEqual({ status: 'available', release: next });
    expect(available.mock.calls[0][0].detail).toEqual({ reload: false });
  });
  it.each([
    { ok: false, json: async () => current },
    { ok: true, json: async () => ({ version: '1.6.1', commit: 'random', dirty: false }) },
    { ok: true, json: async () => { throw new Error('HTML instead of metadata'); } },
  ])('does not report current when the release response is invalid', async response => {
    vi.mocked(fetch).mockResolvedValue(response as Response);
    expect((await checkAppUpdate(current)).status).toBe('error');
  });
  it('bounds a hung fetch and an installation that never finishes', async () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    const hungFetch = checkAppUpdate(current); await vi.advanceTimersByTimeAsync(12_000);
    expect((await hungFetch).status).toBe('error');
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => next } as Response);
    const worker = Object.assign(new EventTarget(), { state: 'installing' });
    const reg = registration(); Object.assign(reg, { installing: worker });
    nav.serviceWorker = { getRegistration: async () => reg };
    const hungInstall = checkAppUpdate(current); await vi.advanceTimersByTimeAsync(12_000);
    expect((await hungInstall).status).toBe('error');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for activation rather than installation when refreshing an uncontrolled tab', async () => {
    const worker = Object.assign(new EventTarget(), { state: 'installed' });
    const complete = vi.fn();
    const activation = waitForWorkerActivation(worker as unknown as ServiceWorker).then(complete);
    await vi.advanceTimersByTimeAsync(1); expect(complete).not.toHaveBeenCalled();
    worker.state = 'activated'; worker.dispatchEvent(new Event('statechange'));
    await activation; expect(complete).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
