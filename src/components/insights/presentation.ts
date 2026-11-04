import { consumptionComparison } from "../../lib/consumptionPresentation";
import { dayMonthShort, monthYear, num } from "../../lib/format";
import { publicPriceStationId, reusableStationName } from "../../lib/fillupPricing";
import { segmentContributors } from "../../lib/home/presentation";
import { localDay } from "../../lib/maintenance/model";
import { buildRange, inRange, RANGE_COMPACT, type DateRange, type RangeKey } from "../../lib/periods";
import { officialPriceFor, type RegulatedPriceConfig } from "../../lib/prices/regulated";
import { filterSegmentsByRange, isTankCapacityTrusted, monthKey, type Fillup, type Segment, type Stats, type Vehicle } from "../../lib/stats";
import type { LedgerRow } from "../../lib/vehicle/derived";
import { financialTotals } from "../../lib/vehicle/financial";

export type InsightTab = "cons" | "price" | "spend" | "community";
export type ConsumptionUnits = "kmPerLiter" | "litersPer100";
export type InsightPeriod = Exclude<RangeKey, "custom">;

export const INSIGHT_TABS: readonly { value: InsightTab; label: string }[] = [
  { value: "cons", label: "צריכה" }, { value: "price", label: "מחירים" },
  { value: "spend", label: "הוצאות" }, { value: "community", label: "השוואה" },
];
export const INSIGHT_PERIODS: readonly { value: InsightPeriod; label: string }[] =
  (["thisMonth", "3m", "6m", "ytd", "1y", "all"] as const)
    .map(value => ({ value, label: RANGE_COMPACT[value] }));

export function insightTab(value: string | null): InsightTab {
  if (value === "price" || value === "prices") return "price";
  if (value === "spend" || value === "costs") return "spend";
  if (value === "community") return "community";
  return "cons";
}

/** A month link names one complete local calendar month, including its last day. */
export function insightRange(params: Pick<URLSearchParams, "get">, now: number) {
  const requestedMonth = params.get("month");
  const month = requestedMonth && /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : null;
  const requestedPeriod = params.get("period");
  const period = INSIGHT_PERIODS.find(option => option.value === requestedPeriod)?.value ?? "6m";
  let range: DateRange;
  if (month) {
    const [year, number] = month.split("-").map(Number);
    range = { ...buildRange("custom", now, {
      from: +new Date(year, number - 1, 1), to: +new Date(year, number, 0),
    }), label: monthYear(month), compactLabel: monthYear(month) };
  } else range = buildRange(period, now);
  return {
    range, month, period, value: month ? "selected-month" : period,
    fromDay: range.from === null ? "1900-01-01" : localDay(new Date(range.from)),
    toDay: localDay(new Date(range.to ?? now)),
  };
}

export function journalRangeLink(kind: "fuel" | "service" | "expense" | "all", from: string, to: string) {
  const query = new URLSearchParams({ from, to });
  if (kind !== "all") query.set("kind", kind);
  return `/history?${query}`;
}

export function consumptionNumber(kmPerLiter: number, units: ConsumptionUnits) {
  return units === "litersPer100" ? 100 / kmPerLiter : kmPerLiter;
}

/** The benchmark's endpoints are km/L; reciprocal units reverse their order. */
export function consumptionRangeLabel(from: number, to: number, units: ConsumptionUnits) {
  if (![from, to].every(value => Number.isFinite(value) && value > 0)) return "—";
  const bounds = [consumptionNumber(from, units), consumptionNumber(to, units)].sort((a, b) => a - b);
  const lower = num(bounds[0], 1), upper = num(bounds[1], 1);
  return lower === upper ? lower : lower + "–" + upper;
}

/** This is a projection of canonical segments, never another consumption engine. */
export function consumptionSummary(stats: Stats, range: DateRange) {
  const segments = filterSegmentsByRange(stats.segments, range.from, range.to);
  const km = segments.reduce((sum, segment) => sum + segment.km, 0);
  const liters = segments.reduce((sum, segment) => sum + segment.liters, 0);
  const cost = segments.reduce((sum, segment) => sum + segment.cost, 0);
  const costKnown = segments.length > 0 && segments.every(segment => segmentContributors(segment, stats.fillups).costKnown);
  const average = liters > 0 ? km / liters : null;
  const ordered = [...segments].sort((a, b) => a.endDate - b.endDate);
  const last = ordered.at(-1) ?? null;
  const best = segments.reduce<Segment | null>((result, segment) => !result || segment.kmPerLiter > result.kmPerLiter ? segment : result, null);
  const worst = segments.reduce<Segment | null>((result, segment) => !result || segment.kmPerLiter < result.kmPerLiter ? segment : result, null);
  return { segments, ordered, km, liters, cost, costKnown, average, last, best, worst,
    costPerKm: costKnown && km > 0 ? cost / km : null,
    lastTone: consumptionComparison(last?.kmPerLiter ?? null, average)?.tone ?? "neutral",
  };
}
export type ConsumptionSummary = ReturnType<typeof consumptionSummary>;

function islandIdentities(stats: Stats) {
  return new Map(stats.islands.flatMap((island, index) => island.map(fill => [fill.id, index] as const)));
}

export interface ConsumptionPoint {
  key: string; label: string; endId: string | null; value: number | null; island: number;
}
export function consumptionPoints(summary: ConsumptionSummary, stats: Stats, units: ConsumptionUnits): ConsumptionPoint[] {
  const identities = islandIdentities(stats);
  const rows: ConsumptionPoint[] = [];
  for (const segment of summary.ordered) {
    const island = identities.get(segment.endId) ?? -1;
    if (rows.length && rows.at(-1)!.island !== island) {
      rows.push({ key: `gap:${segment.endId}`, label: "", endId: null, value: null, island });
    }
    rows.push({ key: segment.endId, endId: segment.endId, label: dayMonthShort(segment.endDate), island,
      value: consumptionNumber(segment.kmPerLiter, units) });
  }
  return rows;
}

export function knownFillCost(fill: Fillup) {
  return !fill.totalCostUnknown && Number.isFinite(fill.totalCost) && fill.totalCost >= 0;
}
export type ReferenceKind = "regulated" | "manual" | "reference";
export const REFERENCE_LABELS: Record<ReferenceKind, string> = {
  regulated: "מחיר מרבי מפוקח", manual: "מחיר שהוזן ידנית", reference: "מחיר להשוואה",
};
export interface PricePoint {
  key: string; fillId: string | null; date: number; label: string; paid: number | null;
  official: number | null; referenceKind: ReferenceKind | null; referenceLabel: string;
  liters: number; island: number;
}
export interface StationPriceRow {
  key: string; name: string; count: number; knownCount: number; unknown: number;
  liters: number; cost: number; average: number;
}

/** Recorded amounts and their own fuel/month evidence; no station quotes or guessed prices. */
export function priceSummary(stats: Stats, vehicle: Vehicle | null, prices: RegulatedPriceConfig | null, range: DateRange) {
  const fuel = vehicle?.fuelType ?? "95";
  const selected = stats.fillups.filter(fill => inRange(fill.date, range));
  const fills = selected.filter(fill => (fill.fuelType ?? fuel) === fuel).sort((a, b) => a.date - b.date);
  const identities = islandIdentities(stats);
  const points: PricePoint[] = fills.map(fill => {
    const lookup = officialPriceFor(prices, fill.fuelType ?? fuel, fill.date);
    const paid = knownFillCost(fill) && fill.liters > 0 ? fill.totalCost / fill.liters : null;
    // A carried current price from another month is not evidence about this receipt.
    const dated = lookup.fromHistory || lookup.effectiveMonth === monthKey(fill.date);
    const official = dated && lookup.price !== null && Number.isFinite(lookup.price) && lookup.price > 0 ? lookup.price : null;
    const referenceKind: ReferenceKind | null = official === null ? null : lookup.isRegulated ? "regulated" : lookup.isManual ? "manual" : "reference";
    return { key: fill.id, fillId: fill.id, date: fill.date, label: dayMonthShort(fill.date), paid, official,
      referenceKind, referenceLabel: referenceKind ? REFERENCE_LABELS[referenceKind] : "אין מחיר להשוואה לתאריך הזה",
      liters: fill.liters, island: identities.get(fill.id) ?? -1 };
  });
  const known = points.filter(point => point.paid !== null);
  const liters = known.reduce((sum, point) => sum + point.liters, 0);
  const average = liters > 0 ? known.reduce((sum, point) => sum + point.paid! * point.liters, 0) / liters : null;
  const compared = known.filter(point => point.official !== null);
  const comparedLiters = compared.reduce((sum, point) => sum + point.liters, 0);
  const difference = comparedLiters > 0
    ? compared.reduce((sum, point) => sum + (point.paid! - point.official!) * point.liters, 0) / comparedLiters : null;
  const kinds = [...new Set(points.flatMap(point => point.referenceKind ? [point.referenceKind] : []))];
  const stationMap = new Map<string, Omit<StationPriceRow, "average">>();
  for (const fill of fills) {
    const name = fill.station?.name?.trim();
    if (!name) continue;
    const stationId = publicPriceStationId(fill.station);
    const reusableName = reusableStationName(name);
    if (!stationId && !reusableName) continue;
    const key = stationId ? `id:${stationId}` : `name:${reusableName}`;
    const row = stationMap.get(key) ?? { key, name, count: 0, knownCount: 0, unknown: 0, liters: 0, cost: 0 };
    row.name = name;
    row.count += 1;
    if (knownFillCost(fill) && fill.liters > 0) {
      row.knownCount += 1; row.liters += fill.liters; row.cost += fill.totalCost;
    } else row.unknown += 1;
    stationMap.set(key, row);
  }
  const stations: StationPriceRow[] = [...stationMap.values()].filter(row => row.knownCount > 0 && row.liters > 0)
    .map(row => ({ ...row, average: row.cost / row.liters }))
    .sort((a, b) => a.average - b.average || a.name.localeCompare(b.name, "he-IL"));
  const spread = stations.length > 1 ? stations.at(-1)!.average - stations[0].average : null;
  const plot: PricePoint[] = [];
  for (const point of points) {
    if (plot.length && plot.at(-1)!.island !== point.island) {
      plot.push({ ...point, key: `gap:${point.key}`, fillId: null, label: "", paid: null, official: null });
    }
    plot.push(point);
  }
  const mostExpensive = fills.filter(knownFillCost).reduce<Fillup | null>((result, fill) => !result || fill.totalCost > result.totalCost ? fill : result, null);
  return { fills, points, plot, average, difference, comparedCount: compared.length, kinds, stations, spread,
    knownCount: known.length, unknown: fills.length - known.length, otherFuelCount: selected.length - fills.length,
    tankSpread: spread !== null && isTankCapacityTrusted(vehicle) ? spread * vehicle!.tankLiters! : null,
    mostExpensive,
  };
}
export type PriceSummary = ReturnType<typeof priceSummary>;

/** A missing amount stays unknown even when the known subtotal happens to be zero. */
export function knownLedgerAmount(rows: readonly LedgerRow[]): number | null {
  const financial = rows.filter(row => row.financial);
  const known = financial.filter(row => row.amountAgorot !== null);
  return financial.length > 0 && known.length === 0 ? null : known.reduce((sum, row) => sum + row.amountAgorot!, 0);
}

export interface LedgerMonth {
  key: string; label: string; fuel: number | null; service: number | null; other: number | null;
  refunds: number | null; total: number | null; unknown: number; count: number;
}

function refundRow(row: LedgerRow) {
  return row.kind === "expense" && ((row.amountAgorot ?? 0) < 0 || "category" in row.record && row.record.category === "refund");
}

export function spendingSummary(ledger: readonly LedgerRow[], from: string, to: string) {
  const rows = ledger.filter(row => row.financial && row.day >= from && row.day <= to);
  const totals = financialTotals(rows);
  const fuel = rows.filter(row => row.kind === "fuel");
  const service = rows.filter(row => row.kind === "service");
  const expense = rows.filter(row => row.kind === "expense");
  const start = from === "1900-01-01" ? rows.map(row => row.day).sort()[0] : from;
  const months: LedgerMonth[] = [];
  if (start && start <= to) {
    const [year, month] = start.split("-").map(Number);
    const cursor = new Date(year, month - 1, 1);
    while (monthKey(+cursor) <= to.slice(0, 7)) {
      const key = monthKey(+cursor);
      const monthly = rows.filter(row => row.day.startsWith(key));
      const amounts = financialTotals(monthly);
      const sum = (kind: LedgerRow["kind"], positiveOnly = false) => {
        const selected = monthly.filter(row => row.kind === kind && (!positiveOnly || !refundRow(row)));
        const amount = knownLedgerAmount(selected);
        return amount === null ? null : amount / 100;
      };
      const total = knownLedgerAmount(monthly);
      const refunds = knownLedgerAmount(monthly.filter(refundRow));
      months.push({ key, label: monthYear(key), fuel: sum("fuel"), service: sum("service"), other: sum("expense", true),
        refunds: refunds === null ? null : refunds / 100, total: total === null ? null : total / 100,
        unknown: amounts.unknown, count: monthly.length });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  return { rows, totals, months, amount: knownLedgerAmount(rows),
    fuelAmount: knownLedgerAmount(fuel), serviceAmount: knownLedgerAmount(service), expenseAmount: knownLedgerAmount(expense),
    fuelCount: fuel.length, serviceCount: service.length, expenseCount: expense.length };
}
export type SpendingSummary = ReturnType<typeof spendingSummary>;

/** Odometer observations retain their values on both sides of a declared gap. */
export function odometerPoints(stats: Stats, range: DateRange) {
  const identities = islandIdentities(stats);
  const rows: { key: string; label: string; odometer: number | null; island: number }[] = [];
  for (const fill of [...stats.fillups].filter(fill => inRange(fill.date, range)).sort((a, b) => a.date - b.date)) {
    const island = identities.get(fill.id) ?? -1;
    if (rows.length && rows.at(-1)!.island !== island) rows.push({ key: `gap:${fill.id}`, label: "", odometer: null, island });
    rows.push({ key: fill.id, label: dayMonthShort(fill.date), odometer: fill.odometer, island });
  }
  return rows;
}
