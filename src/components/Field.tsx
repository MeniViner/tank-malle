import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { WarningIcon } from "./icons";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: ReactNode;
  /** Unit shown after the value, e.g. "ק״מ" / "ליטר". */
  suffix?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  warning?: ReactNode;
  icon?: ReactNode;
  /** Renders the value at hero size, for the odometer and liters inputs. */
  big?: boolean;
}

/**
 * Labelled input. Numeric fields pass inputMode="decimal" so mobile keyboards
 * open on digits, and the value itself is LTR + tabular so it never reorders.
 */
export function Field({
  label,
  suffix,
  hint,
  error,
  warning,
  icon,
  big = false,
  className = "",
  ...rest
}: FieldProps) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label
        htmlFor={id}
        className="truncate text-[13px] font-semibold tracking-[0.02em] text-muted"
      >
        {label}
      </label>

      <div
        className={`flex items-center gap-2.5 rounded-[14px] border bg-surface px-3.5 transition-[border-color,box-shadow] duration-200 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)] ${
          big ? "min-h-[58px]" : "min-h-[50px]"
        } ${
          error
            ? "border-danger"
            : warning
              ? "border-warning"
              : "border-line focus-within:border-accent"
        }`}
      >
        {icon}
        <input
          id={id}
          dir="ltr"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={`num min-w-0 flex-1 bg-transparent text-start outline-none placeholder:text-muted/60 ${
            big ? "text-[26px] font-bold" : "text-[16px] font-semibold"
          }`}
          {...rest}
        />
        {suffix ? (
          <span className="flex-none text-[13px] font-semibold text-muted">{suffix}</span>
        ) : null}
      </div>

      {error ? (
        <span id={`${id}-error`} className="text-[12.5px] font-semibold text-danger">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-hint`} className="text-[12.5px] text-muted">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** Amber, non-blocking validation note. Never prevents saving. */
export function SoftWarningBanner({
  message,
  detail,
}: {
  message: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-[14px] bg-warning-soft px-3.5 py-3 text-warning-ink">
      <WarningIcon size={17} className="mt-px flex-none" />
      <div className="flex flex-col gap-1">
        <span className="text-[13.5px] font-bold">{message}</span>
        {detail ? <span className="text-[12.5px] leading-relaxed">{detail}</span> : null}
      </div>
    </div>
  );
}

/** Neutral inline note (the "המחיר הרשמי יתעדכן…" strip on Home). */
export function InfoStrip({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] bg-surface-2 px-3.5 py-2.5">
      {icon ? <span className="flex-none text-muted">{icon}</span> : null}
      <span className="text-[13px] text-ink/80">{children}</span>
    </div>
  );
}
