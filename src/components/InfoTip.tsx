import { useState, type ReactNode } from "react";
import { InfoIcon } from "./icons";
import { Sheet } from "./Sheet";

/**
 * Tap-to-open explainer.
 *
 * It used to be an absolutely positioned 248px bubble anchored to the icon,
 * which on a 360px screen ran straight off the edge of the page and gave the
 * whole document a horizontal scrollbar. Anchoring cannot be made safe here:
 * the icon sits wherever its row puts it, and the row may be flush against
 * either margin.
 *
 * So the explanation opens in the app's own bottom sheet instead — viewport
 * safe by construction, dismissed by the scrim or Escape, focus trapped, and
 * announced as a dialog.
 */
export function InfoTip({
  label,
  children,
}: {
  /** Accessible name and sheet heading, e.g. "השוואה אנונימית". */
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`flex size-10 flex-none items-center justify-center rounded-full transition-[color,scale] duration-200 active:scale-[0.96] ${
          open ? "text-accent" : "text-muted/70"
        }`}
      >
        <InfoIcon size={16} />
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={<h2 className="text-[17px] font-bold text-ink">{label}</h2>}
      >
        <div className="flex flex-col gap-2 px-1 text-[13.5px] leading-relaxed text-ink/85">
          {children}
        </div>
      </Sheet>
    </>
  );
}
