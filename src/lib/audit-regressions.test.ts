import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRange } from "./periods";
import { summaryChanged, type VehicleSummary } from "./summary";
import { fillupDraftKey, readFillupDraft, writeFillupDraft, type FillupDraft } from "./fillupDraft";
import { parseNumber } from "./numeric";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("date-window and summary regressions", () => {
  it.each([[2026, 4, 31, 1, 28], [2024, 4, 31, 1, 29], [2026, 6, 31, 3, 30]])("clamps the trailing three-month boundary (%s/%s/%s)", (year, month, day, targetMonth, targetDay) => {
    const from = new Date(buildRange("3m", new Date(year, month, day, 12).getTime()).from!);
    expect([from.getMonth(), from.getDate(), from.getHours()]).toEqual([targetMonth, targetDay, 12]);
  });
  it("updates operational totals when only liters or last date changes", () => {
    const old: VehicleSummary = { fuelType: "95", fillups: 2, trackedKm: 100, liters: 20, cost: 140, kmPerLiter: null, segments: 0, lastFillupAt: 1, updatedAt: 1 };
    expect(summaryChanged(old, { ...old, liters: 25 })).toBe(true);
    expect(summaryChanged(old, { ...old, lastFillupAt: 2 })).toBe(true);
    expect(summaryChanged(old, { ...old, updatedAt: 3 })).toBe(false);
  });
  it("reads grouped odometers without changing their magnitude", () => {
    expect(parseNumber("123,456", "odometer")).toBe(123456);
    expect(parseNumber("123 456", "odometer")).toBe(123456);
    expect(Number.isNaN(parseNumber("123abc", "odometer"))).toBe(true);
  });
});
describe("draft lifetime and account isolation", () => {
  it("keeps each account, vehicle and edit separate and expires stale drafts", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
    const key = fillupDraftKey("alice", "v1", "new");
    const draft = { date: Date.now(), odometer: "123456", notes: "draft", receipt: { authored: [] }, tankDraft: {}, pumpAnswer: "unanswered" } as unknown as FillupDraft;
    expect(writeFillupDraft(key, draft)).toBe(true);
    expect(readFillupDraft(key)).toEqual(draft);
    expect(readFillupDraft(fillupDraftKey("bob", "v1", "new"))).toBeNull();
    expect(readFillupDraft(fillupDraftKey("alice", "v2", "new"))).toBeNull();
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 31 * 86400000);
    expect(readFillupDraft(key)).toBeNull();
  });
});
describe("station catalog freshness", () => {
  it("refreshes an old catalog and keeps the new one available offline", async () => {
    vi.resetModules();
    const old = { stations: [{ n: "ישן", lat: 32, lng: 34 }], count: 1, companies: [] };
    const fresh = { stations: [{ n: "חדש", lat: 32, lng: 34 }], count: 1, companies: [] };
    const store = new Map([["tm.stations.v1", JSON.stringify(old)]]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => fresh }); vi.stubGlobal("fetch", fetch);
    const { loadStationCatalog } = await import("./stations");
    expect(await loadStationCatalog()).toEqual(fresh);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockRejectedValue(new Error("offline"));
    expect(await loadStationCatalog()).toEqual(fresh);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 2 * 86400000);
    expect(await loadStationCatalog()).toEqual(fresh);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
