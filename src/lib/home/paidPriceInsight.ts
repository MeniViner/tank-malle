import { price, shekel } from "../format";
import { adaptLegacyConfig, officialPriceFor, type RegulatedPriceConfig } from "../prices/regulated";
import type { Fillup, Vehicle } from "../stats";
import type { SpotlightItem } from "./spotlight";

const DAY = 86_400_000;
const israelMonth = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit",
});

function monthAt(at: number): string {
  const parts = israelMonth.formatToParts(at);
  return `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}`;
}

/**
 * An unknown location is not evidence of mainland pricing. This deliberately
 * conservative area excludes Eilat and the far south, without pretending to
 * encode a tax-zone boundary. Missing coordinates simply produce no insight.
 */
function hasMainlandLocation(fillup: Fillup): boolean {
  const { lat, lng, name } = fillup.station ?? {};
  return typeof lat === "number" && Number.isFinite(lat) && lat >= 30 && lat <= 33.5
    && typeof lng === "number" && Number.isFinite(lng) && lng >= 34 && lng <= 36
    && !/אילת|eilat/i.test(name ?? "");
}

/** A later intramonth replacement cannot prove the price on an earlier day. */
function exactBenchmark(prices: RegulatedPriceConfig | null, date: number): number | null {
  const config = adaptLegacyConfig(prices);
  if (config.region && config.region !== "mainland") return null;
  const series = config.byFuelType?.["95"]?.self;
  if (!series) return null;
  const month = monthAt(date);
  const dates = Object.entries(series.timeline ?? {})
    .filter(([at, amount]) => Number.isFinite(Number(at)) && Number.isFinite(amount) && amount > 0)
    .map(([at]) => Number(at));
  if (Number.isFinite(series.current?.effectiveFrom) && (series.current?.pricePerLiter ?? 0) > 0) {
    dates.push(series.current!.effectiveFrom!);
  }
  const thisMonth = dates.filter(at => monthAt(at) === month);
  if (thisMonth.some(at => at > date) && !thisMonth.some(at => at <= date)) return null;
  const reference = officialPriceFor(config, "95", date);
  return reference.isRegulated && !reference.isManual && reference.fromHistory
    && reference.effectiveMonth === month && reference.price !== null
    && Number.isFinite(reference.price) && reference.price > 0 ? reference.price : null;
}

export interface PaidPriceInsightInput {
  now: number;
  ownerId: string | null;
  vehicle: Vehicle | null;
  /** Already scoped to this owner and vehicle by DataContext. */
  fillups: readonly Fillup[];
  prices: RegulatedPriceConfig | null;
  historyComplete?: boolean;
}

/**
 * An observed receipt comparison, not a prediction of future savings. Only
 * the latest recent fill-up is eligible, so a later non-saving fill-up cannot
 * leave an older success presented as the latest one.
 */
export function paidPriceSpotlight(input: PaidPriceInsightInput): SpotlightItem | null {
  const { now, ownerId, vehicle, fillups, prices } = input;
  if (!vehicle || !ownerId || input.historyComplete === false || !Number.isFinite(now)
      || !fillups.length || fillups.some(fillup => !Number.isFinite(fillup.date))) return null;
  const fillup = fillups.reduce((latest, candidate) => candidate.date > latest.date
    || candidate.date === latest.date && candidate.id > latest.id ? candidate : latest);
  if (now < fillup.date || now - fillup.date > 7 * DAY || (fillup.fuelType ?? vehicle.fuelType) !== "95"
      || fillup.totalCostUnknown || !Number.isFinite(fillup.totalCost) || fillup.totalCost <= 0
      || !Number.isFinite(fillup.liters) || fillup.liters <= 0 || !hasMainlandLocation(fillup)) return null;
  const benchmark = exactBenchmark(prices, fillup.date);
  if (benchmark === null) return null;
  // The editable price suggestion may disagree with the receipt. The actual
  // amount and volume are authoritative; neither value is rounded here.
  const paidPerLiter = fillup.totalCost / fillup.liters;
  const difference = benchmark * fillup.liters - fillup.totalCost;
  if (!Number.isFinite(difference) || benchmark - paidPerLiter < .01 - 1e-9 || difference < 1 - 1e-9) return null;
  const query = new URLSearchParams({ entry: `fillups/${fillup.id}`, owner: ownerId, vehicle: vehicle.id });
  return {
    id: `paid:${fillup.id}:${fillup.totalCost}:${fillup.liters}:${benchmark}`,
    tone: "better", icon: "coin",
    title: `שילמת כ-${shekel(difference)} פחות בתדלוק האחרון`,
    body: `${price(paidPerLiter)} לליטר, לעומת ${price(benchmark)} — המחיר המרבי לבנזין 95 בשירות עצמי מחוץ לאילת ביום התדלוק.`,
    target: { kind: "route", to: `/history?${query}` },
  };
}
