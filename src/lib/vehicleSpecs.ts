import { lookupDeclared } from "./declaredCatalog";
import { manufacturerTank } from "./manufacturerSpecs";
import type { FuelType } from "./types";

/**
 * Technical-spec enrichment for a looked-up vehicle.
 *
 * The plate registry tells us *which* model a car is but nothing about how
 * thirsty it is. The Ministry of Transport's WLTP model register does carry
 * the certified CO₂ figure, and CO₂ per km is a direct function of fuel burnt
 * per km — so the manufacturer's declared consumption can be recovered from it
 * approximately WHEN the exact model year is on file and the
 * fuel is one we have a conversion constant for.
 *
 * Tank capacity comes from a bounded, sourced manufacturer supplement when
 * available. Otherwise a class-based approximation is only a suggestion.
 * Exact lab consumption is joined conservatively to the local ADEME catalog;
 * CO₂ conversion remains explicitly labelled as an estimate.
 */

const ENDPOINT = "https://data.gov.il/api/3/action/datastore_search";
const WLTP_RESOURCE = "142afde2-6228-49f9-8a29-9b6c3a0cbe40";

/**
 * Grams of CO₂ released per litre burnt. Approximate fuel factors: petrol ≈ 2,392 g/L, diesel ≈ 2,640 g/L.
 *
 * Deliberately sparse. "other" covers electric, hybrid-plug-in, LPG and
 * anything the registry could not classify — there is no single correct
 * constant for that set, and quietly using the petrol one would invent a
 * consumption figure for a car that may not burn petrol at all.
 */
const CO2_PER_LITER: Partial<Record<FuelType, number>> = {
  "95": 2392,
  "98": 2392,
  diesel: 2640,
};

/** Where a declared-consumption figure came from. */
export type DeclaredSource =
  /** Certified CO₂ for this exact manufacturer, model and year. */
  | "exact-year"
  /** Certified CO₂ for the same model, a different year. An estimate. */
  | "other-year"
  | null;

/** Provenance of a stored tank capacity. */
export type TankCapacitySource =
  /** Typed or confirmed by the user. Authoritative. */
  | "user"
  /** From a vehicle-specific trustworthy source. Authoritative. */
  | "trusted"
  /** Our own class-based approximation. Not authoritative. */
  | "estimate"
  /** Stored before provenance existed. Unknown, so not authoritative. */
  | "legacy";

export interface VehicleSpecs {
  /** Derived from the certified CO₂ figure, in km per litre. */
  declaredKmPerLiter: number | null;
  /** How much to trust `declaredKmPerLiter`. */
  declaredSource: DeclaredSource;
  /** The model year the figure actually came from, when one was matched. */
  matchedYear: number | null;
  /**
   * Class-based approximation in litres. A SUGGESTION for the user to confirm,
   * never a retrieved specification — see the module comment.
   */
  suggestedTankLiters: number | null;
  /** Body style from the register, e.g. "פנאי-שטח". */
  bodyType: string | null;
  engineCc: number | null;
  co2WltpGramsPerKm: number | null;
  /**
   * True only for an unambiguous matching lab consumption record. A CO₂
   * conversion is an estimate even when the registry model/year match.
   */
  consumptionIsOfficial: boolean;
  trustedTankLiters?: number | null;
  sourceUrl?: string | null;
  tankSourceUrl?: string | null;
}

const EMPTY: VehicleSpecs = {
  declaredKmPerLiter: null,
  declaredSource: null,
  matchedYear: null,
  suggestedTankLiters: null,
  bodyType: null,
  engineCc: null,
  co2WltpGramsPerKm: null,
  consumptionIsOfficial: false,
};

/** Plausible range for a road vehicle's certified economy, in km/L. */
const MIN_DECLARED_KM_PER_LITER = 3;
const MAX_DECLARED_KM_PER_LITER = 40;

/** Plausible range for a tank capacity suggestion, in litres. */
const MIN_TANK_LITERS = 10;
const MAX_TANK_LITERS = 140;

/**
 * Typical tank capacity by body style, refined by engine displacement.
 *
 * Offered to the user as a starting point they confirm or replace. It is never
 * saved on its own — `suggestedTankLiters` is not `tankLiters`.
 */
function estimateTank(bodyType: string | null, engineCc: number | null): number | null {
  const body = bodyType ?? "";
  let base: number | null = null;

  if (/אופנוע|קטנוע|דו.?גלגלי/.test(body)) base = 15;
  else if (/מיניבוס|מסחרי|משא|טנדר/.test(body)) base = 70;
  else if (/פנאי.?שטח|שטח|קרוסאובר/.test(body)) base = 58;
  else if (/מיניוואן|נוסעים/.test(body)) base = 60;
  else if (/סטיישן|תא כפול/.test(body)) base = 55;
  else if (/סדאן|נוסעים פרטי/.test(body)) base = 50;
  else if (/האצ|הצ׳בק|קומבי/.test(body)) base = 45;

  if (base === null && engineCc) {
    // Fall back to displacement alone when the body style is unfamiliar.
    if (engineCc < 1200) base = 42;
    else if (engineCc < 1700) base = 50;
    else if (engineCc < 2500) base = 58;
    else base = 70;
  }

  if (base === null) return null;

  // Nudge for unusually small or large engines within the same body class.
  if (engineCc) {
    if (engineCc < 1200) base -= 5;
    else if (engineCc > 3000) base += 8;
  }

  const rounded = Math.round(base);
  if (rounded < MIN_TANK_LITERS || rounded > MAX_TANK_LITERS) return null;
  return rounded;
}

/**
 * km/L from a certified CO₂ figure, or null.
 *
 * Returns null for a fuel type with no conversion constant — electric models
 * report 0 g/km, and a plug-in hybrid's certified figure does not describe the
 * petrol it actually burns. Inventing a number to fill the field is worse than
 * leaving it empty.
 */
export function declaredFromCo2(
  co2GramsPerKm: number | null,
  fuelType: FuelType,
): number | null {
  if (!co2GramsPerKm || co2GramsPerKm <= 0) return null;

  const gramsPerLiter = CO2_PER_LITER[fuelType];
  if (!gramsPerLiter) return null;

  const litersPer100 = (co2GramsPerKm * 100) / gramsPerLiter;
  if (litersPer100 <= 0) return null;

  const kmPerLiter = Math.round((100 / litersPer100) * 10) / 10;
  if (kmPerLiter < MIN_DECLARED_KM_PER_LITER || kmPerLiter > MAX_DECLARED_KM_PER_LITER) {
    return null;
  }
  return kmPerLiter;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Look up the certified specs for a model.
 *
 * Keyed by the manufacturer/model codes the plate registry already returned,
 * which is an exact join — no fuzzy name matching. The exact model year is
 * tried first; a hit on another year of the same model is still returned, but
 * classified as `other-year` so nothing downstream can call it official.
 */
export async function fetchVehicleSpecs(
  params: {
    make?: string;
    model?: string;
    engineCc?: number | null;
    tozeretCd?: number | null;
    degemCd?: number | null;
    year?: number | null;
    fuelType?: FuelType;
  },
  signal?: AbortSignal,
): Promise<VehicleSpecs> {
  const { tozeretCd, degemCd, year, fuelType = "95" } = params;
  const trustedTank = manufacturerTank(params.make, params.model, year, fuelType);
  const fallback: VehicleSpecs = { ...EMPTY, trustedTankLiters: trustedTank?.liters ?? null, tankSourceUrl: trustedTank?.url ?? null };
  if ((!tozeretCd || !degemCd) && (!params.model || !year)) return fallback;

  const attempts: { filters: Record<string, string>; source: DeclaredSource }[] = [];
  if (year && tozeretCd && degemCd) {
    attempts.push({
      filters: {
        tozeret_cd: String(tozeretCd),
        degem_cd: String(degemCd),
        shnat_yitzur: String(year),
      },
      source: "exact-year",
    });
  }
  if (tozeretCd && degemCd) attempts.push({
    filters: { tozeret_cd: String(tozeretCd), degem_cd: String(degemCd) },
    source: "other-year",
  });

  if (params.model && year) attempts.push({ filters: { shnat_yitzur: String(year), kinuy_mishari: params.model.trim().split(/\s+/)[0].toUpperCase() }, source: 'exact-year' });

  for (const attempt of attempts) {
    try {
      const url = new URL(ENDPOINT);
      url.searchParams.set("resource_id", WLTP_RESOURCE);
      url.searchParams.set("limit", "100");
      url.searchParams.set("filters", JSON.stringify(attempt.filters));

      const response = await fetch(url.toString(), { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(7000)]) : AbortSignal.timeout(7000) });
      if (!response.ok) continue;

      const payload = (await response.json()) as {
        result?: { records?: Record<string, unknown>[] };
      };
      const records = payload.result?.records ?? [];
      const candidates = records.filter(row => {
        if (tozeretCd && Number(row.tozeret_cd) !== tozeretCd) return false;
        if (!tozeretCd && params.make && !String(row.tozeret_nm || row.tozar).includes(params.make.split(' ')[0]) && !String(row.tozar).toLowerCase().includes(params.make.toLowerCase())) return false;
        if (params.engineCc && Math.abs(Number(row.nefah_manoa) - params.engineCc) > 30) return false;
        return true;
      });
      // A name can identify several transmissions. Do not silently choose one.
      const row = candidates.length === 1 || (tozeretCd && degemCd) ? candidates[0] : undefined;
      if (!row) continue;

      const co2 = toNumber(row.CO2_WLTP) ?? toNumber(row.kamut_CO2);
      const engineCc = toNumber(row.nefah_manoa);
      const bodyType = typeof row.merkav === "string" ? row.merkav.trim() || null : null;
      const rowYear = toNumber(row.shnat_yitzur);

      const certified = await lookupDeclared(row, signal);
      const declaredKmPerLiter = certified?.kmPerLiter ?? declaredFromCo2(co2, fuelType);
      // A looser-year hit is an estimate even when the row is otherwise exact.
      const matchedExactYear =
        attempt.source === "exact-year" || (year !== null && rowYear === year);

      return {
        ...fallback,
        sourceUrl: certified?.url ?? "https://data.gov.il/dataset/degamim-rechev-wltp",
        declaredKmPerLiter,
        declaredSource: declaredKmPerLiter === null
          ? null
          : matchedExactYear
            ? "exact-year"
            : "other-year",
        matchedYear: rowYear ?? (matchedExactYear ? (year ?? null) : null),
        suggestedTankLiters: estimateTank(bodyType, engineCc),
        bodyType,
        engineCc,
        co2WltpGramsPerKm: co2,
        consumptionIsOfficial: Boolean(certified) && matchedExactYear,
      };
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      // Network hiccup — try the looser filter, then give up quietly.
    }
  }

  return fallback;
}
