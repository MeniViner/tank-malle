import type { FuelType } from "./types";

/**
 * Technical-spec enrichment for a looked-up vehicle.
 *
 * The plate registry tells us *which* model a car is but nothing about how
 * thirsty it is. The Ministry of Transport's WLTP model register does carry
 * the certified CO₂ figure, and CO₂ per km is a direct function of fuel burnt
 * per km — so the manufacturer's declared consumption can be recovered from
 * it exactly, rather than guessed.
 *
 * Tank capacity is not published in any Israeli open dataset. We therefore
 * offer a class-based estimate and label it as one in the UI; the user can
 * always overwrite it.
 */

const ENDPOINT = "https://data.gov.il/api/3/action/datastore_search";
const WLTP_RESOURCE = "142afde2-6228-49f9-8a29-9b6c3a0cbe40";

/**
 * Grams of CO₂ released per litre burnt. These are stoichiometric constants,
 * not estimates: petrol ≈ 2,392 g/L, diesel ≈ 2,640 g/L, LPG ≈ 1,665 g/L.
 */
const CO2_PER_LITER: Record<string, number> = {
  "95": 2392,
  "98": 2392,
  diesel: 2640,
  other: 2392,
};

export interface VehicleSpecs {
  /** Derived from the certified CO₂ figure, in km per litre. */
  declaredKmPerLiter: number | null;
  /** Class-based approximation in litres — always presented as an estimate. */
  estimatedTankLiters: number | null;
  /** Body style from the register, e.g. "פנאי-שטח". */
  bodyType: string | null;
  engineCc: number | null;
  co2WltpGramsPerKm: number | null;
  /** True when the consumption came from certified data rather than a guess. */
  consumptionIsOfficial: boolean;
}

const EMPTY: VehicleSpecs = {
  declaredKmPerLiter: null,
  estimatedTankLiters: null,
  bodyType: null,
  engineCc: null,
  co2WltpGramsPerKm: null,
  consumptionIsOfficial: false,
};

/**
 * Typical tank capacity by body style, refined by engine displacement.
 * Deliberately conservative: a number that is roughly right and editable
 * beats an empty field, and it only ever feeds the range estimate.
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

  return Math.max(20, Math.round(base));
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
 * which is an exact join — no fuzzy name matching.
 */
export async function fetchVehicleSpecs(
  params: {
    tozeretCd?: number | null;
    degemCd?: number | null;
    year?: number | null;
    fuelType?: FuelType;
  },
  signal?: AbortSignal,
): Promise<VehicleSpecs> {
  const { tozeretCd, degemCd, year, fuelType = "95" } = params;
  if (!tozeretCd || !degemCd) return EMPTY;

  // Prefer the exact model year, then fall back to any year of the same model
  // — CO₂ ratings rarely move between years of one generation.
  const filterSets: Record<string, string>[] = [];
  if (year) {
    filterSets.push({
      tozeret_cd: String(tozeretCd),
      degem_cd: String(degemCd),
      shnat_yitzur: String(year),
    });
  }
  filterSets.push({ tozeret_cd: String(tozeretCd), degem_cd: String(degemCd) });

  for (const filters of filterSets) {
    try {
      const url = new URL(ENDPOINT);
      url.searchParams.set("resource_id", WLTP_RESOURCE);
      url.searchParams.set("limit", "1");
      url.searchParams.set("filters", JSON.stringify(filters));

      const response = await fetch(url.toString(), { signal });
      if (!response.ok) continue;

      const payload = (await response.json()) as {
        result?: { records?: Record<string, unknown>[] };
      };
      const row = payload.result?.records?.[0];
      if (!row) continue;

      const co2 = toNumber(row.CO2_WLTP) ?? toNumber(row.kamut_CO2);
      const engineCc = toNumber(row.nefah_manoa);
      const bodyType = typeof row.merkav === "string" ? row.merkav.trim() || null : null;

      let declaredKmPerLiter: number | null = null;
      if (co2) {
        const gramsPerLiter = CO2_PER_LITER[fuelType] ?? CO2_PER_LITER["95"];
        const litersPer100 = (co2 * 100) / gramsPerLiter;
        if (litersPer100 > 0) {
          declaredKmPerLiter = Math.round((100 / litersPer100) * 10) / 10;
        }
      }

      // Electric models report 0 g/km, which would imply infinite economy.
      if (declaredKmPerLiter !== null && (declaredKmPerLiter > 60 || declaredKmPerLiter < 3)) {
        declaredKmPerLiter = null;
      }

      return {
        declaredKmPerLiter,
        estimatedTankLiters: estimateTank(bodyType, engineCc),
        bodyType,
        engineCc,
        co2WltpGramsPerKm: co2,
        consumptionIsOfficial: declaredKmPerLiter !== null,
      };
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      // Network hiccup — try the looser filter, then give up quietly.
    }
  }

  return EMPTY;
}
