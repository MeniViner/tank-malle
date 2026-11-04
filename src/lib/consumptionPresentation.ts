/** Presentation verdicts use fuel burned per kilometre in either display unit. */
export type ConsumptionTone = "better" | "worse" | "neutral";

export function consumptionComparison(latest: number | null, average: number | null) {
  if (latest === null || average === null || !Number.isFinite(latest) || !Number.isFinite(average) || latest <= 0 || average <= 0) return null;
  const change = average / latest - 1;
  const tone: ConsumptionTone = change > .03 ? "worse" : change < -.03 ? "better" : "neutral";
  return { tone, percent: Math.round(Math.abs(change) * 100) };
}
