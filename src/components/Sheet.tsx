import { useEffect, useLayoutEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Native modal focus containment/inertness, also when dialogs are nested. */
function Modal({ open, close, children, labelId, bodyId, alert = false, sheet = false }: {
  open: boolean; close: () => void; children: ReactNode; labelId: string; bodyId?: string; alert?: boolean; sheet?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(close);
  useLayoutEffect(() => { closeRef.current = close; }, [close]);
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    // Focus a non-destructive target. A changing callback or form value never
    // reopens the dialog or steals focus from an input.
    (dialog.querySelector<HTMLElement>("[data-modal-initial-focus]") ?? dialog).focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <dialog ref={ref} tabIndex={-1} role={alert ? "alertdialog" : "dialog"} aria-modal="true"
      aria-labelledby={labelId} aria-describedby={bodyId}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]')]
          .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = items[0]; const last = items[items.length - 1];
        if (!first) { event.preventDefault(); event.currentTarget.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      onCancel={(event) => { event.preventDefault(); closeRef.current(); }}
      className={`fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-transparent p-0 text-ink outline-none backdrop:bg-transparent`}>
      <div className={`flex h-full w-full justify-center ${sheet ? "items-end" : "items-center p-6"}`}>
        <div aria-hidden="true" onClick={() => closeRef.current()} className="tm-fade-in absolute inset-0 bg-[rgb(13_35_28/0.42)] backdrop-blur-[2px]" />
        {children}
      </div>
    </dialog>, document.body,
  );
}

export function Sheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Modal open={open} close={onClose} labelId={titleId} sheet>
      <div className="tm-sheet-in relative max-h-[90dvh] w-full max-w-[430px] overflow-y-auto overscroll-contain rounded-t-sheet border-t border-line bg-surface pb-safe shadow-sheet">
        <div className="flex justify-center pt-2.5"><span className="h-1 w-9 rounded-pill bg-line" /></div>
        <div className="flex items-center justify-between gap-2 px-5 pt-2">
          <div id={titleId}>{title ?? <span className="sr-only">פרטים נוספים</span>}</div>
          <button type="button" data-modal-initial-focus aria-label="סגירה" onClick={onClose}
            className="flex size-10 flex-none items-center justify-center rounded-full text-xl text-muted hover:bg-surface-2">×</button>
        </div>
        <div className="px-4 pb-4 pt-3">{children}</div>
      </div>
    </Modal>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel = "ביטול", tone = "danger", onConfirm, onCancel }: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; cancelLabel?: string;
  tone?: "danger" | "accent"; onConfirm: () => void; onCancel: () => void;
}) {
  const titleId = useId(); const bodyId = useId();
  return (
    <Modal open={open} close={onCancel} labelId={titleId} bodyId={bodyId} alert>
      <div className="tm-pop relative max-h-[90dvh] w-full max-w-[340px] overflow-y-auto rounded-[26px] border border-line bg-surface p-5 text-center shadow-raised">
        <h2 id={titleId} className="text-[18px] font-semibold text-ink">{title}</h2>
        <div id={bodyId} className="mt-2 text-[14px] leading-relaxed text-muted">{body}</div>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" onClick={onConfirm}
            className={`min-h-[48px] rounded-pill text-[15px] font-bold transition-[filter,scale] duration-200 active:scale-[0.96] ${tone === "danger" ? "bg-danger text-white" : "bg-accent text-accent-contrast"}`}>{confirmLabel}</button>
          <button type="button" data-modal-initial-focus onClick={onCancel}
            className="min-h-[48px] rounded-pill text-[15px] font-semibold text-muted transition-[background-color,scale] duration-200 active:scale-[0.96] active:bg-surface-2">{cancelLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
