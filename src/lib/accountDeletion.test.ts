import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./firebase", () => ({ db: {} }));
import { clearAccountLocalData, clearAccountLocalStorage, runAccountDeletion } from "./accountDeletion";
import { LEGACY_SCAN_DB, LEGACY_SCAN_FLAG } from "./scan/legacyCorrections";
import { careDraftKey } from "./maintenance/draft";

afterEach(() => vi.unstubAllGlobals());
it("erases every care draft for the deleted account, preserving other accounts and preferences", () => {
  const uid = "account/one";
  const owned = [careDraftKey(uid, "v1", "serviceEvents"), careDraftKey(uid, "v2", "maintenancePlans", "edit-1"), careDraftKey(uid, "v1", "vehicleExpenses"), careDraftKey(uid, "v1", "odometerReadings")];
  const retained = [careDraftKey(`${uid}2`, "v1", "serviceEvents"), careDraftKey("other", uid, "serviceEvents"), "tm.theme"];
  const values = new Map([...owned, ...retained].map(key => [key, "draft"]));
  vi.stubGlobal("localStorage", { get length() { return values.size; }, key: (i:number) => [...values.keys()][i], removeItem: (key:string) => values.delete(key) });
  clearAccountLocalStorage(uid);
  expect([...values.keys()]).toEqual(retained);
});

describe("account deletion local-data step", () => {
  it("clears the account's local storage and what the retired scanner left on the device", async () => {
    const values = new Map([["tm.fillup-draft.v1.u1.v1", "draft"], ["tm.theme", "dark"], [LEGACY_SCAN_FLAG, "1"]]);
    vi.stubGlobal("localStorage", { get length() { return values.size; }, key: (i:number) => [...values.keys()][i], removeItem: (key:string) => values.delete(key) });
    const deleted: string[] = [];
    vi.stubGlobal("indexedDB", { deleteDatabase: (name: string) => { deleted.push(name); const request: { onsuccess?: () => void } = {}; queueMicrotask(() => request.onsuccess?.()); return request; } });
    await clearAccountLocalData("u1");
    expect(deleted).toEqual([LEGACY_SCAN_DB]);
    expect([...values.keys()]).toEqual(["tm.theme"]);
  });
  it("propagates a correction-log failure so the step is retried and the identity kept", async () => {
    vi.stubGlobal("localStorage", { length: 0, key: () => null, removeItem: () => {} });
    await expect(clearAccountLocalData("u1", async () => { throw new Error("idb blocked"); })).rejects.toThrow("idb blocked");
  });
});

function steps() {
  return { reauthenticate: vi.fn(async () => true), preflight: vi.fn(async () => {}),
    data: [{ label: "private-rules", run: vi.fn(async () => {}) }, { label: "feedback", run: vi.fn(async () => {}) }],
    profile: vi.fn(async () => {}), local: vi.fn(async () => {}), identity: vi.fn(async () => {}) };
}
describe("account deletion preserves the identity needed to retry", () => {
  it("does not destroy anything after reauthentication is cancelled or fails", async () => {
    const s = steps(); s.reauthenticate.mockRejectedValue(new Error("popup blocked"));
    expect((await runAccountDeletion(s)).needsReauth).toBe(true);
    expect(s.preflight).not.toHaveBeenCalled(); expect(s.identity).not.toHaveBeenCalled();
  });
  it("retains profile and auth when one collection cannot be erased", async () => {
    const s = steps(); s.data[1].run.mockRejectedValue(new Error("permission denied"));
    expect(await runAccountDeletion(s)).toEqual({ ok: false, deleted: ["private-rules"], failed: ["feedback"] });
    expect(s.profile).not.toHaveBeenCalled(); expect(s.identity).not.toHaveBeenCalled();
  });
  it("does not delete an identity when local erasure failed", async () => {
    const s = steps(); s.local.mockRejectedValue(new Error("another tab holds cache"));
    expect((await runAccountDeletion(s)).failed).toEqual(["local-cache"]);
    expect(s.identity).not.toHaveBeenCalled();
  });
  it("leaves pending device data intact", async () => {
    const s = steps(); s.preflight.mockRejectedValue(new Error("another account has pending writes"));
    await runAccountDeletion(s);
    expect(s.data[0].run).not.toHaveBeenCalled(); expect(s.local).not.toHaveBeenCalled();
  });
  it("only removes the identity after all data and local cleanup succeeded", async () => {
    const s = steps(); const order: string[] = [];
    s.data.forEach((step) => step.run.mockImplementation(async () => { order.push(step.label); }));
    for (const key of ["profile", "local", "identity"] as const) s[key].mockImplementation(async () => { order.push(key); });
    expect((await runAccountDeletion(s)).ok).toBe(true);
    expect(order).toEqual(["private-rules", "feedback", "profile", "local", "identity"]);
  });
});
