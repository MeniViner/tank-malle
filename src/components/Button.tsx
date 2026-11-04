import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "ink" | "line";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
  loading?: boolean;
  size?: "md" | "sm";
  children: ReactNode;
}

export function Button({
  variant = "primary",
  full = false,
  loading = false,
  size = "md",
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`tm-button tm-button-${variant === "secondary" ? "line" : variant} ${size === "sm" ? "tm-button-sm" : ""} ${full ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading ? <><Spinner /><span className="sr-only">{children}</span></> : children}
    </button>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="animate-spin"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" opacity=".25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Full-width tappable row used throughout Settings. */
export function RowButton({
  icon,
  title,
  subtitle,
  value,
  trailing,
  onClick,
  tone = "default",
  disabled,
  className = "",
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`tm-group-row ${tone === "danger" ? "tm-group-row-danger" : ""} ${className}`}
    >
      {icon ? <span className="tm-group-row-icon" aria-hidden="true">{icon}</span> : null}
      <span className="tm-group-row-content">
        <span className="tm-group-row-title">
          {title}
        </span>
        {subtitle ? (
          <span className="tm-group-row-subtitle">{subtitle}</span>
        ) : null}
      </span>
      {value != null ? <span className="tm-group-row-value">{value}</span> : null}
      {trailing}
    </button>
  );
}
