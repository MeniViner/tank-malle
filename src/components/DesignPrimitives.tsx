import { forwardRef, useId, type CSSProperties, type InputHTMLAttributes, type ReactNode } from "react";
import { formatPlate, int, percentPlain } from "../lib/format";
import { levelFromKey, snapLevel } from "../lib/tank/gaugeInteraction";
import { NumRun } from "./Fmt";
import { NumericInput } from "./NumericInput";
import { ChevronStart } from "./icons";

export function Pill({ children, tone = "neutral", className = "" }: {
  children: ReactNode; tone?: "worse" | "better" | "neutral"; className?: string;
}) {
  return <span className={`tm-pill tm-pill-${tone} ${className}`}>{children}</span>;
}

export interface GaugeProps {
  value: number | null;
  habit?: number | null;
  low?: boolean;
  onChange?: (level: number) => void;
  label?: string;
  className?: string;
  /** v3 Home: text drawn above the habit line ("כאן בד״כ מתדלקים"). Decorative; say it in the description too. */
  habitLabel?: string;
  /** v3 Home: darker ticks between the habit line and the current level (what you'll burn before you usually refuel). */
  showUse?: boolean;
  /** Placed between the E and F ends (v3 Home: "במיכל כ־67% · …"). Stays readable by assistive technology. */
  caption?: ReactNode;
}

/** Twenty visual ticks share one full-size slider and the existing gauge keyboard contract. */
export function Gauge({ value, habit, low = false, onChange, label = "כמות הדלק במיכל", className = "", habitLabel, showUse = false, caption }: GaugeProps) {
  const id = useId();
  const level = value != null && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
  const marker = habit != null && Number.isFinite(habit) ? Math.min(1, Math.max(0, habit)) : null;
  const filled = level === null ? 0 : Math.round(level * 20);
  const habitTick = marker === null ? null : Math.round(marker * 20);
  const valueText = level === null ? "עדיין לא סומן" : percentPlain(level * 100);
  return <div className={`tm-gauge${onChange ? " tm-gauge-editable" : ""}${low ? " tm-gauge-low" : ""} ${className}`}>
    <div className="tm-gauge-control" role={onChange ? undefined : level === null ? "img" : "meter"}
      aria-label={onChange ? undefined : level === null ? `${label} — ${valueText}` : label}
      aria-valuemin={onChange || level === null ? undefined : 0}
      aria-valuemax={onChange || level === null ? undefined : 100} aria-valuenow={onChange || level === null ? undefined : level * 100}
      aria-valuetext={onChange || level === null ? undefined : valueText}>
      <div className="tm-gauge-ticks" aria-hidden="true">
        {Array.from({ length: 20 }, (_, index) => <span key={index} className={index >= filled ? "tm-gauge-tick"
          : showUse && !low && habitTick !== null && index >= habitTick ? "tm-gauge-tick tm-gauge-tick-filled tm-gauge-tick-use" : "tm-gauge-tick tm-gauge-tick-filled"} />)}
        {marker !== null ? <span className={`tm-gauge-habit${habitLabel ? " tm-gauge-habit-labelled" : ""}`} style={{ left: `${marker * 100}%` }}>
          {habitLabel ? <em>{habitLabel}</em> : null}
        </span> : null}
      </div>
      {onChange ? <>
        <label htmlFor={id} className="sr-only">{label}</label>
        <input id={id} className="tm-gauge-input" type="range" min="0" max="1" step="0.05" dir="ltr"
          value={level ?? 0} aria-valuetext={valueText}
          onChange={(event) => onChange(snapLevel(Number(event.currentTarget.value), null))}
          onKeyDown={(event) => {
            const next = levelFromKey(level ?? 0, event.key);
            if (next === null) return;
            event.preventDefault();
            // Home at an unknown/zero native value is still a deliberate reading.
            onChange(next);
          }}
          onPointerUp={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right
              || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
            // Native ranges omit change when a tap selects the existing endpoint.
            onChange(snapLevel(Number(event.currentTarget.value), null));
          }} />
      </> : null}
    </div>
    {caption !== undefined ? <div className="tm-gauge-ends tm-gauge-ends-captioned"><span aria-hidden="true">E</span>{caption}<span aria-hidden="true">F</span></div>
      : <div className="tm-gauge-ends" aria-hidden="true"><span>E</span><span>F</span></div>}
  </div>;
}

export function MiniPlate({ plate, className = "" }: { plate: string; className?: string }) {
  return <span className={`tm-mini-plate ${className}`} aria-label={`לוחית ${formatPlate(plate)}`}>
    <span className="tm-mini-plate-il" aria-hidden="true" />
    <NumRun>{formatPlate(plate)}</NumRun>
  </span>;
}

export function PlateXL({ value, placeholder = false, className = "", style }: {
  value: string; placeholder?: boolean; className?: string; style?: CSSProperties;
}) {
  const digits = value.replace(/\D/g, "");
  const shown = placeholder ? formatPlate(digits.padEnd(Math.max(7, digits.length), "0")) : formatPlate(digits);
  let digitIndex = 0;
  return <div className={`tm-plate-xl ${className}`} style={style} role="img"
    aria-label={digits ? `לוחית ${formatPlate(digits)}` : "מספר הרכב"}>
    <span className="tm-plate-il" aria-hidden="true">IL</span>
    <bdi dir="ltr" className="tm-plate-number" aria-hidden="true">
      {[...shown].map((character, index) => {
        const empty = character !== "-" && digitIndex++ >= digits.length;
        return <span key={index} className={placeholder && empty ? "tm-plate-placeholder" : undefined}>{character}</span>;
      })}
    </bdi>
  </div>;
}

export function Odometer({ value, onClick, className = "" }: {
  value: number | null; onClick?: () => void; className?: string;
}) {
  const known = value !== null && Number.isFinite(value) && value >= 0;
  const digits = known ? String(Math.round(value)).padStart(6, "0") : "——————";
  const label = known ? `קילומטראז׳ ${int(value)} ק״מ` : "עדכון הקילומטראז׳";
  const readout = <bdi className="tm-odometer-digits" dir="ltr" aria-hidden="true">
    {[...digits].map((digit, index) => <span key={index}
      className={`tm-odometer-digit${index === digits.length - 1 ? " tm-odometer-last" : ""}`}>{digit}</span>)}
  </bdi>;
  return onClick ? <button type="button" className={`tm-odometer ${className}`} aria-label={label} onClick={onClick}>{readout}</button>
    : <div className={`tm-odometer ${className}`} role="img" aria-label={label}>{readout}</div>;
}

export function PumpDisplay({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`tm-pump-display ${className}`}>{children}</div>;
}

export interface PumpDisplayRowProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: ReactNode;
  unit?: ReactNode;
  caption?: ReactNode;
  error?: ReactNode;
  small?: boolean;
}

/** Editable receipt values pass through unchanged; receipt.ts owns all derivation. */
export const PumpDisplayRow = forwardRef<HTMLInputElement, PumpDisplayRowProps>(function PumpDisplayRow({
  label, unit, caption, error, small = false, className = "", id, ...inputProps
}, ref) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const captionId = `${inputId}-caption`;
  const describedBy = [inputProps["aria-describedby"], error || caption ? captionId : null].filter(Boolean).join(" ") || undefined;
  return <div className={`tm-pump-row${small ? " tm-pump-row-small" : ""}${error ? " tm-pump-row-error" : ""} ${className}`}>
    <div className="tm-pump-line">
      <label htmlFor={inputId} className="tm-pump-label">{label}</label>
      <span className="tm-pump-value">
        <NumericInput ref={ref} inputMode="decimal" autoComplete="off" {...inputProps} id={inputId} dir="ltr"
          aria-invalid={error ? true : inputProps["aria-invalid"]} aria-describedby={describedBy} />
        {unit ? <span className={`tm-pump-unit${unit === "₪" || unit === "%" ? " tm-unit-symbol" : ""}`}>{unit}</span> : null}
      </span>
    </div>
    {error || caption ? <div id={captionId} className="tm-pump-caption" role={error ? "alert" : undefined}>{error || caption}</div> : null}
  </div>;
});

export interface GroupRowProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  danger?: boolean;
  className?: string;
  disabled?: boolean;
  testId?: string;
  ariaLabel?: string;
}

export function GroupRow({ icon, title, subtitle, value, children, onClick, chevron = true, danger = false, className = "", disabled, testId, ariaLabel }: GroupRowProps) {
  const classes = `tm-group-row${danger ? " tm-group-row-danger" : ""} ${className}`;
  const content = <>
    {icon ? <span className="tm-group-row-icon" aria-hidden="true">{icon}</span> : null}
    <span className="tm-group-row-content"><span className="tm-group-row-title">{title}</span>
      {subtitle ? <span className="tm-group-row-subtitle">{subtitle}</span> : null}</span>
    {value != null ? <span className="tm-group-row-value">{value}</span> : null}
    {children}
    {onClick && chevron ? <ChevronStart size={20} /> : null}
  </>;
  return onClick ? <button type="button" className={classes} onClick={onClick} disabled={disabled} data-testid={testId} aria-label={ariaLabel}>{content}</button>
    : <div className={classes} data-testid={testId} aria-label={ariaLabel}>{content}</div>;
}
