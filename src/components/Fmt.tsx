import { type ReactNode } from "react";
import {
  UNITS,
  int,
  num,
  percent,
  percentPlain,
  price as priceText,
  shekel,
  shekelSigned,
} from "../lib/format";

/**
 * Semantic formatting primitives.
 *
 * The rule the whole app follows: the numeric run — digits, sign, decimal and
 * thousands separators and the currency symbol — is one atomic LTR island. The
 * Hebrew unit word is NOT part of that island; it stays ordinary RTL content
 * beside it. Putting both into one uncontrolled dir="ltr" span is what produces
 * "35%+" and reversed unit order.
 *
 * <bdi> isolates the run from the surrounding bidi context so a leading "+" or
 * "−" cannot be dragged to the wrong end of the number.
 */

/** The LTR island itself. Everything numeric goes through here. */
export function NumRun({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <bdi dir="ltr" className={`num inline-block ${className}`}>
      {children}
    </bdi>
  );
}

/** A number followed by a Hebrew unit that stays outside the LTR island. */
function WithUnit({
  value,
  unit,
  className = "",
  unitClassName = "",
}: {
  value: string;
  unit: string;
  className?: string;
  unitClassName?: string;
}) {
  return (
    <span className={className}>
      <NumRun>{value}</NumRun>
      <span className={`unit ${unitClassName}`}> {unit}</span>
    </span>
  );
}

/** ₪216.77 */
export function Money({
  value,
  digits,
  className = "",
}: {
  value: number;
  digits?: number;
  className?: string;
}) {
  return <NumRun className={className}>{shekel(value, digits)}</NumRun>;
}

/** +₪1.20 / −₪0.05 */
export function SignedMoney({
  value,
  digits = 2,
  className = "",
}: {
  value: number;
  digits?: number;
  className?: string;
}) {
  return <NumRun className={className}>{shekelSigned(value, digits)}</NumRun>;
}

/** ₪8.25 לליטר */
export function PricePerLiter({
  value,
  className = "",
  unitClassName = "",
}: {
  value: number;
  className?: string;
  unitClassName?: string;
}) {
  return (
    <WithUnit
      value={priceText(value)}
      unit={UNITS.perLiter}
      className={className}
      unitClassName={unitClassName}
    />
  );
}

/** +35% / −8% — the sign leads and stays attached to the digits. */
export function SignedPercent({
  value,
  digits = 0,
  className = "",
}: {
  value: number;
  digits?: number;
  className?: string;
}) {
  return <NumRun className={className}>{percent(value, digits)}</NumRun>;
}

/** 72% */
export function Percent({
  value,
  digits = 0,
  className = "",
}: {
  value: number;
  digits?: number;
  className?: string;
}) {
  return <NumRun className={className}>{percentPlain(value, digits)}</NumRun>;
}

/** 26.762 ל׳ */
export function Quantity({
  value,
  digits = 2,
  long = false,
  className = "",
  unitClassName = "",
}: {
  value: number;
  digits?: number;
  /** "ליטר" instead of "ל׳". */
  long?: boolean;
  className?: string;
  unitClassName?: string;
}) {
  return (
    <WithUnit
      value={num(value, digits)}
      unit={long ? UNITS.litersLong : UNITS.liters}
      className={className}
      unitClassName={unitClassName}
    />
  );
}

/** 201,050 ק״מ */
export function Distance({
  value,
  className = "",
  unitClassName = "",
}: {
  value: number;
  className?: string;
  unitClassName?: string;
}) {
  return (
    <WithUnit
      value={int(value)}
      unit={UNITS.km}
      className={className}
      unitClassName={unitClassName}
    />
  );
}

/**
 * 12.4 קמ״ל / 8.1 ל׳/100 ק״מ.
 *
 * The unit follows the user's setting AND the value is converted to match it.
 * Changing only the label while leaving the value in km/L is the bug this
 * component exists to make impossible: it takes km/L and converts internally.
 */
export function ConsumptionValue({
  kmPerLiter,
  units,
  className = "",
  unitClassName = "",
}: {
  kmPerLiter: number | null;
  units: "kmPerLiter" | "litersPer100";
  className?: string;
  unitClassName?: string;
}) {
  const unit = units === "kmPerLiter" ? UNITS.kmPerLiter : UNITS.litersPer100;
  if (kmPerLiter === null || !Number.isFinite(kmPerLiter) || kmPerLiter <= 0) {
    return (
      <span className={className}>
        <NumRun>—</NumRun>
        <span className={`unit ${unitClassName}`}> {unit}</span>
      </span>
    );
  }
  const value = units === "kmPerLiter" ? kmPerLiter : 100 / kmPerLiter;
  return (
    <WithUnit
      value={num(value, 1)}
      unit={unit}
      className={className}
      unitClassName={unitClassName}
    />
  );
}
