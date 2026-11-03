import { computeStats, evaluateDraft, type Fillup, type FuelPrices, type Vehicle } from "../../lib/stats";
import { segmentContributors } from "../../lib/home/presentation";
import type { SavedFillupResult } from "./FillupSaved";

/** A save result belongs to the history and record actually submitted, not a later listener. */
export function savedFillupResult(written: Readonly<Fillup>, history: readonly Fillup[], vehicle: Vehicle,
  prices: FuelPrices | null, historyComplete: boolean): SavedFillupResult {
  const evaluation = evaluateDraft({ ...written, fillEndState: written.fillEndState ?? undefined }, [...history]);
  const canonical = computeStats([...history, { ...written }], vehicle, prices);
  const segment = canonical.segments.find(item => item.endId === written.id) ?? null;
  const previous = canonical.segments.filter(item => item.endId !== written.id);
  const declared = vehicle.declaredKmPerLiter;
  const manufacturer = typeof declared === "number" && Number.isFinite(declared) && declared > 0 ? declared : null;
  const manufacturerLabel = vehicle.declaredSource === "user" ? "הנתון שהזנתם"
    : vehicle.declaredSource === "exact-year" ? "נתון היצרן"
      : vehicle.declaredSource === "other-year" ? "נתון משנה אחרת"
        : vehicle.declaredSource === "co2-estimate" ? "הערכת צריכה" : "נתון לייחוס";
  return {
    written, evaluation, segment, average: canonical.avgKmPerLiter, manufacturer, manufacturerLabel,
    personalBest: historyComplete && segment !== null && canonical.segments.length >= 3 &&
      !evaluation.consumptionWarning && previous.every(item => segment.kmPerLiter > item.kmPerLiter),
    costKnown: segment !== null && segmentContributors(segment, canonical.fillups).costKnown,
    historyComplete,
  };
}
