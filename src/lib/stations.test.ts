import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { distanceMeters, findNearby, normaliseStationText, searchStationOptions, searchStations, stationKey, stationOptionsByDistance, type CatalogStation } from "./stations";

const catalogEntry: CatalogStation = { i: "42", n: "סונול צומת תות", c: "סונול", a: "כביש 70", lat: 32.5, lng: 34.9 };
const catalog = { count: 1, companies: ["סונול"], stations: [{ ...catalogEntry, lat: 32.5, lng: 34.9 }] };

describe("station picker search", () => {
  it.each([null, catalog])("offers Sonol Shfeya without personal history, including an old catalog (%j)", (cached) => {
    const options = searchStationOptions(cached, [], "סונול שפיה");
    expect(options).toHaveLength(1);
    expect(options[0].source).toBe("catalog");
    expect(options[0].station).toEqual({ name: "סונול שפיה", stationId: null, brand: "סונול" });
    expect(options[0].address).toContain("מאיר שפיה");
    expect(options[0].station).not.toHaveProperty("lat");
    expect(options[0].station).not.toHaveProperty("lng");
  });

  it("keeps an existing Sonol Shfeya identity ahead of the unresolved global option", () => {
    const historical = { name: "סונול שפיה", stationId: "legacy-42", brand: "סונול", lat: 32.5, lng: 34.9 };
    const options = searchStationOptions(null, [historical], "שפיה סונול");
    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({ station: historical, source: "history" });
    expect(options[0].station).toBe(historical);
    expect(options[1].station.stationId).toBeNull();
  });

  it("finds the exact historical station without a catalog, preserving its payload", () => {
    const station = { name: "סונול תות", stationId: "legacy-42", brand: "סונול", lat: 32.5, lng: 34.9 };
    expect(searchStationOptions(null, [station], "סונול תות")).toEqual([{ station, source: "history" }]);
    expect(searchStationOptions(null, [station], "סונול תות")[0].station).toBe(station);
  });

  it("matches words across name/brand/address, independent of order and punctuation", () => {
    expect(searchStations(catalog, "תות   סונול")).toEqual(catalog.stations);
    expect(searchStations(catalog, "סונול כביש 70")).toEqual(catalog.stations);
    expect(normaliseStationText("\u200fסוֹנוֹל—תות\u200e")).toBe("סונול תות");
    expect(searchStationOptions(null, [{ name: "סוֹנוֹל—תות" }], "סונול תות")).toHaveLength(1);
  });

  it("searches registry-only stations without manufacturing coordinates", () => {
    const result = searchStationOptions({ ...catalog, stations: [], registryOnly: [{ ...catalogEntry, lat: null, lng: null }] }, [], "תות");
    expect(result[0].station).toEqual({ name: catalogEntry.n, stationId: "42", brand: "סונול" });
  });

  it("deduplicates stable IDs without conflating unresolved names or distinct places", () => {
    const historical = { name: "סונול תות", stationId: "42", brand: "סונול" };
    expect(searchStationOptions(catalog, [historical], "תות")).toEqual([{ station: historical, source: "history" }]);
    expect(searchStationOptions(catalog, [{ name: "סונול צומת—תות" }], "תות")).toHaveLength(2);
    // Equal display names do not collapse two known, distinct station IDs.
    expect(searchStationOptions(catalog, [{ name: catalogEntry.n, stationId: "43" }], "תות")).toHaveLength(2);
    expect(searchStationOptions(null, [
      { name: "סונול תות", lat: 32, lng: 34 },
      { name: "סונול תות", lat: 33, lng: 35 },
    ], "תות")).toHaveLength(2);
    expect(stationKey({ name: catalogEntry.n })).not.toBe(stationKey({ name: catalogEntry.n, stationId: "42" }));
  });

  it("matches historical aliases as well as current registry names", () => {
    const historical = { name: "סונול תות", stationId: "42" };
    expect(searchStationOptions(catalog, [historical], "צומת")[0].station.stationId).toBe("42");
    expect(searchStationOptions(catalog, [historical], "אין תחנה")).toEqual([]);
    expect(searchStationOptions(catalog, [historical], "ש")).toEqual([]);
    expect(searchStationOptions(catalog, [historical], "תות", 0)).toEqual([]);
  });
});

describe("explicit current-position ordering", () => {
  const here = { lat: 32, lng: 34.8 };
  const entry = (id: string, lat: number, lng = 34.8) => ({ i: id, n: `תחנת בדיקה ${id}`, c: null, a: "כביש הבדיקה", lat, lng });
  const source = (...stations: ReturnType<typeof entry>[]) => ({ count: stations.length, companies: [], stations });

  it("finds the nearest matching station beyond both the 400 m radius and the first 30 matches", () => {
    const rows = Array.from({ length: 40 }, (_, index) => entry(`far-${index}`, 31 + index * .02));
    const stations = source(...rows, entry("nearest-after-limit", 31.99));
    expect(searchStationOptions(stations, [], "בדיקה")).toHaveLength(30);
    expect(findNearby(stations, here)).toEqual([]);
    const ordered = stationOptionsByDistance(stations, [], "בדיקה", here);
    expect(ordered).toHaveLength(41);
    expect(ordered[0].station.stationId).toBe("nearest-after-limit");
    expect(ordered[0].distance).toBeGreaterThan(400);
    expect(ordered.map(row => row.distance)).toEqual([...ordered.map(row => row.distance)].sort((a, b) => a! - b!));
    expect(stations.stations[0].i).toBe("far-0");
  });

  it("does not limit explicit browsing to six stations or discard unknown locations", () => {
    const stations = { ...source(...Array.from({ length: 10 }, (_, index) => entry(String(index), 32 + index * .01))),
      registryOnly: [{ ...entry("unknown", 32), lat: null, lng: null }] };
    const ordered = stationOptionsByDistance(stations, [], "בדיקה", here);
    expect(ordered).toHaveLength(11);
    expect(ordered.at(-1)).toMatchObject({ station: { stationId: "unknown" }, distance: null });
  });

  it("browses all options for a short query only in explicit mode", () => {
    const stations = source(entry("one", 32.01));
    for (const query of ["", "ב"]) {
      expect(searchStationOptions(stations, [], query)).toEqual([]);
      const ordered = stationOptionsByDistance(stations, [], query, here);
      expect(ordered[0].station.stationId).toBe("one");
      expect(ordered.some(row => row.station.name === "סונול שפיה" && row.distance === null)).toBe(true);
    }
  });

  it("keeps the query, Hebrew normalization, brand/address matching and history selection intact", () => {
    const historical = Object.freeze({ name: "בדיקה — היסטורית", brand: "סוֹנוֹל", lat: 32.03, lng: 34.8 });
    const stations = source(entry("catalog", 32.01));
    expect(stationOptionsByDistance(stations, [historical], "היסטורית סונול", here)[0].station).toBe(historical);
    expect(stationOptionsByDistance(stations, [historical], "כביש בדיקה", here).map(row => row.station.stationId)).toEqual(["catalog"]);
    expect(stationOptionsByDistance(stations, [historical], "אין התאמה", here)).toEqual([]);
    expect(historical).toEqual({ name: "בדיקה — היסטורית", brand: "סוֹנוֹל", lat: 32.03, lng: 34.8 });
  });

  it("deduplicates by stable identity and uses registry coordinates without rewriting history", () => {
    const historical = Object.freeze({ name: "תחנת בדיקה ישנה", stationId: "same" });
    const stations = source(entry("same", 32.005), entry("far", 32.01));
    const result = stationOptionsByDistance(stations, [historical], "בדיקה", here);
    expect(result).toHaveLength(2);
    expect(result[0].station).toBe(historical);
    expect(result[0].distance).toBeCloseTo(distanceMeters(here, { lat: 32.005, lng: 34.8 }));
    expect(result[0].station).not.toHaveProperty("lat");
    expect(result[0].station).not.toHaveProperty("lng");
  });

  it("does not attach coordinates by name or merge unresolved and identified stations", () => {
    const known = entry("known", 32.01);
    const historical = { name: known.n };
    const result = stationOptionsByDistance(source(known), [historical], "בדיקה", here);
    expect(result).toHaveLength(2);
    expect(result[0].station.stationId).toBe("known");
    expect(result[1]).toMatchObject({ station: historical, source: "history", distance: null });
    expect(result[1].station).toBe(historical);
  });

  it("retains source order for equal distances, including unknown distances", () => {
    const history = [{ name: "בדיקה ראשון", ...here }, { name: "בדיקה שני", ...here }, { name: "בדיקה לא ידוע ראשון" }];
    const stations = { ...source(entry("third", 32)), registryOnly: [{ ...entry("unknown", 32), lat: null, lng: null }] };
    const ordered = stationOptionsByDistance(stations, history, "בדיקה", here);
    expect(ordered.map(row => row.station.name)).toEqual([
      "בדיקה ראשון", "בדיקה שני", "תחנת בדיקה third", "בדיקה לא ידוע ראשון", "תחנת בדיקה unknown",
    ]);
    expect(ordered.slice(0, 3).every(row => row.distance === 0)).toBe(true);
  });

  it("treats invalid or missing coordinates as unknown, never as zero", () => {
    const history = [
      { name: "בדיקה nan", lat: NaN, lng: 34.8 }, { name: "בדיקה infinity", lat: 32, lng: Infinity },
      { name: "בדיקה latitude", lat: 91, lng: 34.8 }, { name: "בדיקה longitude", lat: 32, lng: 181 },
      { name: "בדיקה missing", lat: 32 },
    ];
    const result = stationOptionsByDistance(source(entry("valid", 32.01)), history, "בדיקה", here);
    expect(result[0].station.stationId).toBe("valid");
    expect(result.slice(1).every(row => row.distance === null)).toBe(true);
    expect(stationOptionsByDistance(source(entry("valid", 32.01)), [], "בדיקה", { lat: NaN, lng: 34.8 })[0].distance).toBeNull();
  });

  it("sorts available historical stations even when the catalog is unavailable", () => {
    const far = { name: "בדיקה רחוקה", lat: 33, lng: 34.8 };
    const near = { name: "בדיקה קרובה", lat: 32.01, lng: 34.8 };
    expect(stationOptionsByDistance(null, [far, near], "בדיקה", here).map(row => row.station)).toEqual([near, far]);
  });

  it("refreshes ordering from a new position without mutating the catalog", () => {
    const stations = source(entry("south", 31.9), entry("north", 32.1));
    const south = stationOptionsByDistance(stations, [], "בדיקה", { lat: 31.8, lng: 34.8 });
    const north = stationOptionsByDistance(stations, [], "בדיקה", { lat: 32.2, lng: 34.8 });
    expect(south[0].station.stationId).toBe("south");
    expect(north[0].station.stationId).toBe("north");
    expect(stations.stations.map(row => row.i)).toEqual(["south", "north"]);
  });

  it("preserves the 400 m automatic-selection candidate rule", () => {
    const stations = source(entry("near", 32.001), entry("outside", 32.005));
    expect(findNearby(stations, here).map(row => row.i)).toEqual(["near"]);
    expect(stationOptionsByDistance(stations, [], "בדיקה", here).map(row => row.station.stationId)).toEqual(["near", "outside"]);
  });
});

describe("station location requests", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => catalog }));
  });
  afterEach(() => vi.unstubAllGlobals());

  function location(latitude = 32, longitude = 34.8): GeolocationPosition {
    return { coords: { latitude, longitude, accuracy: 1, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition;
  }

  it("requests a fresh fix explicitly while preserving automatic cache and radius defaults", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback, _error?: PositionErrorCallback, _options?: PositionOptions) => success(location()));
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    const { locateStations } = await import("./stations");
    expect(await locateStations()).toEqual({ status: "none", position: { lat: 32, lng: 34.8 }, nearby: [] });
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
    expect(await locateStations(400, { maximumAge: 0 })).toMatchObject({ status: "none", position: { lat: 32, lng: 34.8 } });
    expect(getCurrentPosition.mock.calls[1][2]).toEqual({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
  });

  it.each([1, 2, 3])("returns a normal unavailable result for geolocation failure %s", async code => {
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (_success: PositionCallback, fail: PositionErrorCallback) =>
      fail({ code, message: "test", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) } });
    const { locateStations } = await import("./stations");
    expect(await locateStations(400, { maximumAge: 0 })).toEqual({ status: code === 1 ? "denied" : "unavailable", position: null, nearby: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("handles a missing or synchronously throwing browser API without rejecting", async () => {
    vi.stubGlobal("navigator", {});
    const { locateStations } = await import("./stations");
    expect((await locateStations()).status).toBe("unavailable");
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: () => { throw new Error("not available"); } } });
    expect((await locateStations()).status).toBe("unavailable");
  });

  it("rejects invalid position coordinates instead of ordering with a fake location", async () => {
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (success: PositionCallback) => success(location(NaN)) } });
    const { locateStations } = await import("./stations");
    expect(await locateStations()).toEqual({ status: "unavailable", position: null, nearby: [] });
  });
});
