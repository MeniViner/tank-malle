import { Children, Fragment, type ReactNode } from "react";
import {
  UNITS, int, num, percent, percentPlain, price as priceText, shekel, shekelSigned,
} from "../lib/format";

export interface NumberPresentation {
  className?: string;
  /** A standalone value begins at the right edge of the surrounding RTL layout. */
  block?: boolean;
  /** Row-end amounts can explicitly align left without changing their LTR order. */
  align?: "leading" | "trailing" | "inherit";
}

export interface NumRunProps extends NumberPresentation { children: ReactNode }

/** Digits, signs and currency form one isolated LTR run; Hebrew stays outside. */
export function NumRun({ children, className = "", block = false, align = "leading" }: NumRunProps) {
  const parts = Children.toArray(children).reduce<ReactNode[]>((result, child) => {
    const last = result.at(-1);
    if (typeof child === "string" || typeof child === "number") {
      if (typeof last === "string") result[result.length - 1] = last + child;
      else result.push(String(child));
    } else result.push(child);
    return result;
  }, []);
  const content = parts.map((child, index) => {
    if (typeof child !== "string") return child;
    // Accepts the v3 formatter output ("777\u202F₪", "−12\u202F₪", "25%") and
    // legacy authored prefix strings ("₪25") without changing a single character.
    const numeric = child.match(/^([+−-]?)(₪?)(\s*)([+−-]?)([\d,\u200e\u200f.]+)([\u202F\u00A0 ]?)([%₪]?)$/);
    if (!numeric || !(numeric[2] || numeric[7])) return child;
    const [, leadingSign, currency, spacing, priceSign, digits, gap, suffix] = numeric;
    if (leadingSign && priceSign || currency && suffix || gap && !suffix) return child;
    // DOM/reading order stays exactly as authored. A trailing ₪ (v3 §5) stays
    // after the digits; CSS keeps % and a legacy leading ₪ on the left without
    // changing copied text, accessible names, signs or precision.
    const trailing = suffix === "₪" ? "trailing" : undefined;
    return <span key={index} className="tm-symbol-number">
      {leadingSign ? <span className="tm-number-sign">{leadingSign}</span> : null}
      {currency ? <span className="tm-unit-symbol">{currency}</span> : null}
      {spacing ? <span className="tm-number-spacing">{spacing}</span> : null}
      <span className="tm-number-value">{priceSign}{digits}</span>
      {gap ? <span className="tm-number-spacing" data-unit-position={trailing}>{gap}</span> : null}
      {suffix ? <span className="tm-unit-symbol" data-unit-position={trailing}>{suffix}</span> : null}
    </span>;
  });
  return <bdi dir="ltr" data-number-align={align}
    className={`num tm-number${block ? " tm-number-block" : ""} ${className}`}>{content}</bdi>;
}

/**
 * A Latin phrase that mixes letters and digits ("i20", "BYD ATTO 3", "ID.4")
 * is one LTR word. Isolating only its digits would push them to the far end
 * of the RTL line ("20i", "3 BYD ATTO"), so the whole phrase is isolated once.
 */
const LATIN_PHRASE = /(?<![\p{L}\p{N}.,])[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*(?: [A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)*(?![\p{L}\p{N}])/gu;
const isLatinAlnum = (phrase: string) => /[A-Za-z]/.test(phrase) && /\d/.test(phrase);

/** Mixed labels keep numeric fragments isolated; this never formats their values. */
export function NumericText({ children }: { children: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of children.matchAll(LATIN_PHRASE)) {
    if (!isLatinAlnum(match[0])) continue;
    if (match.index > cursor) parts.push(<NumericFragments key={cursor}>{children.slice(cursor, match.index)}</NumericFragments>);
    parts.push(<bdi key={match.index} dir="ltr" className="tm-latin-run">{match[0]}</bdi>);
    cursor = match.index + match[0].length;
  }
  if (!parts.length) return <NumericFragments>{children}</NumericFragments>;
  if (cursor < children.length) parts.push(<NumericFragments key={cursor}>{children.slice(cursor)}</NumericFragments>);
  return <>{parts}</>;
}

function NumericFragments({ children }: { children: string }) {
  return <>{children.split(/((?:[+−]|(?<![\p{L}\p{N}])-)?(?:₪\s*[+−-]?)?\d(?:[\d,.:/]*\d)?(?:%|[\u202F\u00A0 ]?₪)?)/gu)
    .map((part, index) => index % 2 ? <NumRun key={index}>{part}</NumRun>
      : !/[₪%]/.test(part) ? part : <Fragment key={index}>{part.split(/([₪%])/).map((text, symbolIndex) => text === "₪" || text === "%"
        ? <span key={symbolIndex} className="tm-unit-symbol">{text}</span> : text)}</Fragment>)}</>;
}

/** A unit such as ל׳/100 ק״מ still isolates its embedded numeric run. */
function UnitText({ value }: { value: string }) {
  return <>{value.split(/(\d+(?:[.,]\d+)*)/).map((part, index) =>
    /^\d/.test(part) ? <NumRun key={index}>{part}</NumRun> : part)}</>;
}

interface WithUnitProps extends NumberPresentation {
  value: string;
  unit: string;
  unitClassName?: string;
}
function WithUnit({ value, unit, className = "", unitClassName = "", block = false, align = "leading" }: WithUnitProps) {
  return <span data-number-align={align} className={`tm-number-with-unit${block ? " tm-number-block" : ""} ${className}`}>
    <NumRun>{value}</NumRun><span className={`unit ${unitClassName}`}> <UnitText value={unit} /></span>
  </span>;
}

/** Whole-shekel display only; editable and persisted values keep their precision. */
export function Money({ value, ...presentation }: NumberPresentation & { value: number }) {
  return <NumRun {...presentation}>{shekel(value)}</NumRun>;
}
export function SignedMoney({ value, ...presentation }: NumberPresentation & { value: number }) {
  return <NumRun {...presentation}>{shekelSigned(value)}</NumRun>;
}
export function PricePerLiter({ value, ...presentation }: NumberPresentation & { value: number; unitClassName?: string }) {
  return <WithUnit value={priceText(value)} unit={UNITS.perLiter} {...presentation} />;
}
export function SignedPercent({ value, digits = 0, ...presentation }: NumberPresentation & { value: number; digits?: number }) {
  return <NumRun {...presentation}>{percent(value, digits)}</NumRun>;
}
export function Percent({ value, digits = 0, ...presentation }: NumberPresentation & { value: number; digits?: number }) {
  return <NumRun {...presentation}>{percentPlain(value, digits)}</NumRun>;
}
export function Quantity({ value, digits = 2, long = false, ...presentation }: NumberPresentation & {
  value: number; digits?: number; long?: boolean; unitClassName?: string;
}) {
  return <WithUnit value={num(value, digits)} unit={long ? UNITS.litersLong : UNITS.liters} {...presentation} />;
}
export function Distance({ value, ...presentation }: NumberPresentation & { value: number; unitClassName?: string }) {
  return <WithUnit value={int(value)} unit={UNITS.km} {...presentation} />;
}

/** Canonical km/L is converted together with its unit, never just relabelled. */
export function ConsumptionValue({ kmPerLiter, units, long = false, ...presentation }: NumberPresentation & {
  kmPerLiter: number | null; units: "kmPerLiter" | "litersPer100"; long?: boolean; unitClassName?: string;
}) {
  const unit = long ? units === "kmPerLiter" ? "ק״מ לליטר" : "ל׳ ל-100 ק״מ" : units === "kmPerLiter" ? UNITS.kmPerLiter : UNITS.litersPer100;
  const valid = kmPerLiter !== null && Number.isFinite(kmPerLiter) && kmPerLiter > 0;
  const value = valid ? num(units === "kmPerLiter" ? kmPerLiter : 100 / kmPerLiter, 1) : "—";
  return <WithUnit value={value} unit={unit} {...presentation} />;
}
