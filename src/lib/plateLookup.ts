import type { FuelType, PlateLookupResult } from "./types";

/**
 * Tier 1 of vehicle lookup: the Israeli Ministry of Transport open data
 * registry on data.gov.il (CKAN datastore_search, no API key).
 *
 * The parser is deliberately defensive — the published schema drifts, fields
 * come back as strings or numbers, and several datasets use different column
 * names for the same concept.
 */

const CKAN_ENDPOINT = "https://data.gov.il/api/3/action/datastore_search";

/** Proxy used when the browser blocks the cross-origin call. */
const PROXY_ENDPOINT = "/api/vehicle-lookup";

interface Dataset {
  id: string;
  source: NonNullable<PlateLookupResult["source"]>;
  label: string;
}

/** Searched in order; the private/commercial registry covers most vehicles. */
const DATASETS: Dataset[] = [
  { id: "053cea08-09bc-40ec-8f7a-156f0677aff3", source: "private", label: "רכב פרטי" },
  { id: "bf9df4e2-d90d-4c0a-a400-19e15af8e95f", source: "motorcycle", label: "דו־גלגלי" },
  { id: "cd3acc5c-03c3-4c89-9c54-d40f93c0d790", source: "heavy", label: "רכב כבד" },
  { id: "03adc637-b6fe-402b-9937-7c3d3afc9140", source: "offroad", label: "רכב שטח" },
  { id: "851ecab1-0622-4dbe-a6c7-f950cf82abf9", source: "deregistered", label: "ירד מהכביש" },
];

type Row = Record<string, unknown>;

function str(row: Row, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text && text !== "0") return text;
  }
  return undefined;
}

function int(row: Row, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    const parsed = Number.parseInt(String(value).replace(/\D/g, ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/** Map the registry's Hebrew fuel labels onto our four fuel types. */
function mapFuelType(raw: string | undefined): FuelType {
  if (!raw) return "95";
  const text = raw.trim();
  if (/סולר|דיזל/.test(text)) return "diesel";
  if (/98/.test(text)) return "98";
  if (/בנזין|95/.test(text)) return "95";
  if (/חשמל|היבריד|hybrid|גז/i.test(text)) return "other";
  return "95";
}

function normalizePlate(raw: string): string {
  return raw.replace(/\D/g, "");
}

function parseRow(row: Row, dataset: Dataset, plate: string): PlateLookupResult {
  const make = str(row, "tozeret_nm", "tozar", "tozeret_cd_nm", "shem_tozar");
  const commercialName = str(row, "kinuy_mishari", "degem_nm", "sug_degem");
  const trim = str(row, "ramat_gimur");
  const engineVolume = int(row, "nefch_manoa");

  // Year of manufacture, falling back to the road-entry date.
  const year =
    int(row, "shnat_yitzur") ??
    (() => {
      const road = str(row, "moed_aliya_lakvish");
      const match = road?.match(/(\d{4})/);
      return match ? Number.parseInt(match[1], 10) : null;
    })();

  const fuelLabel = str(row, "sug_delek_nm", "sug_delek");

  // The registry's trim level is often longer than the model itself
  // ("RAV 4 HYBRID" + "E-XPERIENCE"), which overflows the header pill. Keep it
  // only when the combined name stays short enough to read at a glance.
  const combined = [commercialName, trim].filter(Boolean).join(" ").trim();
  const model = combined.length <= 22 ? combined : (commercialName ?? combined);

  return {
    found: true,
    source: dataset.source,
    plateNumber: plate,
    make: make ? cleanMake(make) : undefined,
    model: model || undefined,
    year,
    fuelType: mapFuelType(fuelLabel),
    engineVolume,
    category: [dataset.label, fuelLabel].filter(Boolean).join(" · "),
  };
}

/** The registry stores manufacturers as "מאזדה יפן" / "MAZDA"; keep it short. */
function cleanMake(raw: string): string {
  return raw
    .replace(/\s+(יפן|קוריאה|גרמניה|צרפת|ארה"ב|ארהב|איטליה|ספרד|צ'כיה|בריטניה|שבדיה|רומניה|טורקיה|סין|הודו|סלובקיה|הונגריה|פולין|בלגיה|מקסיקו|ברזיל)\s*$/u, "")
    .trim();
}

async function queryDataset(
  dataset: Dataset,
  plate: string,
  signal?: AbortSignal,
): Promise<Row | null> {
  const url = new URL(CKAN_ENDPOINT);
  url.searchParams.set("resource_id", dataset.id);
  url.searchParams.set("limit", "1");
  url.searchParams.set("filters", JSON.stringify({ mispar_rechev: plate }));

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) throw new Error(`lookup failed: ${response.status}`);

  const payload = (await response.json()) as {
    success?: boolean;
    result?: { records?: Row[] };
  };
  const records = payload?.result?.records;
  return records && records.length > 0 ? records[0] : null;
}

/** Same query, routed through our own function to sidestep CORS. */
async function queryViaProxy(plate: string, signal?: AbortSignal): Promise<PlateLookupResult> {
  const response = await fetch(`${PROXY_ENDPOINT}?plate=${encodeURIComponent(plate)}`, {
    signal,
  });
  if (!response.ok) throw new Error(`proxy lookup failed: ${response.status}`);
  return (await response.json()) as PlateLookupResult;
}

export async function lookupPlate(
  rawPlate: string,
  signal?: AbortSignal,
): Promise<PlateLookupResult> {
  const plate = normalizePlate(rawPlate);
  if (plate.length < 5) {
    return { found: false, source: null, plateNumber: plate };
  }

  let sawNetworkError = false;

  for (const dataset of DATASETS) {
    try {
      const row = await queryDataset(dataset, plate, signal);
      if (row) return parseRow(row, dataset, plate);
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      // Most likely CORS or an outage — remember it and keep trying the rest.
      sawNetworkError = true;
    }
  }

  if (sawNetworkError) {
    try {
      return await queryViaProxy(plate, signal);
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      throw new Error("lookup-unavailable");
    }
  }

  return { found: false, source: null, plateNumber: plate };
}
