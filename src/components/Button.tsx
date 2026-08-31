import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
  loading?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-contrast shadow-[0_2px_4px_rgb(13_35_28/0.10),0_10px_22px_-10px_var(--accent)] active:brightness-[0.97]",
  secondary: "border border-line bg-surface text-ink shadow-card active:bg-surface-2",
  ghost: "text-muted active:bg-surface-2",
  danger: "bg-danger-soft text-danger-ink active:brightness-[0.97]",
};

export function Button({
  variant = "primary",
  full = false,
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-pill px-6 text-[16px] font-bold transition-[filter,background-color,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-45 ${
        VARIANTS[variant]
      } ${full ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading ? <Spinner /> : children}
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
  trailing,
  onClick,
  tone = "default",
  disabled,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
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
      className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-start transition-[background-color] duration-150 active:bg-surface-2 disabled:opacity-50"
    >
      {icon}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={`truncate text-[15px] font-semibold ${
            tone === "danger" ? "text-danger" : "text-ink"
          }`}
        >
          {title}
        </span>
        {subtitle ? (
          <span className="truncate text-[13px] font-normal text-muted">{subtitle}</span>
        ) : null}
      </span>
      {trailing}
    </button>
  );
}
