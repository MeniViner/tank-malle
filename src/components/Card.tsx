import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

export function Card({
  children,
  className = "",
  style,
  id,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  id?: string;
  as?: "div" | "section";
}) {
  return (
    <Tag
      id={id}
      style={style}
      className={`rounded-card border border-line bg-surface shadow-card ${className}`}
    >
      {children}
    </Tag>
  );
}

/** Small uppercase-ish field label used above values and card sections. */
export function Label({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`text-[13px] font-semibold text-muted ${className}`}
    >
      {children}
    </span>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between pt-1">
      <h2 className="font-display text-[34px] font-normal leading-none text-ink">{children}</h2>
      {action}
    </div>
  );
}

/** A compact semantic icon, without a separate colored tile. */
export function IconTile({
  children,
  tone = "accent",
  className = "",
}: {
  children: ReactNode;
  tone?: "accent" | "muted" | "danger" | "success";
  className?: string;
}) {
  const tones = {
    accent: "text-ink",
    muted: "text-muted",
    danger: "text-danger",
    success: "text-success-ink",
  };
  return (
    <span
      className={`flex size-5 flex-none items-center justify-center ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className = "",
  selected,
  dashed = false,
  onClick,
  ...buttonProps
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "danger" | "warning" | "accent" | "outline";
  className?: string;
  selected?: boolean;
  dashed?: boolean;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "disabled" | "aria-label" | "aria-pressed" | "id">) {
  const classes = `tm-chip tm-chip-${tone}${selected ? " tm-chip-selected" : ""}${dashed ? " tm-chip-dashed" : ""} ${className}`;
  if (onClick) return <button type="button" className={classes} onClick={onClick}
    aria-pressed={selected} {...buttonProps}>{children}</button>;
  return (
    <span className={classes}>
      {children}
    </span>
  );
}

/** Hairline-separated list container matching the design's list cards. */
export function ListCard({
  children,
  className = "",
  style,
  id,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  id?: string;
}) {
  return (
    <div
      id={id}
      style={style}
      className={`tm-list tm-plate-list [&>*+*]:border-t [&>*+*]:border-line ${className}`}
    >
      {children}
    </div>
  );
}

export function Divider() {
  return <div className="h-px bg-line" />;
}

export function Skeleton({
  className = "",
  delay = 0,
}: {
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={`tm-skeleton rounded-md ${className}`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    />
  );
}
