import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BEFORE_APP_UPDATE, canReloadForUpdate, checkAppUpdate, watchAppUpdates } from './appUpdates';

describe('safe update discovery', () => {
  let win: EventTarget; let doc: EventTarget & { visibilityState: string }; let nav: { onLine: boolean; serviceWorker?: unknown };
  beforeEach(() => {
    vi.useFakeTimers();
    win = Object.assign(new EventTarget(), { setInterval, clearInterval });
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }); nav = { onLine: true };
    vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('navigator', nav);
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
  it('manual checks distinguish unavailable, offline, waiting, current and failed responses', async () => {
    expect(await checkAppUpdate()).toBe('unavailable'); nav.onLine = false; expect(await checkAppUpdate()).toBe('offline'); nav.onLine = true;
    const reg = registration(); nav.serviceWorker = { getRegistration: async () => reg };
    expect(await checkAppUpdate()).toBe('current'); Object.assign(reg, { waiting: {} }); expect(await checkAppUpdate()).toBe('available');
    Object.assign(reg, { update: () => Promise.reject(new Error('network')) }); expect(await checkAppUpdate()).toBe('error');
  });
});
