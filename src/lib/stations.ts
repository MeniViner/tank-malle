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
  lat: number;
  lng: number;
}

interface Catalog {
  count: number;
  companies: string[];
  stations: CatalogStation[];
}

export interface NearbyStation extends CatalogStation {
  /** Metres from the supplied position. */
  distance: number;
}

const CATALOG_URL = "/fuel-stations.json";
const CACHE_KEY = "tm.stations.v1";

let inMemory: Catalog | null = null;
let inFlight: Promise<Catalog | null> | null = null;

/**
 * Load the catalog, preferring localStorage so a repeat visit (or an offline
 * one) resolves instantly instead of waiting on the network.
 */
export async function loadStationCatalog(): Promise<Catalog | null> {
  if (inMemory) return inMemory;
  if (inFlight) return inFlight;

  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as Catalog;
      if (parsed?.stations?.length) {
        inMemory = parsed;
        return parsed;
      }
    }
  } catch {
    /* storage unavailable or corrupt — fall through to the network */
  }

  inFlight = fetch(CATALOG_URL)
    .then((response) => (response.ok ? response.json() : null))
    .then((payload: Catalog | null) => {
      if (!payload?.stations?.length) return null;
      inMemory = payload;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
      } catch {
        /* quota exceeded — the in-memory copy still serves this session */
      }
      return payload;
    })
    .catch(() => null)
    .finally(() => {
      inFlight = null;
    });

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

/** Free-text search over the catalog, for the manual station picker. */
export function searchStations(
  catalog: Catalog | null,
  query: string,
  limit = 30,
): CatalogStation[] {
  const term = query.trim();
  if (!catalog?.stations?.length || term.length < 2) return [];

  const results: CatalogStation[] = [];
  for (const station of catalog.stations) {
    if (station.n.includes(term) || station.a?.includes(term)) {
      results.push(station);
      if (results.length >= limit) break;
    }
  }
  return results;
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
    lat: entry.lat,
    lng: entry.lng,
    stationId: entry.i ?? null,
    brand: entry.c ?? null,
  };
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} מ׳`;
  return `${(meters / 1000).toFixed(1)} ק״מ`;
}
