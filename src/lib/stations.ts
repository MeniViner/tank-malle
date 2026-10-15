import type { Station } from "./types";

/**
 * Nearest-station detection.
 *
 * The whole public register (≈1,250 stations) ships as a static JSON, so
 * naming the station you are standing at is a local computation — no network
 * call, no API key, and it still works with no signal at the pump.
 */

export interface CatalogStation {
  /**
   * The government's station number — the STABLE IDENTITY.
   *
   * Display names change and brands get re-signed; this does not. Absent on
   * catalogs generated before this field was added, in which case a fill-up is
   * stored without a station id and is treated as legacy/unresolved rather
   * than force-matched later.
   */
  i?: string | null;
  /** Display label, e.g. "פז צומת גולני". */
  n: string;
  /** Brand. */
  c: string | null;
  /** Street address or local authority. */
  a: string | null;
  /**
   * Coordinates, when the register has usable ones.
   *
   * Null for a station the register holds but cannot place. Such a station is
   * still real and still searchable by name — it simply cannot be detected
   * automatically from the driver's position.
   */
  lat: number | null;
  lng: number | null;
}

/** A station we can actually place on a map. */
export interface GeoStation extends CatalogStation {
  lat: number;
  lng: number;
}

interface Catalog {
  /** Geo-enabled count. */
  count: number;
  /** Authoritative count — every station the register holds. */
  registryCount?: number;
  companies: string[];
  /** Sorted by latitude; nearby detection uses this and only this. */
  stations: GeoStation[];
  /**
   * Stations with no usable coordinate. Searchable by name, never returned by
   * proximity. Absent on a catalog generated before this split existed.
   */
  registryOnly?: CatalogStation[];
}

export interface NearbyStation extends GeoStation {
  /** Metres from the supplied position. */
  distance: number;
}

const CATALOG_URL = "/fuel-stations.json";
const CACHE_KEY = "tm.stations.v2";
const CATALOG_TTL = 24 * 60 * 60 * 1000;
let fetchedAt = 0;

let inMemory: Catalog | null = null;
let inFlight: Promise<Catalog | null> | null = null;

/**
 * Verified places missing from the Ministry's 1 December 2025 snapshot.
 * Bundled separately so an older cached catalog or an unavailable registry
 * cannot hide them. These are search-only additions, not government records:
 * never invent a registry ID or location, or change an existing fill-up.
 * Sources checked 2026-10-15: https://easy.co.il/page/27559559 and
 * https://evdrive.co.il/%D7%A2%D7%9E%D7%93%D7%95%D7%AA-%D7%98%D7%A2%D7%99%D7%A0%D7%94/
 */
const VERIFIED_SEARCH_STATIONS: readonly CatalogStation[] = [
  { i: null, n: "סונול שפיה", c: "סונול", a: "מאיר שפיה · כביש 67", lat: null, lng: null },
];

/**
 * Load the catalog, preferring localStorage so a repeat visit (or an offline
 * one) resolves instantly instead of waiting on the network.
 */
export async function loadStationCatalog(): Promise<Catalog | null> {
  if (inMemory && Date.now() - fetchedAt < CATALOG_TTL) return inMemory;
  if (inFlight) return inFlight;
  if (!inMemory) try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as { at: number; catalog: Catalog } | null;
    if (cached?.catalog?.stations?.length) { inMemory = cached.catalog; fetchedAt = cached.at; }
    else {
      const legacy = JSON.parse(localStorage.getItem("tm.stations.v1") ?? "null") as Catalog | null;
      if (legacy?.stations?.length) inMemory = legacy;
    }
  } catch { /* Retry online; corrupt storage is not a permanent verdict. */ }
  if (inMemory && Date.now() - fetchedAt < CATALOG_TTL) return inMemory;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  inFlight = fetch(CATALOG_URL, { cache: "no-cache", signal: controller.signal })
    .then((response) => { if (!response.ok) throw new Error("catalog unavailable"); return response.json(); })
    .then((catalog: Catalog) => {
      if (!Array.isArray(catalog?.stations) || !catalog.stations.length) throw new Error("invalid catalog");
      inMemory = catalog; fetchedAt = Date.now();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: fetchedAt, catalog })); localStorage.removeItem("tm.stations.v1"); } catch { /* In-memory cache still works. */ }
      return catalog;
    })
    .catch(() => inMemory)
    .finally(() => { clearTimeout(timer); inFlight = null; });
  return inFlight;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Stations near a position, closest first.
 *
 * The catalog is sorted by latitude, so a latitude band prunes almost
 * everything before any trigonometry runs — this stays instant on a phone.
 */
export function findNearby(
  catalog: Catalog | null,
  position: { lat: number; lng: number },
  radiusMeters = 400,
  limit = 6,
): NearbyStation[] {
  if (!catalog?.stations?.length) return [];

  const latPadding = radiusMeters / 111_000 + 0.001;
  const minLat = position.lat - latPadding;
  const maxLat = position.lat + latPadding;

  const results: NearbyStation[] = [];
  for (const station of catalog.stations) {
    if (station.lat < minLat) continue;
    if (station.lat > maxLat) break; // sorted by latitude
    const distance = distanceMeters(position, station);
    if (distance <= radiusMeters) results.push({ ...station, distance });
  }

  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, limit);
}

/**
 * Search the registry and verified additions by name or address.
 *
 * Both the geo-enabled subset and the stations with no usable coordinate are
 * searched. A broken coordinate in a government dataset is not a reason to
 * pretend a petrol station does not exist — the driver may well be standing at
 * it. It simply will not turn up in nearby detection. Search-only additions
 * remain available even when the registry has not loaded.
 */
export function searchStations(
  catalog: Catalog | null,
  query: string,
  limit = 30,
): CatalogStation[] {
  const term = normaliseStationText(query);
  if (term.length < 2 || limit <= 0) return [];

  const results: CatalogStation[] = [];
  const consider = (station: CatalogStation): boolean => {
    if (matchesStationText([station.n, station.c, station.a], term)) {
      results.push(station);
    }
    return results.length < limit;
  };

  for (const station of catalog?.stations ?? []) {
    if (!consider(station)) return results;
  }
  for (const station of catalog?.registryOnly ?? []) {
    if (!consider(station)) return results;
  }
  for (const station of VERIFIED_SEARCH_STATIONS) {
    if (!consider(station)) return results;
  }
  return results;
}

/** Match Hebrew names despite bidi marks, niqqud, punctuation or word order. */
export function normaliseStationText(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function matchesStationText(values: (string | null | undefined)[], term: string): boolean {
  const text = normaliseStationText(values.filter(Boolean).join(" "));
  return term.split(" ").every((word) => text.includes(word));
}

export interface StationSearchResult {
  station: Station;
  address?: string;
  source: "history" | "catalog";
}

/** A label is not an identity: keep unresolved snapshots separate from IDs. */
export function stationKey(station: Station): string {
  return station.stationId ? `id:${station.stationId}` : JSON.stringify([
    normaliseStationText(station.name), normaliseStationText(station.brand ?? ""),
    station.lat ?? null, station.lng ?? null,
  ]);
}

/** Personal stations stay searchable even offline or absent from the registry. */
export function searchStationOptions(
  catalog: Catalog | null,
  history: readonly Station[],
  query: string,
  limit = 30,
): StationSearchResult[] {
  const term = normaliseStationText(query);
  if (term.length < 2 || limit <= 0) return [];
  const results: StationSearchResult[] = [];
  const add = (result: StationSearchResult) => {
    if (results.some(({ station }) => stationKey(station) === stationKey(result.station))) return;
    results.push(result);
  };
  for (const station of history) {
    if (matchesStationText([station.name, station.brand], term)) {
      add({ station, source: "history" });
      if (results.length >= limit) return results;
    }
  }
  // Apply the limit after deduplication; matching historical aliases must not
  // crowd out distinct registry stations.
  for (const entry of searchStations(catalog, query, Number.MAX_SAFE_INTEGER)) {
    add({ station: toStation(entry), address: entry.a ?? undefined, source: "catalog" });
    if (results.length >= limit) break;
  }
  return results;
}

/** Authoritative station count, when the catalog reports one. */
export function registrySize(catalog: Catalog | null): number {
  if (!catalog) return 0;
  return catalog.registryCount ?? catalog.stations?.length ?? 0;
}

export type GeoStatus = "idle" | "locating" | "ok" | "denied" | "unavailable" | "none";

export interface GeoResult {
  status: GeoStatus;
  position: { lat: number; lng: number } | null;
  nearby: NearbyStation[];
}

/**
 * Ask the browser where we are and translate that into candidate stations.
 * Never throws — a refused permission is a normal outcome, not an error.
 */
export function locateStations(
  radiusMeters = 400,
): Promise<GeoResult> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ status: "unavailable", position: null, nearby: [] });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        const catalog = await loadStationCatalog();
        const nearby = findNearby(catalog, point, radiusMeters);
        resolve({
          status: nearby.length > 0 ? "ok" : "none",
          position: point,
          nearby,
        });
      },
      (error) => {
        resolve({
          status: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
          position: null,
          nearby: [],
        });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

/** Turn a catalog entry into the shape stored on a fill-up. */
/**
 * Catalog entry → the station reference stored on a fill-up.
 *
 * The id is the identity; the name, brand and coordinates are SNAPSHOTS taken
 * at the moment of the fill-up, so a station being renamed later does not
 * rewrite the user's history.
 */
export function toStation(entry: CatalogStation): Station {
  return {
    name: entry.n,
    // Coordinates are omitted rather than stored as null when the register has
    // none, so a fill-up never claims a position it does not have.
    ...(entry.lat !== null && entry.lng !== null
      ? { lat: entry.lat, lng: entry.lng }
      : {}),
    stationId: entry.i ?? null,
    brand: entry.c ?? null,
  };
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} מ׳`;
  return `${(meters / 1000).toFixed(1)} ק״מ`;
}
