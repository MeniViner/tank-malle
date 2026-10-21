import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
  loading?: boolean;
  size?: "md" | "sm";
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-contrast active:brightness-[0.97]",
  secondary: "border border-line bg-surface text-ink active:bg-surface-2",
  ghost: "text-muted active:bg-surface-2",
  danger: "bg-danger-soft text-danger-ink active:brightness-[0.97]",
};

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
      className={`inline-flex ${size === "sm" ? "min-h-[44px] px-3 text-[14px]" : "min-h-[52px] px-6 text-[16px]"} items-center justify-center gap-2 rounded-control font-bold transition-[filter,background-color,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-45 ${
        VARIANTS[variant]
      } ${full ? "w-full" : ""} ${className}`}
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
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-[54px] w-full items-center gap-3 px-4 py-3 text-start transition-[background-color] duration-150 active:bg-surface-2 disabled:opacity-50"
    >
      {icon}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={`text-[15.5px] font-semibold ${
            tone === "danger" ? "text-danger" : "text-ink"
          }`}
        >
          {title}
        </span>
        {subtitle ? (
          <span className="text-[13.5px] font-normal text-muted">{subtitle}</span>
        ) : null}
      </span>
      {value != null ? <span className="max-w-[44%] truncate text-[13.5px] text-muted">{value}</span> : null}
      {trailing}
    </button>
  );
}
