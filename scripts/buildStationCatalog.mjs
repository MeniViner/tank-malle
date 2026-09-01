/**
 * Dev-time generator for the fuel-station catalog.
 *
 * Source: the Ministry of Energy's public register of petrol stations on
 * data.gov.il, which carries WGS84 coordinates for every licensed station.
 *
 *   node scripts/buildStationCatalog.mjs
 *
 * Output: public/fuel-stations.json — small enough to ship and cache, so the
 * app can name the station you are standing at with no network call at all.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/fuel-stations.json");
const ENDPOINT = "https://data.gov.il/api/3/action/datastore_search";
const RESOURCE = "5537a0ef-3eeb-449c-90c8-51e27564f0cb";

const FIELD = {
  id: "מס_מינהל_הדלק",
  company: "חברה",
  name: "שם_תחנה",
  address: "כתובת",
  authority: "רשות_מקומית",
  lng: "נ.צ. אורך",
  lat: "נ.צ. רוחב",
};

function clean(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  return text && text !== "0" ? text : null;
}

/**
 * The register spells the same brand several ways ("דור אלון" / "דור-אלון")
 * and stores small operators under their full legal name. Normalising keeps
 * the station picker readable and makes per-station stats group correctly.
 */
const BRANDS = [
  [/^פז/, "פז"],
  [/^סונול/, "סונול"],
  [/^דלקנית|^דלק\b/, "דלק"],
  [/^דור[\s-]?אלון/, "דור אלון"],
  [/^טן\b/, "טן"],
  [/^סד"?ש/, 'סד"ש'],
  [/^יעד/, "יעד"],
  [/^תפוז/, "תפוז"],
  [/^מיקה/, "מיקה"],
  [/^טווינס/, "טווינס"],
  [/^בל אנרגיה/, "בל אנרגיה"],
  [/^רשת קרן אנרגיה/, "קרן אנרגיה"],
  [/^הגליל/, "הגליל"],
  [/^אחר/, "עצמאי"],
];

function normalizeBrand(raw) {
  const name = clean(raw);
  if (!name) return null;
  for (const [pattern, canonical] of BRANDS) {
    if (pattern.test(name)) return canonical;
  }
  // Drop corporate suffixes from the long-tail operators.
  return name.replace(/\s*(בע"מ|בעמ|\(\d{4}\))\s*$/g, "").trim() || name;
}

function coord(value) {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 1e5) / 1e5 : null;
}

async function fetchPage(offset, limit) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("resource_id", RESOURCE);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.success) throw new Error("CKAN reported failure");
  return payload.result;
}

/** The resource's last-modified date, from CKAN's package metadata. */
async function fetchSourceUpdatedAt() {
  try {
    const url = new URL("https://data.gov.il/api/3/action/resource_show");
    url.searchParams.set("id", RESOURCE);
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.result?.last_modified ?? payload?.result?.created ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const first = await fetchPage(0, 1);
  const total = first.total ?? 0;
  // The register's own last-modified stamp, so the catalog can say how old the
  // authoritative data is rather than only when we happened to fetch it.
  const sourceUpdatedAt = await fetchSourceUpdatedAt();
  console.log(`  register reports ${total} stations`);

  const records = [];
  const pageSize = 1000;
  for (let offset = 0; offset < total; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    records.push(...(page.records ?? []));
    console.log(`  fetched ${records.length}/${total}`);
  }

  /**
   * Two concepts, deliberately kept apart.
   *
   * `stations` is the GEO-ENABLED subset: entries with usable coordinates,
   * which is what nearby-station detection needs. `registry` is the
   * AUTHORITATIVE list: every station the register holds, coordinates or not.
   *
   * Conflating them silently discards real stations. A station with a broken
   * coordinate is still a station a driver can be standing at, and it must
   * remain findable by name — it simply cannot be detected automatically.
   */
  const seen = new Set();
  const stations = [];
  const registry = [];
  const audit = {
    fetched: records.length,
    reportedTotal: total,
    noIdentifier: 0,
    noName: 0,
    missingCoordinates: 0,
    coordinatesOutOfRange: 0,
    duplicateIdentifier: 0,
  };

  for (const row of records) {
    const rawLat = coord(row[FIELD.lat]);
    const rawLng = coord(row[FIELD.lng]);

    // Israel's bounding box. A coordinate outside it is unset or projected
    // (ITM) and would otherwise land the station in the ocean.
    const inRange =
      rawLat !== null &&
      rawLng !== null &&
      rawLat >= 29.4 &&
      rawLat <= 33.4 &&
      rawLng >= 34.2 &&
      rawLng <= 35.9;

    if (rawLat === null || rawLng === null) audit.missingCoordinates += 1;
    else if (!inRange) audit.coordinatesOutOfRange += 1;

    const lat = inRange ? rawLat : null;
    const lng = inRange ? rawLng : null;

    const company = normalizeBrand(row[FIELD.company]);
    const name = clean(row[FIELD.name]);
    if (!company && !name) {
      audit.noName += 1;
      continue;
    }

    // The register splits brand and branch; the app shows them joined, the
    // way a driver would say it out loud ("פז צומת גולני"). Many branch names
    // already contain the brand somewhere ("תחנת דלק מיקה אילת"), so only
    // prepend when it is genuinely missing.
    const branch = name?.replace(/^תחנ[הת]\s+דלק\s+/, "").trim() || name;
    const label =
      company && branch
        ? branch.includes(company)
          ? branch
          : `${company} ${branch}`
        : company || branch;
    const identifier = clean(row[FIELD.id]);
    if (!identifier) audit.noIdentifier += 1;

    const key = identifier ?? `${label}|${lat}|${lng}`;
    if (seen.has(key)) {
      audit.duplicateIdentifier += 1;
      continue;
    }
    seen.add(key);

    const entry = {
      // The government's own station number. This is the STABLE IDENTITY:
      // display names change, branches are renamed and brands are re-signed,
      // but this does not. It was read from the register and then dropped,
      // which is why stored fill-ups could only ever reference a station by
      // name and coordinates.
      i: identifier,
      n: label,
      c: company,
      a: clean(row[FIELD.address]) ?? clean(row[FIELD.authority]),
      lat,
      lng,
    };

    // Every station goes in the registry, coordinates or not.
    registry.push(entry);
    // Only those we can actually place go in the geo subset.
    if (lat !== null && lng !== null) stations.push(entry);
  }

  stations.sort((a, b) => a.lat - b.lat);
  registry.sort((a, b) => a.n.localeCompare(b.n, "he"));

  const companies = [...new Set(registry.map((s) => s.c).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "he"),
  );

  const withoutCoordinates = registry.filter((s) => s.lat === null || s.lng === null);

  const output = {
    generatedAt: new Date().toISOString(),
    source: "data.gov.il — Ministry of Energy public fuel-station register",
    sourceUpdatedAt: sourceUpdatedAt ?? null,

    /** Authoritative station count — every station the register holds. */
    registryCount: registry.length,
    /** The subset that can be placed on a map, for nearby detection. */
    count: stations.length,

    companies,

    /**
     * Geo-enabled subset, sorted by latitude so a latitude band prunes the
     * search cheaply. Nearby detection uses this and only this.
     */
    stations,

    /**
     * Stations the register holds that have no usable coordinate. They are
     * NOT discarded: they remain searchable by name and carry the same stable
     * identifier, they simply cannot be detected automatically.
     */
    registryOnly: withoutCoordinates,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(output), "utf8");

  console.log(`\nWrote ${OUT}`);
  console.log("\nStation catalog audit");
  console.log(`  register reports:            ${audit.reportedTotal}`);
  console.log(`  rows fetched:                ${audit.fetched}`);
  console.log(`  authoritative stations:      ${registry.length}`);
  console.log(`  geo-enabled (has coords):    ${stations.length}`);
  console.log(`  registry-only (no coords):   ${withoutCoordinates.length}`);
  console.log(`    missing coordinates:       ${audit.missingCoordinates}`);
  console.log(`    coordinates out of range:  ${audit.coordinatesOutOfRange}`);
  console.log(`  skipped, no brand or name:   ${audit.noName}`);
  console.log(`  skipped, duplicate id:       ${audit.duplicateIdentifier}`);
  console.log(`  rows with no station number: ${audit.noIdentifier}`);
  console.log(`  companies:                   ${companies.length}`);
  console.log(`  source last updated:         ${sourceUpdatedAt ?? "unknown"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
