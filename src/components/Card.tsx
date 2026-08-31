import type { CSSProperties, ReactNode } from "react";

export function Card({
  children,
  className = "",
  style,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "section";
}) {
  return (
    <Tag
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
      className={`text-[13px] font-semibold tracking-[0.02em] text-muted ${className}`}
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
      <h2 className="text-[17px] font-bold text-ink">{children}</h2>
      {action}
    </div>
  );
}

/** 36px rounded icon tile in accent-soft, used across the form cards. */
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
    accent: "bg-accent-soft text-accent",
    muted: "bg-surface-2 text-muted",
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success-ink",
  };
  return (
    <span
      className={`flex size-9 flex-none items-center justify-center rounded-tile ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "danger" | "warning" | "accent" | "outline";
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    success: "bg-success-soft text-success-ink",
    danger: "bg-danger-soft text-danger-ink",
    warning: "bg-warning-soft text-warning-ink",
    accent: "bg-accent-soft text-accent",
    outline: "border border-line text-muted",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-[11px] py-1 text-[12.5px] font-semibold ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Hairline-separated list container matching the design's list cards. */
export function ListCard({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`overflow-hidden rounded-card border border-line bg-surface shadow-card [&>*+*]:border-t [&>*+*]:border-line ${className}`}
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
      className={`tm-skeleton rounded-[12px] ${className}`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    />
  );
}
