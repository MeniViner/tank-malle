import { describe, expect, it } from "vitest";
import { missingProfileFields } from "./profileBootstrap";
import { DEFAULT_SETTINGS } from "./types";

const identity = { displayName: "נהגת", photoURL: null, email: "driver@example.com" };
const createdAt = { serverTimestamp: true };

describe("first-profile fields in the login transaction", () => {
  it("gives the first login writer a complete profile without adding telemetry or permission fields", () => {
    expect(missingProfileFields({}, identity, createdAt)).toEqual({
      ...identity, settings: DEFAULT_SETTINGS, createdAt,
    });
  });

  it("repairs a login-only document without including its timestamps or unknown siblings in the patch", () => {
    const existing = { previousLoginAt: null, currentLoginAt: 1234, lastProcessedAuthTime: 1234,
      updatedAt: { seconds: 12, nanoseconds: 345 }, future: { retained: [1, null] } };
    const before = structuredClone(existing);
    const patch = missingProfileFields(existing, identity, createdAt);
    expect(patch).toEqual({ ...identity, settings: DEFAULT_SETTINGS, createdAt });
    expect(existing).toEqual(before);
    expect({ ...existing, ...patch }).toMatchObject(before);
  });

  it("never fills or replaces an existing partial settings map, including deliberate opt-out and active vehicle", () => {
    const settings = { theme: "dark", accentColor: "mint", shareBenchmarks: false,
      activeVehicleId: "retained-car", futurePreference: { exact: 0.123456789 } };
    const existing = { settings, displayName: "שם שבחרתי", photoURL: null, email: null,
      createdAt: { seconds: 1, nanoseconds: 123456789 }, nickname: "שלי", future: true };
    expect(missingProfileFields(existing, identity, createdAt)).toEqual({});
    expect(existing.settings).toBe(settings);
    expect(Object.hasOwn(settings, "units")).toBe(false);
  });

  it.each([null, false, "legacy value", 0])("preserves an explicitly present legacy settings value: %s", settings => {
    const patch = missingProfileFields({ settings, displayName: null, photoURL: null,
      email: null, createdAt: null }, identity, createdAt);
    expect(patch).toEqual({});
  });
});
