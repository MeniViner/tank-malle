import type { FuelType, PlateLookupResult } from "./types";

/**
 * Tier 1 of vehicle lookup: the Israeli Ministry of Transport open data
 * registry on data.gov.il (CKAN datastore_search, no API key).
 *
 * The central rule: **an external-service failure is never reported as
 * "not found"**. A timeout, a CORS block, a 503, an HTML error page or a
 * partial dataset sweep all mean "we do not know", which is a different answer
 * from "this plate is not in the registry" and must be shown differently.
 *
 * The parser is deliberately defensive — the published schema drifts, fields
 * come back as strings or numbers, and several datasets use different column
 * names for the same concept.
 */

const CKAN_ENDPOINT = "https://data.gov.il/api/3/action/datastore_search";

/**
 * Our own CORS proxy. Written but NOT deployed: the project is on Spark, and
 * Hosting currently rewrites every unmatched path to the SPA — so requesting
 * this route returns index.html, which would parse as "no records" and produce
 * a false "not found". It is therefore opt-in via configuration, and the
 * response is content-type and schema checked before it is believed.
 */
const PROXY_ENDPOINT = "/api/vehicle-lookup";
const PROXY_ENABLED = import.meta.env.VITE_VEHICLE_LOOKUP_PROXY === "1";

/**
 * Timing, in one place so tests can shorten the backoff without stubbing
 * timers around real async work.
 */
export const lookupTuning = {
  requestTimeoutMs: 7_000,
  retryDelayMs: 400,
};

const CACHE_TTL_MS = 30 * 86_400_000;
const CACHE_PREFIX = "tm.plate.v1";

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

/* ------------------------------------------------------------------ *
 * Outcome model
 * ------------------------------------------------------------------ */

export type LookupFailureReason =
  | "timeout"
  | "network"
  | "http-error"
  | "non-json"
  | "html-response"
  | "api-error"
  | "schema-mismatch"
  | "plate-mismatch"
  | "partial-sweep";

export type LookupOutcome =
  | { status: "found"; vehicle: PlateLookupResult; fromCache?: boolean }
  /** Every relevant dataset answered cleanly and none held this plate. */
  | { status: "not-found"; datasetsChecked: number }
  /**
   * We could not get a trustworthy answer. `cached` carries the last known
   * good result for this plate, when there is one.
   */
  | {
      status: "unavailable";
      reason: LookupFailureReason;
      cached: PlateLookupResult | null;
    };

/** Hebrew copy for each outcome. Kept here so every caller says the same thing. */
export const LOOKUP_MESSAGES = {
  notFound: "הרכב לא נמצא במאגרים שנבדקו. אפשר לבחור מהרשימה או להזין ידנית.",
  unavailable:
    "מאגר משרד התחבורה אינו זמין כרגע. נסו שוב בעוד כמה דקות או המשיכו בהזנה ידנית.",
  cachedFallback:
    "מאגר משרד התחבורה אינו זמין כרגע — מוצגים הפרטים שנמצאו בבדיקה הקודמת.",
} as const;

/* ------------------------------------------------------------------ *
 * Row parsing (unchanged behaviour)
 * ------------------------------------------------------------------ */

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

export function normalizePlate(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** The registry stores manufacturers as "מאזדה יפן" / "MAZDA"; keep it short. */
function cleanMake(raw: string): string {
  return raw
    .replace(
      /\s+(יפן|קוריאה|גרמניה|צרפת|ארה"ב|ארהב|איטליה|ספרד|צ'כיה|בריטניה|שבדיה|רומניה|טורקיה|סין|הודו|סלובקיה|הונגריה|פולין|בלגיה|מקסיקו|ברזיל)\s*$/u,
      "",
    )
    .trim();
}

export function parseRow(row: Row, dataset: Dataset, plate: string): PlateLookupResult {
  const make = str(row, "tozeret_nm", "tozar", "tozeret_cd_nm", "shem_tozar");
  const commercialName = str(row, "kinuy_mishari", "degem_nm", "sug_degem");
  const trim = str(row, "ramat_gimur");
  const engineVolume = int(row, "nefch_manoa");

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
    tozeretCd: int(row, "tozeret_cd"),
    degemCd: int(row, "degem_cd"),
  };
}

/* ------------------------------------------------------------------ *
 * One dataset query, with explicit failure classification
 * ------------------------------------------------------------------ */

class LookupFailure extends Error {
  readonly reason: LookupFailureReason;
  constructor(reason: LookupFailureReason) {
    super(reason);
    this.reason = reason;
  }
}

type DatasetAnswer =
  /** Authoritative: the dataset answered and holds this plate. */
  | { kind: "hit"; row: Row }
  /** Authoritative: the dataset answered cleanly and does not hold it. */
  | { kind: "miss" };

/**
 * Query one dataset.
 *
 * Every step that could make the answer uncertain throws a classified
 * LookupFailure rather than returning a miss. A miss is only returned for a
 * 2xx JSON response with success === true, a well-formed result object and an
 * empty records array.
 */
async function queryDataset(
  dataset: Dataset,
  plate: string,
  signal: AbortSignal,
  /** CKAN types mispar_rechev numerically in some datasets and as text in
   *  others. The numeric form is tried first, then text — never relying on
   *  implicit coercion. */
  asNumber: boolean,
): Promise<DatasetAnswer> {
  const url = new URL(CKAN_ENDPOINT);
  url.searchParams.set("resource_id", dataset.id);
  url.searchParams.set("limit", "1");
  url.searchParams.set(
    "filters",
    JSON.stringify({ mispar_rechev: asNumber ? Number(plate) : plate }),
  );

  let response: Response;
  try {
    response = await fetch(url.toString(), { signal, cache: "no-store" });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    // Indistinguishable at this layer: DNS failure, offline, CORS block.
    throw new LookupFailure("network");
  }

  if (!response.ok) {
    // 409 on these datasets means the filter type did not match the column.
    throw new LookupFailure(response.status === 409 ? "schema-mismatch" : "http-error");
  }

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  // A Hosting rewrite serving the SPA is the classic false negative: it is a
  // 200 with an HTML body, which JSON.parse would reject but which a lenient
  // parser could read as "no records".
  if (/^\s*<(?:!doctype|html)/i.test(text)) throw new LookupFailure("html-response");
  if (contentType && !contentType.includes("json") && !contentType.includes("text/plain")) {
    throw new LookupFailure("non-json");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new LookupFailure("non-json");
  }

  if (typeof payload !== "object" || payload === null) {
    throw new LookupFailure("schema-mismatch");
  }

  const body = payload as { success?: unknown; result?: unknown };
  if (body.success !== true) throw new LookupFailure("api-error");

  const result = body.result;
  if (typeof result !== "object" || result === null || !("records" in result)) {
    throw new LookupFailure("schema-mismatch");
  }

  const records = (result as { records?: unknown }).records;
  if (!Array.isArray(records)) throw new LookupFailure("schema-mismatch");
  if (records.length === 0) return { kind: "miss" };

  const row = records[0] as Row;
  // Guard against a filter that was ignored server-side: the row we got back
  // must actually be the plate we asked for.
  const returnedPlate = normalizePlate(String(row.mispar_rechev ?? ""));
  if (returnedPlate && returnedPlate !== plate) throw new LookupFailure("plate-mismatch");

  return { kind: "hit", row };
}

/** One dataset, with a bounded timeout and a single retry for transient faults. */
async function queryDatasetResilient(
  dataset: Dataset,
  plate: string,
  outer: AbortSignal | undefined,
): Promise<DatasetAnswer> {
  const attempt = async (asNumber: boolean): Promise<DatasetAnswer> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), lookupTuning.requestTimeoutMs);
    const onAbort = () => controller.abort();
    outer?.addEventListener("abort", onAbort);
    try {
      return await queryDataset(dataset, plate, controller.signal, asNumber);
    } catch (error) {
      // Distinguish our own timeout from a caller-initiated cancellation.
      if ((error as Error).name === "AbortError") {
        if (outer?.aborted) throw error;
        throw new LookupFailure("timeout");
      }
      throw error;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    }
  };

  try {
    return await attempt(true);
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    const reason = error instanceof LookupFailure ? error.reason : "network";

    // A type mismatch is answered by asking the other way, not by retrying.
    if (reason === "schema-mismatch") return await attempt(false);

    // One short retry for the genuinely transient failures.
    if (reason === "timeout" || reason === "network" || reason === "http-error") {
      await new Promise((resolve) => setTimeout(resolve, lookupTuning.retryDelayMs));
      return await attempt(true);
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Last-known-good cache
 * ------------------------------------------------------------------ */

/**
 * Cached per user and plate. The key is hashed rather than stored in the
 * clear, so a shared device does not leave a readable list of plate numbers in
 * localStorage, and no plate ever reaches a log or an analytics call.
 */
function cacheKey(uid: string, plate: string): string {
  let hash = 2166136261;
  const input = `${uid}:${plate}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${CACHE_PREFIX}.${(hash >>> 0).toString(36)}`;
}

export function readCachedLookup(
  uid: string | null | undefined,
  plate: string,
): PlateLookupResult | null {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(cacheKey(uid, plate));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: PlateLookupResult };
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    // Belt and braces: never hand back a cached record for a different plate.
    return parsed.data.plateNumber === plate ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeCachedLookup(
  uid: string | null | undefined,
  plate: string,
  data: PlateLookupResult,
): void {
  if (!uid) return;
  try {
    localStorage.setItem(cacheKey(uid, plate), JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota or private mode */
  }
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export interface LookupOptions {
  signal?: AbortSignal;
  /** Scopes the last-known-good cache. */
  uid?: string | null;
}

/**
 * Look up a plate.
 *
 * Returns "not-found" only when EVERY dataset answered cleanly and none held
 * the plate. If any dataset failed for any reason, the sweep is incomplete and
 * the answer is "unavailable" — with the last known good result attached when
 * one exists.
 */
export async function lookupPlate(
  rawPlate: string,
  options: LookupOptions = {},
): Promise<LookupOutcome> {
  const { signal, uid } = options;
  const plate = normalizePlate(rawPlate);

  if (plate.length < 5) {
    return { status: "not-found", datasetsChecked: 0 };
  }

  let checked = 0;
  let firstFailure: LookupFailureReason | null = null;

  for (const dataset of DATASETS) {
    try {
      const answer = await queryDatasetResilient(dataset, plate, signal);
      checked += 1;
      if (answer.kind === "hit") {
        const vehicle = parseRow(answer.row, dataset, plate);
        writeCachedLookup(uid, plate, vehicle);
        return { status: "found", vehicle };
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      if (firstFailure === null) {
        firstFailure = error instanceof LookupFailure ? error.reason : "network";
      }
    }
  }

  // Some datasets failed, so "not in any of them" is not a conclusion we are
  // entitled to draw — even if the ones that did answer came back empty.
  if (firstFailure !== null) {
    const viaProxy = await tryProxy(plate, signal);
    if (viaProxy) {
      writeCachedLookup(uid, plate, viaProxy);
      return { status: "found", vehicle: viaProxy };
    }
    return {
      status: "unavailable",
      reason: checked > 0 ? "partial-sweep" : firstFailure,
      cached: readCachedLookup(uid, plate),
    };
  }

  return { status: "not-found", datasetsChecked: checked };
}

/**
 * The proxy is only consulted when it has been explicitly enabled. On Spark it
 * is not deployed and Hosting would answer with the SPA, so calling it by
 * default would manufacture false results.
 */
async function tryProxy(
  plate: string,
  signal: AbortSignal | undefined,
): Promise<PlateLookupResult | null> {
  if (!PROXY_ENABLED) return null;

  try {
    const response = await fetch(`${PROXY_ENDPOINT}?plate=${encodeURIComponent(plate)}`, {
      signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    if (!(response.headers.get("content-type") ?? "").includes("json")) return null;

    const text = await response.text();
    if (/^\s*<(?:!doctype|html)/i.test(text)) return null;

    const payload = JSON.parse(text) as Partial<PlateLookupResult>;
    if (payload.found !== true) return null;
    if (normalizePlate(String(payload.plateNumber ?? "")) !== plate) return null;
    return payload as PlateLookupResult;
  } catch {
    return null;
  }
}
