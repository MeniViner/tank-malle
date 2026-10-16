import { useId } from "react";
import type { Segment } from "../lib/stats";
import { consumption, dayMonthShort, num } from "../lib/format";

/** Each column is a measured interval. Dates and the average share its scale. */
export function HeroSpark({ segments, units = "kmPerLiter", average }: {
  segments: Segment[];
  units?: "kmPerLiter" | "litersPer100";
  average?: number | null;
}) {
  const titleId = useId();
  let start = segments.length - 1;
  while (start > 0 && segments[start].startId === segments[start - 1].endId) start -= 1;
  const recent = segments.slice(Math.max(0, start, segments.length - 6));
  if (!recent.length) return null;
  const weighted = average ?? recent.reduce((sum, s) => sum + s.km, 0) / recent.reduce((sum, s) => sum + s.liters, 0);
  const convert = (value: number) => units === "litersPer100" ? 100 / value : value;
  const values = recent.map(s => convert(s.kmPerLiter));
  const avg = Number.isFinite(weighted) && weighted > 0 ? convert(weighted) : null;
  const max = Math.max(...values, avg ?? 0) * 1.22;
  const width = 320, baseline = 88, chartHeight = 76, slot = width / recent.length;
  const barWidth = Math.min(38, slot * .58);
  const y = (value: number) => baseline - value / max * chartHeight;
  const averageLabel = consumption(Number.isFinite(weighted) ? weighted : null, units);
  return <figure className="tm-consumption-chart" data-testid="consumption-chart">
    <svg viewBox="0 0 320 96" preserveAspectRatio="none" role="img" aria-labelledby={titleId}>
      <title id={titleId}>{recent.map((s, i) => `${dayMonthShort(s.endDate)}: ${num(values[i], 1)} ${averageLabel.unit}`).join("; ")}</title>
      <line x1="0" x2={width} y1={baseline} y2={baseline} stroke="var(--hairline)" />
      {recent.map((segment, i) => <rect key={segment.endId} data-segment={segment.endId}
        x={width - slot * (i + .5) - barWidth / 2} y={y(values[i])}
        width={barWidth} height={baseline - y(values[i])} rx="4"
        fill={i === recent.length - 1 ? (segment.kmPerLiter < weighted * .97 ? "var(--danger)" : "var(--accent)") : "color-mix(in srgb, var(--accent) 22%, var(--surface))"} />)}
      {avg !== null ? <line data-testid="consumption-average" x1="0" x2={width} y1={y(avg)} y2={y(avg)} stroke="var(--muted)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" /> : null}
    </svg>
    <div className="tm-chart-dates" style={{ gridTemplateColumns: `repeat(${recent.length}, minmax(0, 1fr))` }}>
      {recent.map(s => <span key={s.endId}>{dayMonthShort(s.endDate)}</span>)}
    </div>
    <figcaption>כל עמודה היא מקטע בין תדלוקים מלאים.{avg !== null ? <> הקו המקווקו הוא הממוצע שלכם.</> : null}</figcaption>
  </figure>;
}
