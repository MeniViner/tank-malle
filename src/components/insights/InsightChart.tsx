/* oxlint-disable react/only-export-components -- Shared chart settings belong with their accessible presentation. */
import { cloneElement, useId, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer } from "recharts";
import { int, num, price } from "../../lib/format";
import { vehicleMoney } from "../../lib/vehicle/format";
import { NumericText, NumRun } from "../Fmt";

export const CHART_MARGIN = { top: 18, right: 2, bottom: 2, left: 4 };
const isNumericLabel = (label: string) => /^[+−-]?\d[\d\s,./:–−+-]*$/.test(label.trim());

function CategoryTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value?: string | number } }) {
  const label = String(payload?.value ?? "");
  const numeric = isNumericLabel(label);
  return <text x={x} y={y + 14} textAnchor="middle" fill="var(--ink-2)" fontSize={12} direction={numeric ? "ltr" : "rtl"} unicodeBidi="isolate">
    {numeric ? label : label.split(/(\d[\d,.]*)/).map((part, index) => <tspan key={index}
      direction={/^\d/.test(part) ? "ltr" : undefined} unicodeBidi={/^\d/.test(part) ? "isolate" : undefined}>{part}</tspan>)}
  </text>;
}

export const TIME_AXIS = {
  dataKey: "label", reversed: true, tick: <CategoryTick />, tickLine: false, axisLine: false,
  minTickGap: 18, interval: "preserveStartEnd" as const,
};
export const VALUE_AXIS = {
  orientation: "right" as const, tickLine: false, axisLine: false,
  tick: { fill: "var(--ink-2)", fontSize: 12, direction: "ltr", unicodeBidi: "isolate" }, width: 36,
};

/**
 * v3 quiet line charts (Stage 7 D6, as on Home and in the prototype): the value
 * axis keeps scaling the plot but draws nothing; values are printed at the
 * points that matter instead.
 */
export const QUIET_VALUE_AXIS = { hide: true, domain: ["auto", "auto"] as ["auto", "auto"] };

/** A value printed on the plot (an endpoint or the average). Decorative: the same values are in the tooltip, point names and table. */
export function ChartValueLabel({ x, y, children, anchor = "middle", fill = "var(--ink-2)", strong = false, className = "insights-chart-value" }: {
  x: number; y: number; children: string; anchor?: "start" | "middle" | "end"; fill?: string; strong?: boolean; className?: string;
}) {
  return <text className={className} x={x} y={y} textAnchor={anchor} fill={fill} fontSize={12} fontWeight={strong ? 600 : 500}
    direction="ltr" unicodeBidi="isolate" aria-hidden="true" pointerEvents="none">
    {children.split(/(₪)/).map((part, index) => <tspan key={index} fontSize={part === "₪" ? ".8em" : undefined}>{part}</tspan>)}
  </text>;
}

export function InsightCard({ label, title, children, className = "", testId }: {
  label?: ReactNode; title: ReactNode; children?: ReactNode; className?: string; testId?: string;
}) {
  return <section className={`insights-card ${className}`} data-testid={testId}>
    <header className="insights-card-heading">
      {label ? <p className="insights-label">{label}</p> : null}
      <h2 className="insights-headline">{title}</h2>
    </header>
    {children}
  </section>;
}

export function InsightEmpty({ title, children, action = true }: { title: string; children?: ReactNode; action?: boolean }) {
  return <section className="insights-empty"><h2>{title}</h2>{children ? <p>{children}</p> : null}
    {action ? <Link className="insights-text-action" to="/fillup/new">תדלוק חדש ←</Link> : null}
  </section>;
}

export function InsightChart({ children, label, testId, points = 0, chronological = true, pointSpacing }: {
  children: ReactElement; label: string; testId: string; points?: number; chronological?: boolean; pointSpacing?: number;
}) {
  const description = useId();
  const minimumWidth = pointSpacing ? Math.max(0, points - 1) * pointSpacing + 110 : points > 14 ? points * 30 : null;
  const wide = minimumWidth !== null;
  return <figure className="insights-chart" data-testid={testId} aria-label={label} aria-describedby={description}>
    <div className={`insights-chart-scroll${wide ? " insights-chart-wide" : ""}`} dir="rtl"
      tabIndex={wide ? 0 : undefined} role={wide ? "region" : undefined} aria-label={wide ? `${label}, אפשר לגלול לכל התקופה` : undefined}>
      <div className="insights-chart-canvas" dir="ltr" style={minimumWidth !== null ? { minWidth: `${minimumWidth}px` } : undefined}>
        <ResponsiveContainer width="100%" height="100%">{namedChart(children, label)}</ResponsiveContainer>
      </div>
    </div>
    <figcaption id={description} className="sr-only">{label}. {chronological ? "תחילת התקופה מימין. " : ""}הנתונים המלאים מופיעים גם בטבלה שמתחת לגרף.</figcaption>
  </figure>;
}

/**
 * Stage 7 D8: Recharts' accessibility layer makes the chart surface a focusable
 * `role="application"` (arrow keys move the tooltip). Give that stop a Hebrew
 * name; a chart without the layer is not focusable and stays unnamed (the figure names it).
 */
function namedChart(chart: ReactElement, label: string) {
  const props = chart.props as { accessibilityLayer?: boolean };
  if (props.accessibilityLayer === false) return chart;
  return cloneElement(chart as ReactElement<Record<string, unknown>>, { "aria-label": `${label}, אפשר לעבור בין הערכים בחיצים` });
}

export function ChartLegend({ color = "var(--ink)", dashed = false, block = false, outlined = false, children }: {
  color?: string; dashed?: boolean; block?: boolean; outlined?: boolean; children: ReactNode;
}) {
  return <span className="insights-legend-item"><i aria-hidden="true"
    className={`${dashed ? "insights-legend-dash" : ""}${block ? " insights-legend-block" : ""}${outlined ? " insights-legend-outline" : ""}`}
    style={{ background: dashed ? undefined : color, borderColor: color }} />{children}</span>;
}

export function InsightTable({ children, label, testId, caption }: {
  children: ReactNode; label?: string; caption: string; testId: string;
}) {
  return <details className="insights-data" data-testid={testId}>
    <summary>{label ?? "נתוני הגרף"}</summary>
    <div className="insights-table-scroll" tabIndex={0} role="region" aria-label={caption}>
      <table><caption className="sr-only">{caption}</caption>{children}</table>
    </div>
  </details>;
}

export function InsightTooltip({ active, payload, label, kind = "number", suffix = "", digits = 1, labels = {} }: {
  active?: boolean;
  payload?: readonly { value?: number | string | null; dataKey?: string | number; name?: string | number; payload?: Record<string, unknown> }[];
  label?: string | number;
  kind?: "number" | "money" | "price" | "integer";
  suffix?: string; digits?: number; labels?: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter(row => row.value !== null && row.value !== undefined && Number.isFinite(Number(row.value)));
  if (!rows.length) return null;
  const source = rows[0].payload;
  return <div dir="rtl" className="insights-tooltip">
    {label ? <p>{isNumericLabel(String(label)) ? <NumRun>{String(label)}</NumRun> : <NumericText>{String(label)}</NumericText>}</p> : null}
    {rows.map((row, index) => {
      const value = Number(row.value);
      const key = String(row.dataKey ?? row.name ?? "");
      const title = key === "official" && typeof source?.referenceLabel === "string" ? source.referenceLabel : labels[key];
      const shown = kind === "money" ? vehicleMoney(Math.round(value * 100))
        : kind === "price" ? price(value) : kind === "integer" ? int(value) : num(value, digits);
      return <div className="insights-tooltip-row" key={`${key}:${index}`}>
        {title ? <span>{title}</span> : null}<strong><NumRun>{shown}</NumRun>{suffix ? <span> <NumericText>{suffix}</NumericText></span> : null}</strong>
      </div>;
    })}
    {typeof source?.unknown === "number" && source.unknown > 0 ? <p>סכומים ידועים בלבד · <NumRun>{int(source.unknown)}</NumRun> עלויות חסרות</p> : null}
  </div>;
}

export function LedgerAmount({ value }: { value: number | null }) {
  return <NumRun>{value === null ? "—" : vehicleMoney(value)}</NumRun>;
}
