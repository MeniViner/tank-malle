import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { InfoIcon } from "./icons";

/**
 * Tap-to-open explainer bubble.
 *
 * Hover tooltips are meaningless on touch, so this is an explicit toggle with
 * a real 40px hit area. It closes on outside tap or Escape and is announced as
 * a dialog, so it works with a screen reader too.
 */
export function InfoTip({
  label,
  children,
  align = "start",
}: {
  /** Accessible name, e.g. "מה זו השוואה אנונימית". */
  label: string;
  children: ReactNode;
  align?: "start" | "end" | "center";
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const position =
    align === "end"
      ? "end-0"
      : align === "center"
        ? "left-1/2 -translate-x-1/2"
        : "start-0";

  return (
    <span ref={wrapper} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((current) => !current)}
        className={`flex size-10 items-center justify-center rounded-full transition-[color,scale] duration-200 active:scale-[0.96] ${
          open ? "text-accent" : "text-muted/70"
        }`}
      >
        <InfoIcon size={16} />
      </button>

      {open ? (
        <span
          id={id}
          role="dialog"
          aria-label={label}
          className={`tm-pop absolute top-full z-30 w-[248px] rounded-[14px] border border-line bg-surface p-3 text-start text-[12.5px] leading-relaxed text-ink/85 shadow-raised ${position}`}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
