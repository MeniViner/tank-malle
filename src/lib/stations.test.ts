import { describe, expect, it } from "vitest";
import { normaliseStationText, searchStationOptions, searchStations, stationKey, type CatalogStation } from "./stations";

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
