import type { FuelType } from "../stats";
import type { CatalogStation } from "../stations";
import type { Confidence, Freshness, ResolvedPrice } from "./types";

/**
 * Ordering stations for a driver.
 *
 * Four orders, and the interesting one is "best value", which is not the same
 * as "cheapest": a station 12 km away saving ₪0.10 a litre costs more to reach
 * than it saves. That comparison needs the vehicle's real consumption, so when
 * we do not have one the ranking says so rather than guessing.
 *
 * Every comparison here is within ONE fuel type. A diesel price and a
 * 95-octane price are not comparable numbers, and ranking them against each
 * other would be worse than showing nothing.
 */

export type StationSort = "nearest" | "cheapest" | "freshest" | "bestValue";

export const SORT_LABELS: Record<StationSort, string> = {
  nearest: "הקרובה ביותר",
  cheapest: "הזולה ביותר",
  freshest: "המידע העדכני ביותר",
  bestValue: "המשתלמת ביותר",
};

export interface StationCandidate {
  station: CatalogStation;
  /** Metres from the driver, or null when the station cannot be placed. */
  distanceMeters: number | null;
  /** Already resolved for the ACTIVE vehicle's fuel type. */
  price: ResolvedPrice;
}

export interface RankedStation extends StationCandidate {
  /**
   * Total cost of this fill-up including the fuel spent getting there and
   * back. Null when it cannot be computed.
   */
  effectiveCost: number | null;
  /** Fuel cost of the detour alone, for explaining the ranking. */
  detourCost: number | null;
}

export interface RankingContext {
  fuelType: FuelType;
  /** The vehicle's measured consumption. Null when no segment has closed yet. */
  kmPerLiter?: number | null;
  /** Litres the driver expects to buy; only scales the comparison. */
  litersToBuy?: number;
}

/** Why "best value" is unavailable, when it is. */
export type BestValueBlocker = "no-consumption" | "no-distance" | "no-price";

export function bestValueBlocker(
  candidates: StationCandidate[],
  context: RankingContext,
): BestValueBlocker | null {
  if (!context.kmPerLiter || context.kmPerLiter <= 0) return "no-consumption";
  if (!candidates.some((entry) => entry.distanceMeters !== null)) return "no-distance";
  if (!candidates.some((entry) => entry.price.price !== null)) return "no-price";
  return null;
}

export const BEST_VALUE_UNAVAILABLE: Record<BestValueBlocker, string> = {
  "no-consumption":
    "עדיין אין נתוני צריכה לרכב, ולכן לא ניתן לחשב כמה עולה להגיע לתחנה. מיון לפי כדאיות יתאפשר אחרי שני מילויים עד מלא.",
  "no-distance": "אין מיקום זמין, ולכן לא ניתן לחשב את עלות הנסיעה לתחנה.",
  "no-price": "אין מחירים ידועים לסוג הדלק הזה, ולכן אין מה להשוות.",
};

/** Freshness and confidence as sortable ranks — higher is better. */
const FRESHNESS_RANK: Record<Freshness, number> = {
  fresh: 3,
  aging: 2,
  stale: 1,
  unknown: 0,
};

const CONFIDENCE_RANK: Record<Confidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

/** A stale or low-confidence price must be visibly marked wherever it is shown. */
export function isStale(price: ResolvedPrice): boolean {
  return price.freshness === "stale" || price.freshness === "unknown";
}

/**
 * Fuel cost of driving to a station and back.
 *
 * Round trip on purpose: a detour to a cheaper station is a there-and-back
 * decision, and counting only the outbound leg would make distant stations
 * look twice as attractive as they are. Priced at the station's own rate,
 * which is the fuel the driver is about to burn getting home on.
 */
function detourCostOf(
  distanceMeters: number | null,
  kmPerLiter: number | null | undefined,
  pricePerLiter: number | null,
): number | null {
  if (distanceMeters === null || !kmPerLiter || kmPerLiter <= 0) return null;
  if (pricePerLiter === null) return null;
  const km = (distanceMeters / 1000) * 2;
  return (km / kmPerLiter) * pricePerLiter;
}

/**
 * Rank stations.
 *
 * Candidates whose resolved price is for a different fuel type are dropped
 * outright — that is a programming error, not a display decision, and silently
 * ranking them would reintroduce exactly the cross-fuel comparison the price
 * model exists to prevent.
 *
 * Unknown prices always sort AFTER known ones, whatever the order, because
 * "we do not know" is never a recommendation.
 */
export function rankStations(
  candidates: StationCandidate[],
  sort: StationSort,
  context: RankingContext,
): RankedStation[] {
  const litersToBuy = context.litersToBuy ?? 40;

  const ranked: RankedStation[] = candidates
    .filter((entry) => entry.price.fuelType === context.fuelType)
    .map((entry) => {
      const detourCost = detourCostOf(
        entry.distanceMeters,
        context.kmPerLiter,
        entry.price.price,
      );
      const fillCost = entry.price.price === null ? null : entry.price.price * litersToBuy;
      return {
        ...entry,
        detourCost,
        effectiveCost:
          fillCost === null || detourCost === null ? null : fillCost + detourCost,
      };
    });

  const knownFirst = (a: RankedStation, b: RankedStation, key: "price" | "effective") => {
    const aKnown = key === "price" ? a.price.price !== null : a.effectiveCost !== null;
    const bKnown = key === "price" ? b.price.price !== null : b.effectiveCost !== null;
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    return 0;
  };

  const byDistance = (a: RankedStation, b: RankedStation) => {
    // A station with no coordinates cannot be placed, so it sorts last.
    if ((a.distanceMeters === null) !== (b.distanceMeters === null)) {
      return a.distanceMeters === null ? 1 : -1;
    }
    return (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0);
  };

  const sorted = [...ranked];

  switch (sort) {
    case "cheapest":
      sorted.sort((a, b) => {
        const known = knownFirst(a, b, "price");
        if (known !== 0) return known;
        if (a.price.price === null) return byDistance(a, b);
        // A regulated ceiling is not an observed price. Between two equal
        // figures, prefer the one somebody actually saw on a pump.
        if (a.price.price !== b.price.price) {
          return (a.price.price as number) - (b.price.price as number);
        }
        if (a.price.isCeiling !== b.price.isCeiling) return a.price.isCeiling ? 1 : -1;
        return byDistance(a, b);
      });
      break;

    case "freshest":
      sorted.sort((a, b) => {
        const known = knownFirst(a, b, "price");
        if (known !== 0) return known;

        const freshness =
          FRESHNESS_RANK[b.price.freshness] - FRESHNESS_RANK[a.price.freshness];
        if (freshness !== 0) return freshness;

        const confidence =
          CONFIDENCE_RANK[b.price.confidence] - CONFIDENCE_RANK[a.price.confidence];
        if (confidence !== 0) return confidence;

        // More independent reporters is a stronger signal than more reports.
        const reporters = b.price.uniqueReporters - a.price.uniqueReporters;
        if (reporters !== 0) return reporters;

        return byDistance(a, b);
      });
      break;

    case "bestValue":
      sorted.sort((a, b) => {
        const known = knownFirst(a, b, "effective");
        if (known !== 0) return known;
        if (a.effectiveCost === null) return byDistance(a, b);
        const delta = (a.effectiveCost as number) - (b.effectiveCost as number);
        if (Math.abs(delta) > 0.005) return delta;
        return byDistance(a, b);
      });
      break;

    case "nearest":
    default:
      sorted.sort(byDistance);
      break;
  }

  return sorted;
}
