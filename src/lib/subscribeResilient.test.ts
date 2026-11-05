import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeResilient } from "./subscribeResilient";

type Snapshot = { value: string; metadata?: { fromCache: boolean; hasPendingWrites: boolean } };
type Listener = { next: (value: Snapshot) => void; error: (error: unknown) => void; stop: ReturnType<typeof vi.fn> };
const failure = (code: string) => ({ code });
const serverValue: Snapshot = { value: "current", metadata: { fromCache: false, hasPendingWrites: false } };

let browser: EventTarget;
let page: EventTarget & { visibilityState: string };
beforeEach(() => {
  vi.useFakeTimers();
  browser = new EventTarget();
  page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", page);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function harness(maxRetries = 2) {
  const listeners: Listener[] = [];
  let inScope = true;
  const next = vi.fn();
  const error = vi.fn();
  const attach = vi.fn((onNext: Listener["next"], onError: Listener["error"]) => {
    const stop = vi.fn();
    listeners.push({ next: onNext, error: onError, stop });
    return stop;
  });
  const stop = subscribeResilient(attach, next, {
    label: "test source", maxRetries, isCurrent: () => inScope, onError: error,
  });
  return { listeners, next, error, attach, stop, leaveScope: () => { inScope = false; } };
}

describe("bounded listener recovery", () => {
  it("does not reattach a healthy listener on online, focus or visibility changes", () => {
    const h = harness();
    h.listeners[0].next(serverValue);
    browser.dispatchEvent(new Event("online"));
    browser.dispatchEvent(new Event("focus"));
    page.dispatchEvent(new Event("visibilitychange"));
    vi.runAllTimers();
    expect(h.attach).toHaveBeenCalledTimes(1);
    expect(h.next).toHaveBeenCalledWith(serverValue);
    expect(h.listeners[0].stop).not.toHaveBeenCalled();
    h.stop();
    expect(h.listeners[0].stop).toHaveBeenCalledTimes(1);
  });

  it.each(["unavailable", "firestore/unavailable", "deadline-exceeded", "aborted", "internal"])(
    "reattaches a terminated %s listener with bounded backoff and reports exhaustion", code => {
      const h = harness();
      const error = failure(code);
      h.listeners[0].error(error);
      vi.advanceTimersByTime(249);
      expect(h.attach).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(h.attach).toHaveBeenCalledTimes(2);
      h.listeners[1].error(error);
      vi.advanceTimersByTime(499);
      expect(h.attach).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(1);
      h.listeners[2].error(error);
      vi.runAllTimers();
      expect(h.attach).toHaveBeenCalledTimes(3);
      expect(h.error).toHaveBeenCalledExactlyOnceWith(error);
      expect(h.listeners.every(listener => listener.stop.mock.calls.length === 1)).toBe(true);
      h.stop();
    },
  );

  it.each([
    { value: "cached", metadata: { fromCache: true, hasPendingWrites: false } },
    { value: "pending", metadata: { fromCache: false, hasPendingWrites: true } },
    { value: "unattested" },
  ] satisfies Snapshot[])("does not refill retries from a $value first emission", value => {
    const h = harness();
    for (let attempt = 0; attempt < 3; attempt++) {
      h.listeners[attempt].next(value);
      h.listeners[attempt].error(failure("unavailable"));
      vi.runAllTimers();
    }
    expect(h.attach).toHaveBeenCalledTimes(3);
    expect(h.next).toHaveBeenCalledTimes(3);
    expect(h.error).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    h.stop();
  });

  it("starts a new transient budget only after current server-backed progress", () => {
    const h = harness(1);
    h.listeners[0].error(failure("unavailable"));
    vi.runAllTimers();
    h.listeners[1].next(serverValue);
    h.listeners[1].error(failure("unavailable"));
    vi.runAllTimers();
    expect(h.attach).toHaveBeenCalledTimes(3);
    h.listeners[2].error(failure("unavailable"));
    vi.runAllTimers();
    expect(h.error).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it("keeps the finite permission handover budget even after successful snapshots", () => {
    const h = harness(1);
    h.listeners[0].error(failure("permission-denied"));
    vi.advanceTimersByTime(119);
    expect(h.attach).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    h.listeners[1].next(serverValue);
    h.listeners[1].error(failure("permission-denied"));
    browser.dispatchEvent(new Event("online"));
    browser.dispatchEvent(new Event("focus"));
    page.dispatchEvent(new Event("visibilitychange"));
    vi.runAllTimers();
    expect(h.attach).toHaveBeenCalledTimes(2);
    expect(h.error).toHaveBeenCalledExactlyOnceWith(failure("permission-denied"));
    h.stop();
  });

  it.each(["invalid-argument", "failed-precondition", "unauthenticated", "resource-exhausted", "data-loss", "unknown"])(
    "reports permanent or unclassified %s errors without retrying them on lifecycle events", code => {
      const h = harness();
      const error = failure(code);
      h.listeners[0].error(error);
      browser.dispatchEvent(new Event("online"));
      browser.dispatchEvent(new Event("focus"));
      page.dispatchEvent(new Event("visibilitychange"));
      vi.runAllTimers();
      expect(h.attach).toHaveBeenCalledTimes(1);
      expect(h.error).toHaveBeenCalledExactlyOnceWith(error);
      h.stop();
    },
  );

  it.each(["online", "focus", "visibilitychange"])("can resume after exhaustion on %s without refilling the budget", event => {
    const h = harness(0);
    const resume = () => (event === "visibilitychange" ? page : browser).dispatchEvent(new Event(event));
    h.listeners[0].error(failure("unavailable"));
    expect(h.error).toHaveBeenCalledTimes(1);
    resume();
    expect(h.attach).toHaveBeenCalledTimes(2);
    resume();
    expect(h.attach).toHaveBeenCalledTimes(2);
    h.listeners[1].next({ value: "old", metadata: { fromCache: true, hasPendingWrites: false } });
    h.listeners[1].error(failure("unavailable"));
    expect(h.error).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    resume(); // One browser transition can emit focus + online + visible.
    expect(h.attach).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1_000);
    resume();
    expect(h.attach).toHaveBeenCalledTimes(3);
    h.stop();
    vi.advanceTimersByTime(1_000);
    resume();
    expect(h.attach).toHaveBeenCalledTimes(3);
  });

  it("ignores hidden visibility changes and leaves an already scheduled retry alone", () => {
    const h = harness(1);
    h.listeners[0].error(failure("unavailable"));
    browser.dispatchEvent(new Event("focus"));
    expect(h.attach).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    h.listeners[1].error(failure("unavailable"));
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    expect(h.attach).toHaveBeenCalledTimes(2);
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    expect(h.attach).toHaveBeenCalledTimes(3);
    h.stop();
  });
});

describe("attachment and scope boundaries", () => {
  it("does not attach for an already stale scope", () => {
    const attach = vi.fn(() => vi.fn());
    const cancel = subscribeResilient(attach, vi.fn(), { label: "stale", isCurrent: () => false });
    browser.dispatchEvent(new Event("online"));
    page.dispatchEvent(new Event("visibilitychange"));
    expect(attach).not.toHaveBeenCalled();
    cancel();
  });

  it("ignores retired callbacks, including callbacks flushed synchronously by cleanup", () => {
    const h = harness(1);
    h.listeners[0].stop.mockImplementation(() => {
      h.listeners[0].next(serverValue);
      h.listeners[0].error(failure("permission-denied"));
    });
    h.listeners[0].error(failure("unavailable"));
    vi.runAllTimers();
    h.listeners[0].next(serverValue);
    h.listeners[0].error(failure("permission-denied"));
    expect(h.next).not.toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    h.listeners[1].error(failure("unavailable"));
    expect(h.error).toHaveBeenCalledTimes(1); // Retired server snapshot did not refill retries.
    h.stop();
    h.listeners[1].next(serverValue);
    expect(h.next).not.toHaveBeenCalled();
  });

  it("cleans a synchronously failed attachment even when its stop function arrives late", () => {
    const stops: ReturnType<typeof vi.fn>[] = [];
    const error = vi.fn();
    const attach = vi.fn((_next: (value: Snapshot) => void, fail: (error: unknown) => void) => {
      fail(failure("unavailable"));
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    });
    const cancel = subscribeResilient(attach, vi.fn(), { label: "sync", isCurrent: () => true, maxRetries: 1, onError: error });
    expect(stops[0]).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(stops[1]).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    cancel();
    expect(stops[1]).toHaveBeenCalledTimes(1);
  });

  it("also bounds registration errors thrown before a cleanup function is returned", () => {
    const error = vi.fn();
    const attach = vi.fn(() => { throw failure("deadline-exceeded"); });
    const cancel = subscribeResilient(attach, vi.fn(), { label: "throw", isCurrent: () => true, maxRetries: 1, onError: error });
    vi.runAllTimers();
    expect(attach).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    cancel();
  });

  it("cleans late registration when its first synchronous callback changes scope", () => {
    let inScope = true;
    let lateNext: ((value: Snapshot) => void) | undefined;
    const stop = vi.fn();
    const next = vi.fn(() => { inScope = false; });
    const attach = (onNext: (value: Snapshot) => void) => {
      lateNext = onNext;
      onNext(serverValue);
      return stop;
    };
    const cancel = subscribeResilient(attach, next, { label: "scope switch", isCurrent: () => inScope });
    expect(stop).toHaveBeenCalledTimes(1);
    lateNext?.(serverValue);
    expect(next).toHaveBeenCalledTimes(1);
    cancel();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("does not report an error or queue recovery if cleanup invalidates the scope", () => {
    const h = harness();
    h.listeners[0].stop.mockImplementation(() => h.leaveScope());
    h.listeners[0].error(failure("unavailable"));
    expect(h.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    h.stop();
  });

  it("checks account/vehicle scope before callbacks, delayed retries and lifecycle recovery", () => {
    const h = harness(1);
    h.listeners[0].error(failure("unavailable"));
    h.leaveScope();
    h.listeners[0].next(serverValue);
    h.listeners[0].error(failure("permission-denied"));
    vi.runAllTimers();
    browser.dispatchEvent(new Event("online"));
    expect(h.attach).toHaveBeenCalledTimes(1);
    expect(h.next).not.toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
    h.stop();

    const exhausted = harness(0);
    exhausted.listeners[0].error(failure("unavailable"));
    exhausted.leaveScope();
    browser.dispatchEvent(new Event("focus"));
    expect(exhausted.attach).toHaveBeenCalledTimes(1);
    exhausted.stop();
  });

  it("cancels a pending retry and rejects callbacks after cancellation", () => {
    const h = harness();
    h.listeners[0].error(failure("unavailable"));
    h.stop();
    h.stop();
    vi.runAllTimers();
    h.listeners[0].next(serverValue);
    h.listeners[0].error(failure("unavailable"));
    browser.dispatchEvent(new Event("online"));
    expect(h.attach).toHaveBeenCalledTimes(1);
    expect(h.listeners[0].stop).toHaveBeenCalledTimes(1);
    expect(h.next).not.toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
  });
});
