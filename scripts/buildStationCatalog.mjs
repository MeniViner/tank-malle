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

async function main() {
  const first = await fetchPage(0, 1);
  const total = first.total ?? 0;
  console.log(`  register reports ${total} stations`);

  const records = [];
  const pageSize = 1000;
  for (let offset = 0; offset < total; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    records.push(...(page.records ?? []));
    console.log(`  fetched ${records.length}/${total}`);
  }

  const seen = new Set();
  const stations = [];

  for (const row of records) {
    const lat = coord(row[FIELD.lat]);
    const lng = coord(row[FIELD.lng]);
    // Israel's bounding box — drops the handful of rows with unset or
    // projected (ITM) coordinates that would otherwise land in the ocean.
    if (lat === null || lng === null) continue;
    if (lat < 29.4 || lat > 33.4 || lng < 34.2 || lng > 35.9) continue;

    const company = normalizeBrand(row[FIELD.company]);
    const name = clean(row[FIELD.name]);
    if (!company && !name) continue;

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
    const key = `${label}|${lat}|${lng}`;
    if (seen.has(key)) continue;
    seen.add(key);

    stations.push({
      n: label,
      c: company,
      a: clean(row[FIELD.address]) ?? clean(row[FIELD.authority]),
      lat,
      lng,
    });
  }

  stations.sort((a, b) => a.lat - b.lat);

  const companies = [...new Set(stations.map((s) => s.c).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "he"),
  );

  const output = {
    generatedAt: new Date().toISOString(),
    source: "data.gov.il — Ministry of Energy public fuel-station register",
    count: stations.length,
    companies,
    stations,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(output), "utf8");

  console.log(
    `\nWrote ${OUT}\n  ${stations.length} stations, ${companies.length} companies`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
