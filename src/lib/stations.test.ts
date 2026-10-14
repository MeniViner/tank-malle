import { describe, expect, it } from "vitest";
import { normaliseStationText, searchStationOptions, searchStations, stationKey, type CatalogStation } from "./stations";

const catalogEntry: CatalogStation = { i: "42", n: "סונול צומת שפיה", c: "סונול", a: "כביש 70", lat: 32.5, lng: 34.9 };
const catalog = { count: 1, companies: ["סונול"], stations: [{ ...catalogEntry, lat: 32.5, lng: 34.9 }] };

describe("station picker search", () => {
  it("finds the exact historical station without a catalog, preserving its payload", () => {
    const station = { name: "סונול שפיה", stationId: "legacy-42", brand: "סונול", lat: 32.5, lng: 34.9 };
    expect(searchStationOptions(null, [station], "סונול שפיה")).toEqual([{ station, source: "history" }]);
    expect(searchStationOptions(null, [station], "סונול שפיה")[0].station).toBe(station);
  });

  it("matches words across name/brand/address, independent of order and punctuation", () => {
    expect(searchStations(catalog, "שפיה   סונול")).toEqual(catalog.stations);
    expect(searchStations(catalog, "סונול כביש 70")).toEqual(catalog.stations);
    expect(normaliseStationText("\u200fסוֹנוֹל—שפיה\u200e")).toBe("סונול שפיה");
    expect(searchStationOptions(null, [{ name: "סוֹנוֹל—שפיה" }], "סונול שפיה")).toHaveLength(1);
  });

  it("searches registry-only stations without manufacturing coordinates", () => {
    const result = searchStationOptions({ ...catalog, stations: [], registryOnly: [{ ...catalogEntry, lat: null, lng: null }] }, [], "שפיה");
    expect(result[0].station).toEqual({ name: catalogEntry.n, stationId: "42", brand: "סונול" });
  });

  it("deduplicates stable IDs without conflating unresolved names or distinct places", () => {
    const historical = { name: "סונול שפיה", stationId: "42", brand: "סונול" };
    expect(searchStationOptions(catalog, [historical], "שפיה")).toEqual([{ station: historical, source: "history" }]);
    expect(searchStationOptions(catalog, [{ name: "סונול צומת—שפיה" }], "שפיה")).toHaveLength(2);
    // Equal display names do not collapse two known, distinct station IDs.
    expect(searchStationOptions(catalog, [{ name: catalogEntry.n, stationId: "43" }], "שפיה")).toHaveLength(2);
    expect(searchStationOptions(null, [
      { name: "סונול שפיה", lat: 32, lng: 34 },
      { name: "סונול שפיה", lat: 33, lng: 35 },
    ], "שפיה")).toHaveLength(2);
    expect(stationKey({ name: catalogEntry.n })).not.toBe(stationKey({ name: catalogEntry.n, stationId: "42" }));
  });

  it("matches historical aliases as well as current registry names", () => {
    const historical = { name: "סונול שפיה", stationId: "42" };
    expect(searchStationOptions(catalog, [historical], "צומת")[0].station.stationId).toBe("42");
    expect(searchStationOptions(catalog, [historical], "אין תחנה")).toEqual([]);
    expect(searchStationOptions(catalog, [historical], "ש")).toEqual([]);
    expect(searchStationOptions(catalog, [historical], "שפיה", 0)).toEqual([]);
  });
});
