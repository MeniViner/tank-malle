import type { ReactNode } from "react";

/**
 * Wraps a numeric/Latin run in an LTR island so digits, currency signs and
 * separators keep their visual order inside RTL text. Every number in the app
 * goes through here.
 */
export function Num({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span dir="ltr" className={`num inline-block ${className}`}>
      {children}
    </span>
  );
}
