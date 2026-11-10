import { consumptionComparison } from "../../lib/consumptionPresentation";
import { consumption } from "../../lib/format";
import { NumRun, Percent } from "../Fmt";

/** v3 §2.6: the comparison reads as coloured text, not a pill. Tone and wording are unchanged. */
export function ConsumptionComparison({ latest, average, units }: {
  latest: number | null; average: number | null; units: "kmPerLiter" | "litersPer100";
}) {
  const comparison = consumptionComparison(latest, average);
  if (!comparison) return null;
  const shown = consumption(average, units);
  return <span className={`home-comparison home-comparison-${comparison.tone}`} data-testid="consumption-comparison" data-tone={comparison.tone}>
    {comparison.tone === "neutral" ? "בדיוק כמו הרגיל שלך" : <>
      <Percent value={comparison.percent} /> {comparison.tone === "worse" ? "יותר" : "פחות"} דלק לק״מ מהרגיל שלך (<NumRun>{shown.value}</NumRun>)
    </>}
  </span>;
}
