import type { FuelType } from "../stats";
import {
  REGULATED_LABEL,
  regulatedMaxPrice,
  type RegulatedPriceConfig,
} from "./regulated";
import {
  DEFAULT_FRESHNESS,
  MIN_REPORTERS_FOR_HIGH_CONFIDENCE,
  isPlausiblePrice,
  type Confidence,
  type Freshness,
  type FreshnessPolicy,
  type PersonalPriceRule,
  type ResolvedPrice,
  type ServiceMode,
  type StationPriceAggregate,
} from "./types";

/**
 * The ONE station-price resolver.
 *
 * Station search, nearby stations, the fill-up form, station details,
 * statistics and price comparisons all call this. Letting each screen pick its
 * own fallback is how a 95 figure ends up on a diesel card in one place and
 * "unknown" in another.
 *
 * Two rules govern everything below:
 *
 *   1. Sources are never blended. One source wins, and the result says which.
 *   2. Fuel type is part of the key, never a fallback. If nothing is known for
 *      the requested fuel type, the answer is null.
 */

export interface ResolverInputs {
  stationId: string | null;
  fuelType: FuelType;
  serviceMode?: ServiceMode;
  /** Backend-produced aggregates, keyed however the caller holds them. */
  aggregates?: StationPriceAggregate[];
  /** A single unverified report, when that is all there is. */
  singleReport?: {
    price: number;
    observedAt: number;
    stationId: string;
    fuelType: FuelType;
    serviceMode?: ServiceMode;
  } | null;
  /** An external provider's figure. Only present when one is configured. */
  externalPrice?: {
    price: number;
    observedAt: number;
    providerName: string;
  } | null;
  regulated?: RegulatedPriceConfig | null;
  now?: number;
  policy?: FreshnessPolicy;
}

function freshnessOf(
  observedAt: number,
  now: number,
  freshMs: number,
  staleMs: number,
): Freshness {
  const age = now - observedAt;
  if (age < 0) return "unknown";
  if (age <= freshMs) return "fresh";
  if (age <= staleMs) return "aging";
  return "stale";
}

function ageText(observedAt: number, now: number): string {
  const minutes = Math.round((now - observedAt) / 60_000);
  if (minutes < 1) return "עודכן זה עתה";
  if (minutes < 60) return `אומת לפני ${minutes} דקות`;

  // Hebrew has a dual form. "לפני 2 שעות" is what a machine writes.
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    if (hours === 1) return "אומת לפני שעה";
    if (hours === 2) return "אומת לפני שעתיים";
    return `אומת לפני ${hours} שעות`;
  }

  const days = Math.round(hours / 24);
  if (days === 1) return "אומת אתמול";
  if (days === 2) return "אומת לפני יומיים";
  if (days < 30) return `אומת לפני ${days} ימים`;

  const months = Math.round(days / 30.44);
  if (months <= 1) return "אומת לפני חודש";
  if (months === 2) return "אומת לפני חודשיים";
  return `אומת לפני ${months} חודשים`;
}

function unknown(
  stationId: string | null,
  fuelType: FuelType,
  serviceMode: ServiceMode | null,
  explanation: string,
): ResolvedPrice {
  return {
    stationId,
    fuelType,
    serviceMode,
    price: null,
    source: "unknown",
    observedAt: null,
    freshness: "unknown",
    confidence: "none",
    reportCount: 0,
    uniqueReporters: 0,
    isCeiling: false,
    explanation,
  };
}

/** Confidence from reporter count, spread and age. Never from a single report. */
function aggregateConfidence(
  aggregate: StationPriceAggregate,
  freshness: Freshness,
): Confidence {
  if (aggregate.moderation === "suppressed") return "none";
  if (freshness === "stale") return "low";

  const enoughReporters =
    aggregate.uniqueReporters >= MIN_REPORTERS_FOR_HIGH_CONFIDENCE;
  // A wide spread means the reporters disagree, whatever their number.
  const tightSpread = aggregate.spread <= 0.15;

  if (freshness === "fresh" && enoughReporters && tightSpread) return "high";
  if (enoughReporters || (freshness === "fresh" && tightSpread)) return "medium";
  return "low";
}

/**
 * Resolve the best known price for one station and fuel type.
 *
 * Precedence, highest first:
 *   1. fresh high-confidence community aggregate
 *   2. fresh configured external provider
 *   3. fresh single community report, marked low confidence
 *   4. an older trusted source, marked stale
 *   5. the regulated maximum — only for the exact fuel type it covers
 *   6. unknown
 */
export function resolveStationPrice(inputs: ResolverInputs): ResolvedPrice {
  const {
    stationId,
    fuelType,
    serviceMode = "self",
    aggregates = [],
    singleReport = null,
    externalPrice = null,
    regulated = null,
    now = Date.now(),
    policy = DEFAULT_FRESHNESS,
  } = inputs;

  // Fuel type and service mode are part of the key. An aggregate for another
  // fuel type at the same station tells us nothing about this one.
  const aggregate =
    aggregates.find(
      (entry) =>
        entry.stationId === stationId &&
        entry.fuelType === fuelType &&
        entry.serviceMode === serviceMode &&
        entry.moderation !== "suppressed" &&
        isPlausiblePrice(fuelType, entry.medianPrice),
    ) ?? null;

  const aggregateFreshness = aggregate
    ? freshnessOf(
        aggregate.lastVerifiedAt,
        now,
        policy.communityFreshMs,
        policy.communityStaleMs,
      )
    : "unknown";
  const aggregateConf = aggregate
    ? aggregateConfidence(aggregate, aggregateFreshness)
    : "none";

  /* 1. Fresh, corroborated community aggregate. */
  if (aggregate && aggregateFreshness === "fresh" && aggregateConf === "high") {
    return {
      stationId,
      fuelType,
      serviceMode,
      price: aggregate.medianPrice,
      source: "station-posted-aggregate",
      observedAt: aggregate.lastVerifiedAt,
      freshness: aggregateFreshness,
      confidence: aggregateConf,
      reportCount: aggregate.acceptedReports,
      uniqueReporters: aggregate.uniqueReporters,
      isCeiling: false,
      explanation: `${ageText(aggregate.lastVerifiedAt, now)} · ${aggregate.acceptedReports} דיווחים`,
    };
  }

  /* 2. A configured external provider, while fresh. */
  if (externalPrice && isPlausiblePrice(fuelType, externalPrice.price)) {
    const freshness = freshnessOf(
      externalPrice.observedAt,
      now,
      policy.externalFreshMs,
      policy.externalStaleMs,
    );
    if (freshness === "fresh") {
      return {
        stationId,
        fuelType,
        serviceMode,
        price: externalPrice.price,
        source: "external-provider",
        observedAt: externalPrice.observedAt,
        freshness,
        confidence: "medium",
        reportCount: 0,
        uniqueReporters: 0,
        isCeiling: false,
        explanation: `${ageText(externalPrice.observedAt, now)} · ${externalPrice.providerName}`,
      };
    }
  }

  /* 3. A single fresh report. Useful, but explicitly uncorroborated. */
  if (
    singleReport &&
    singleReport.stationId === stationId &&
    singleReport.fuelType === fuelType &&
    (singleReport.serviceMode ?? "self") === serviceMode &&
    isPlausiblePrice(fuelType, singleReport.price)
  ) {
    const freshness = freshnessOf(
      singleReport.observedAt,
      now,
      policy.communityFreshMs,
      policy.communityStaleMs,
    );
    if (freshness === "fresh") {
      return {
        stationId,
        fuelType,
        serviceMode,
        price: singleReport.price,
        source: "station-posted-single",
        observedAt: singleReport.observedAt,
        freshness,
        confidence: "low",
        reportCount: 1,
        uniqueReporters: 1,
        isCeiling: false,
        explanation: `${ageText(singleReport.observedAt, now)} · דיווח יחיד, לא אומת`,
      };
    }
  }

  /* 4. An older community figure, clearly marked stale. */
  if (aggregate && aggregateFreshness !== "unknown") {
    return {
      stationId,
      fuelType,
      serviceMode,
      price: aggregate.medianPrice,
      source: "station-posted-aggregate",
      observedAt: aggregate.lastVerifiedAt,
      freshness: aggregateFreshness,
      confidence: aggregateConf === "high" ? "medium" : aggregateConf,
      reportCount: aggregate.acceptedReports,
      uniqueReporters: aggregate.uniqueReporters,
      isCeiling: false,
      explanation: `${ageText(aggregate.lastVerifiedAt, now)} · ייתכן שהמחיר השתנה`,
    };
  }

  /* 5. The regulated maximum — for the exact fuel type it covers, and no other.
        This is a CEILING. It is rendered as "עד ₪X", never as the price. */
  const ceiling = regulatedMaxPrice(regulated, fuelType, now, serviceMode);
  if (ceiling.price !== null) {
    const freshness = ceiling.updatedAt
      ? freshnessOf(
          ceiling.updatedAt,
          now,
          policy.regulatedFreshMs,
          policy.regulatedStaleMs,
        )
      : "unknown";
    return {
      stationId,
      fuelType,
      serviceMode,
      price: ceiling.price,
      source: "regulated-max",
      observedAt: ceiling.updatedAt,
      freshness,
      confidence: "medium",
      reportCount: 0,
      uniqueReporters: 0,
      isCeiling: true,
      explanation: `${REGULATED_LABEL} · אין דיווח עדכני מהתחנה`,
    };
  }

  /* 6. Nothing trustworthy. Say so. */
  return unknown(
    stationId,
    fuelType,
    serviceMode,
    fuelType === "diesel"
      ? "מחיר סולר לא ידוע"
      : fuelType === "98"
        ? "מחיר בנזין 98 לא ידוע"
        : "מחיר לא ידוע",
  );
}

/**
 * Apply a personal rule on top of a resolved price.
 *
 * The rule must match the station and the fuel type, and must not have
 * expired. A legacy rule carried over from the old vehicle-wide override is
 * NOT applied until the user has reviewed it — the whole point is that an
 * invisible permanent discount stops being invisible.
 */
export function applyPersonalRule(
  resolved: ResolvedPrice,
  rules: PersonalPriceRule[],
  now: number = Date.now(),
): { price: number | null; rule: PersonalPriceRule | null } {
  if (resolved.price === null) return { price: null, rule: null };

  const match = rules.find((rule) => {
    if (rule.legacy && !rule.reviewed) return false;
    if (rule.expiresAt != null && rule.expiresAt < now) return false;
    if (rule.stationId !== null && rule.stationId !== resolved.stationId) return false;
    if (rule.fuelType !== null && rule.fuelType !== resolved.fuelType) return false;
    return true;
  });

  if (!match) return { price: resolved.price, rule: null };
  return {
    price: Math.max(0, Math.round((resolved.price - match.discountPerLiter) * 1000) / 1000),
    rule: match,
  };
}

/**
 * What a STATION ROW should show.
 *
 * The regulated maximum is a nationwide ceiling, identical for every station
 * and unchanged for a month. Printing it on every row — "עד ₪8.25 · מחיר מרבי
 * מפוקח · אין דיווח עדכני מהתחנה", over and over — is not a station price and
 * makes the list unreadable. So it is deliberately NOT shown here; it stays an
 * internal reference for plausibility checks and ranking.
 *
 * What a row may show, in order:
 *   1. a real station-specific figure, with its source and age;
 *   2. what this driver themselves last paid here, labelled as exactly that;
 *   3. nothing but a compact "מחיר לא זמין".
 */
export interface StationPriceView {
  /** Rendered amount, or "" when there is nothing station-specific to show. */
  text: string;
  /** One short line of provenance. Never omitted when a number is shown. */
  detail: string;
  kind: "station" | "personal" | "none";
  /** A figure old enough that it may have moved. Marked, never hidden. */
  stale: boolean;
}

function money(value: number): string {
  return `₪${value.toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function stationPriceView(
  resolved: ResolvedPrice,
  /** What this user last paid at this station, from their own history. */
  personal?: { price: number; observedAt: number } | null,
  now: number = Date.now(),
): StationPriceView {
  if (resolved.price !== null && !resolved.isCeiling) {
    return {
      text: money(resolved.price),
      detail: resolved.explanation,
      kind: "station",
      stale: resolved.freshness === "stale" || resolved.freshness === "unknown",
    };
  }

  if (personal && personal.price > 0) {
    return {
      text: "",
      // Explicitly the driver's own price, not the station's current one.
      detail: `שילמת כאן לאחרונה ${money(personal.price)} · ${ageText(personal.observedAt, now)}`,
      kind: "personal",
      stale: false,
    };
  }

  return { text: "", detail: "מחיר לא זמין", kind: "none", stale: false };
}

/**
 * How a resolved price should be worded where the ceiling IS the subject.
 *
 * A ceiling reads "עד ₪7.31", an observation reads "₪7.18", and an unknown
 * reads as an unknown. This is the single place that decision is made.
 */
export function priceDisplay(resolved: ResolvedPrice): {
  text: string;
  detail: string;
} {
  if (resolved.price === null) {
    return { text: "—", detail: resolved.explanation };
  }
  const amount = `₪${resolved.price.toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return {
    text: resolved.isCeiling ? `עד ${amount}` : `${amount} לליטר`,
    detail: resolved.explanation,
  };
}
