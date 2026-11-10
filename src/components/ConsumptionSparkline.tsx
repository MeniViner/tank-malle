import { useId } from "react";
import { dayMonthShort, heMonthShort, int, num, UNITS } from "../lib/format";
import type { Segment } from "../lib/stats";
import { NumRun } from "./Fmt";

import { HOME_FRAME, WIDTH, consumptionSparklineModel, type ConsumptionUnits } from "./consumptionSparklineModel";

export interface ConsumptionSparklineProps {
  segments: Segment[];
  units: ConsumptionUnits;
  average: number | null;
  onSelect: (segment: Segment) => void;
  className?: string;
  /**
   * "home" is the quieter v3 Home chart (§2.6): a shorter plot, values above
   * every point, dates only at the two ends, no legend, and a caption split
   * to both ends ("6 תדלוקים אחרונים" / "הרגיל שלך 12.0"). Points, band,
   * last-six rule and unit conversion are identical in both variants.
   */
  variant?: "full" | "home";
}

export function ConsumptionSparkline({ segments, units, average, onSelect, className = "", variant = "full" }: ConsumptionSparklineProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const gradientId = `${id}-area`;
  const home = variant === "home";
  const model = home ? consumptionSparklineModel(segments, units, average, HOME_FRAME) : consumptionSparklineModel(segments, units, average);
  if (!model.points.length) return null;
  const { height, baseline } = model;
  const unit = units === "litersPer100" ? UNITS.litersPer100 : UNITS.kmPerLiter;
  const count = model.points.length;
  return <figure className={`tm-consumption-sparkline${home ? " tm-consumption-sparkline-home" : ""} ${className}`} data-testid="consumption-chart" data-tone={model.tone} data-variant={variant}>
    <div className="tm-sparkline-plot">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="tm-sparkline-svg" role="img" aria-labelledby={titleId}>
        <title id={titleId}>{model.points.map(({ segment, value }) => `${dayMonthShort(segment.endDate)}: ${num(value, 1)} ${unit}`).join("; ")}</title>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ink)" stopOpacity=".1" />
          <stop offset="100%" stopColor="var(--ink)" stopOpacity="0" />
        </linearGradient></defs>
        {model.band ? <rect data-testid="consumption-usual-band" data-low={model.band.low} data-high={model.band.high} className="tm-sparkline-band" x="0" y={model.band.y}
          width={WIDTH} height={model.band.height} rx="6" /> : null}
        {model.paths.map(({ key, area }) => <path key={key} d={area} fill={`url(#${gradientId})`} />)}
        <line className="tm-sparkline-baseline" x1="0" x2={WIDTH} y1={baseline} y2={baseline} />
        {model.paths.map(({ key, line }) => <path key={key} data-testid="consumption-island" className="tm-sparkline-line" d={line} />)}
        {model.points.map(({ segment, x, y }, index) => {
          const last = index === count - 1;
          return <g key={segment.endId} data-segment={segment.endId} data-last={last || undefined}>
            <circle className={`tm-sparkline-dot${last ? ` tm-sparkline-last tm-sparkline-${model.tone}` : ""}`} cx={x} cy={y} r={last ? 6.5 : 4} />
          </g>;
        })}
      </svg>
      {model.points.map(({ segment, value, x, y }, index) => {
        const last = index === count - 1;
        // Home: a date only under the oldest and the newest point.
        const dated = !home || last || index === 0;
        const date = new Date(segment.endDate);
        return <span key={segment.endId} aria-hidden="true">
          <span className={`tm-sparkline-value${last ? ` tm-sparkline-last tm-sparkline-${model.tone}` : ""}`}
            style={{ left: `${x / WIDTH * 100}%`, top: `calc(${y / height * 100}% - 14px)` }}><NumRun>{num(value, 1)}</NumRun></span>
          {dated ? <span className={`tm-sparkline-date${last ? " tm-sparkline-last" : ""}`}
            style={{ left: `${x / WIDTH * 100}%`, top: `${(height - 7) / height * 100}%` }}>
            <NumRun>{date.getDate()}</NumRun>{` ב${heMonthShort(date.getMonth() + 1)}`}
          </span> : null}
        </span>;
      })}
      {model.points.map(({ segment, value, x, y }) => <button key={segment.endId} type="button" className="tm-sparkline-point"
        style={{ left: `${x / WIDTH * 100}%`, top: `${y / height * 100}%` }}
        aria-label={`${dayMonthShort(segment.endDate)}, ${num(value, 1)} ${unit} — פרטי המקטע`}
        data-testid={`consumption-point-${segment.endId}`} onClick={() => onSelect(segment)} />)}
    </div>
    {home ? <figcaption className="tm-sparkline-caption">
      <span>{count === 1 ? "התדלוק האחרון" : <><NumRun>{int(count)}</NumRun> תדלוקים אחרונים</>}</span>
      {model.averageValue !== null ? <span>הרגיל שלך <b><NumRun>{num(model.averageValue, 1)}</NumRun></b></span> : null}
    </figcaption> : <figcaption className="tm-sparkline-legend">
      {model.averageValue !== null ? <span><i className="tm-sparkline-band-swatch" aria-hidden="true" />
        <span>הטווח הרגיל שלך, סביב <NumRun>{num(model.averageValue, 1)}</NumRun></span></span> : null}
      <span><i className={`tm-sparkline-dot-swatch tm-sparkline-${model.tone}`} aria-hidden="true" />התדלוק האחרון</span>
    </figcaption>}
  </figure>;
}
