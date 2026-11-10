import type { ReactNode } from "react";
import { NumRun } from "./Fmt";

/**
 * Design v3 §3 facts strip: a receipt-style list that replaces KPI tiles.
 *
 * Markup is fixed so every screen reads the same:
 * `.facts > button|div > .fl(.fl-text + small) + .ld + .fv(.n + u)` (the label sits in
 * `.fl-text` so mixed Hebrew/number labels stay on one line inside the grid).
 *
 * Values are passed already formatted by `src/lib/format.ts` (`shekel`,
 * `price`, `int`, …) so the AGENTS.md money rule lives in one place; `null`
 * renders an honest "—", never a zero. Styling lives in
 * `design-primitives.css` (`.facts`).
 */
export interface FactProps {
  /** Row label (15/500). */
  label: ReactNode;
  /** One-line support text under the label (12, `--ink-2`). */
  sub?: ReactNode;
  /** Pre-formatted value (e.g. `shekel(835)`, `price(7.35)`, `int(18)`), or null for "—". */
  value: string | null;
  /** Small unit after the value ("ק״מ", "לליטר"). Hidden when the value is unknown. */
  unit?: ReactNode;
  /** Makes the row a button (44px+ target). */
  onClick?: () => void;
  /** Hebrew accessible name for a button row; defaults to the row's visible text. */
  ariaLabel?: string;
  /** For a row that opens a sheet. */
  hasPopup?: "dialog";
  testId?: string;
  /** Quieter value colour, e.g. for a stale or partial reading. */
  muted?: boolean;
  /** Test id on the value (`.fv`) so a test can read exactly the formatted number. */
  valueTestId?: string;
  /** Extra `data-*` attributes on the row (e.g. `data-segment-end-id`). */
  data?: Record<`data-${string}`, string | undefined>;
  /** "minor": a breakdown row under a total (13px label, 16px value), as in the prototype. */
  variant?: "minor";
  /** "text": the value is words (a date, "חשבון Google"), set in the body face, not as a numeric island. */
  valueKind?: "text";
}

export interface FactsStripProps {
  /** Rows as data; rendered before any children. */
  rows?: readonly (FactProps & { id: string })[];
  /** Extra `<Fact>` rows, for rows that own state (e.g. a row that opens its own sheet). */
  children?: ReactNode;
  /** Hebrew group label for assistive technology. */
  label?: string;
  className?: string;
  testId?: string;
}

/** One row. Use inside `<FactsStrip>`. */
export function Fact({ label, sub, value, unit, onClick, ariaLabel, hasPopup, testId, muted = false, valueTestId, data, variant, valueKind }: FactProps) {
  const known = value !== null;
  const content = <>
    <span className="fl"><span className="fl-text">{label}</span>{sub !== undefined && sub !== null && sub !== false ? <small>{sub}</small> : null}</span>
    <i className="ld" aria-hidden="true" />
    <span className="fv" data-testid={valueTestId}>
      {valueKind === "text" && known
        ? <span className={`t${muted ? " muted" : ""}`}>{value}</span>
        : <NumRun className={`n${muted || !known ? " muted" : ""}`}>{known ? value : "—"}</NumRun>}
      {known && unit ? <u>{unit}</u> : null}
    </span>
  </>;
  const className = `fact${variant ? ` ${variant}` : ""}`;
  return onClick
    ? <button type="button" className={className} data-testid={testId} aria-label={ariaLabel} aria-haspopup={hasPopup} onClick={onClick} {...data}>{content}</button>
    : <div className={className} data-testid={testId} {...data}>{content}</div>;
}

/** The strip. Rows are separated by dashed hairlines, the strip has top and bottom rules. */
export function FactsStrip({ rows = [], children, label, className = "", testId }: FactsStripProps) {
  return <div className={`facts ${className}`.trim()} role={label ? "group" : undefined} aria-label={label} data-testid={testId}>
    {rows.map(({ id, ...row }) => <Fact key={id} {...row} />)}
    {children}
  </div>;
}
