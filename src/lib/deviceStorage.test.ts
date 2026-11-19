import { describe, expect, it } from "vitest";
import { clearSignedOutLocalStorage } from "./deviceStorage";

function memory(initial: Record<string, string>) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (key: string) => { map.delete(key); },
  };
}

describe("signing out clears local storage but keeps device preferences", () => {
  it("removes drafts, caches and scan labels; keeps theme, accent and onboarding", () => {
    const store = memory({
      "tm.theme": "dark", "tm.accent": "yellow", "tm.onboarded": "1",
      "tm.fillup-draft.v1.u1.v1.new": "{}", "tm.cache.v2.u1.vehicles": "[]", "tm.scan-labels.v1": "[]", "tm.stations.v2": "{}", "unrelated": "x",
    });
    clearSignedOutLocalStorage(store);
    expect([...store.map.keys()].sort()).toEqual(["tm.accent", "tm.onboarded", "tm.theme"]);
  });
  it("does not throw when storage is unavailable", () => {
    expect(() => clearSignedOutLocalStorage({ get length(): number { throw new Error("denied"); }, key: () => null, removeItem: () => {} })).not.toThrow();
  });
});
