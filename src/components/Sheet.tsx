import { useEffect, useRef, type ReactNode } from "react";

/**
 * Bottom sheet with a scrim. Traps focus, closes on Escape / scrim tap, and
 * locks background scroll while open.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previous = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="סגירה"
        onClick={onClose}
        className="tm-fade-in absolute inset-0 bg-[rgb(13_35_28/0.42)] backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="tm-sheet-in relative w-full max-w-[430px] rounded-t-sheet border-t border-line bg-surface pb-safe shadow-sheet"
      >
        <div className="flex justify-center pt-2.5">
          <span className="h-1 w-9 rounded-pill bg-line" />
        </div>
        {title ? <div className="px-5 pt-3">{title}</div> : null}
        <div className="px-4 pb-4 pt-3">{children}</div>
      </div>
    </div>
  );
}

/** Centred confirmation dialog for destructive actions. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "ביטול",
  tone = "danger",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "accent";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <button
        type="button"
        aria-label={cancelLabel}
        onClick={onCancel}
        className="tm-fade-in absolute inset-0 bg-[rgb(13_35_28/0.5)]"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="tm-pop relative w-full max-w-[340px] rounded-[26px] border border-line bg-surface p-5 text-center shadow-raised"
      >
        <h2 className="text-[17px] font-bold text-ink">{title}</h2>
        <div className="mt-2 text-[14px] leading-relaxed text-muted">{body}</div>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className={`min-h-[48px] rounded-pill text-[15px] font-bold transition-[filter,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] active:brightness-[0.97] ${
              tone === "danger" ? "bg-danger text-white" : "bg-accent text-accent-contrast"
            }`}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[48px] rounded-pill text-[15px] font-semibold text-muted transition-[background-color,scale] duration-200 active:scale-[0.96] active:bg-surface-2"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
