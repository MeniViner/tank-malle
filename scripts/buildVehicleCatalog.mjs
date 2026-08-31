/**
 * Dev-time generator for the tier-2 vehicle catalog.
 *
 * Tier 1 (plate lookup) covers vehicles currently in the registry. Older or
 * de-registered vehicles are not there, so the wizard falls back to a
 * manufacturer → model → year picker fed by this static JSON.
 *
 * The catalog is derived from the same Ministry of Transport open datasets,
 * which keeps the names in Hebrew and limited to the Israeli market.
 *
 *   node scripts/buildVehicleCatalog.mjs
 *
 * Output: public/vehicle-catalog.json (lazy-loaded and cached by the app).
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/vehicle-catalog.json");
const ENDPOINT = "https://data.gov.il/api/3/action/datastore_search";

const DATASETS = [
  { id: "053cea08-09bc-40ec-8f7a-156f0677aff3", label: "private" },
  { id: "851ecab1-0622-4dbe-a6c7-f950cf82abf9", label: "deregistered" },
  { id: "bf9df4e2-d90d-4c0a-a400-19e15af8e95f", label: "motorcycle" },
];

const COUNTRY_SUFFIX =
  /\s+(יפן|קוריאה|גרמניה|גרמנ|צרפת|ארה"ב|ארהב|איטליה|ספרד|צ'כיה|בריטניה|אנגליה|שבדיה|רומניה|טורקיה|סין|הודו|סלובקיה|הונגריה|פולין|בלגיה|מקסיקו|מכסיקו|ברזיל|תאילנד|קנדה|הולנד|אוסטריה|רוסיה|אוזבקיסטן|דרא"פ|פורטוגל|סלובניה|מרוקו|ארגנטינה|טיוואן|אינדונזיה|מלזיה|ויאטנם|פולי|מכסי)\s*$/u;

function cleanMake(raw) {
  if (!raw) return null;
  let name = String(raw).trim();
  // The registry appends the country of manufacture; the same brand appears
  // as "מזדה יפן" and "מזדה תאילנד" and must collapse into one entry.
  let previous;
  do {
    previous = name;
    name = name.replace(COUNTRY_SUFFIX, "").trim();
  } while (name !== previous);
  return name || null;
}

function cleanModel(raw) {
  if (!raw) return null;
  const name = String(raw).trim().replace(/\s+/g, " ");
  if (!name || name === "0" || name.length > 40) return null;
  return name;
}

async function fetchDistinct(resourceId, fields, limit) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("resource_id", resourceId);
  url.searchParams.set("fields", fields.join(","));
  url.searchParams.set("distinct", "true");
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${resourceId}`);

  const payload = await response.json();
  if (!payload.success) throw new Error(`CKAN error for ${resourceId}`);
  return payload.result.records ?? [];
}

async function main() {
  /** make -> model -> { min, max } */
  const catalog = new Map();
  let rowsSeen = 0;

  for (const dataset of DATASETS) {
    let records = [];
    try {
      records = await fetchDistinct(
        dataset.id,
        ["tozeret_nm", "kinuy_mishari", "shnat_yitzur"],
        60_000,
      );
    } catch (error) {
      console.warn(`  ! skipping ${dataset.label}: ${error.message}`);
      continue;
    }

    console.log(`  ${dataset.label}: ${records.length.toLocaleString()} distinct rows`);
    rowsSeen += records.length;

    for (const row of records) {
      const make = cleanMake(row.tozeret_nm);
      const model = cleanModel(row.kinuy_mishari);
      if (!make || !model) continue;

      const year = Number.parseInt(row.shnat_yitzur, 10);
      if (!catalog.has(make)) catalog.set(make, new Map());
      const models = catalog.get(make);
      const existing = models.get(model);

      if (!Number.isFinite(year) || year < 1950 || year > 2100) {
        if (!existing) models.set(model, null);
        continue;
      }
      if (!existing) models.set(model, { min: year, max: year });
      else {
        existing.min = Math.min(existing.min, year);
        existing.max = Math.max(existing.max, year);
      }
    }
  }

  const makes = [...catalog.entries()]
    .map(([make, models]) => ({
      make,
      models: [...models.entries()]
        .map(([model, years]) => ({
          model,
          from: years?.min ?? null,
          to: years?.max ?? null,
        }))
        .sort((a, b) => a.model.localeCompare(b.model, "he")),
    }))
    .filter((entry) => entry.models.length > 0)
    .sort((a, b) => a.make.localeCompare(b.make, "he"));

  const output = {
    generatedAt: new Date().toISOString(),
    source: "data.gov.il — Ministry of Transport vehicle registry",
    makeCount: makes.length,
    modelCount: makes.reduce((sum, m) => sum + m.models.length, 0),
    makes,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(output), "utf8");

  console.log(
    `\nWrote ${OUT}\n  ${output.makeCount} makes, ${output.modelCount} models, from ${rowsSeen.toLocaleString()} rows`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
