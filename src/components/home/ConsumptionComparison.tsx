import { consumptionComparison } from "../../lib/consumptionPresentation";
import { consumption } from "../../lib/format";
import { Pill } from "../DesignPrimitives";
import { NumRun, Percent } from "../Fmt";

export function ConsumptionComparison({ latest, average, units }: {
  latest: number | null; average: number | null; units: "kmPerLiter" | "litersPer100";
}) {
  const comparison = consumptionComparison(latest, average);
  if (!comparison) return null;
  const shown = consumption(average, units);
  return <span data-testid="consumption-comparison" data-tone={comparison.tone}>
    <Pill tone={comparison.tone} className="home-comparison-pill">
      {comparison.tone === "neutral" ? "בדיוק כמו הרגיל שלך" : <span>
        <Percent value={comparison.percent} /> {comparison.tone === "worse" ? "יותר" : "פחות"} דלק לק״מ מהרגיל שלך (<NumRun>{shown.value}</NumRun>)
      </span>}
    </Pill>
  </span>;
}
