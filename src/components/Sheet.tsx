import { useEffect, useLayoutEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { CloseIcon } from "./icons";
import { getTopModalDialog, registerModalLayer } from "./modalLayers";

/** Native modal containment/inertness, keyboard trapping and focus restoration. */
function Modal({ open, close, children, labelId, bodyId, alert = false, sheet = false, returnFocus }: {
  open: boolean; close: () => void; children: ReactNode; labelId: string; bodyId?: string; alert?: boolean; sheet?: boolean;
  returnFocus?: () => HTMLElement | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const toastHostRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  const returnFocusRef = useRef(returnFocus);
  useLayoutEffect(() => { closeRef.current = close; returnFocusRef.current = returnFocus; }, [close, returnFocus]);
  useEffect(() => {
    if (!open || !ref.current || !toastHostRef.current) return;
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    // The activation owns this resolver for one opening. Later renders cannot
    // rebind it to another account, vehicle, point or kind of trigger.
    const resolveFocus = returnFocusRef.current;
    dialog.showModal();
    const unregister = registerModalLayer(dialog, toastHostRef.current);
    // Changing form values or callbacks never reopens the dialog or steals focus.
    (dialog.querySelector<HTMLElement>("[data-modal-initial-focus]") ?? dialog).focus();
    return () => {
      dialog.close();
      unregister();
      const parent = getTopModalDialog();
      const target = resolveFocus === undefined ? previous : resolveFocus();
      if (target?.isConnected && !target.matches(":disabled") && target.getClientRects().length
        && (!parent || parent.contains(target))) target.focus();
      // A nested operation may disable its opener while waiting for the server.
      // Keep the keyboard in the remaining modal instead of falling onto body.
      if (parent?.isConnected && parent.open && !parent.contains(document.activeElement)) {
        (parent.querySelector<HTMLElement>("[data-modal-initial-focus]:not(:disabled)") ?? parent).focus({ preventScroll: true });
      }
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <dialog ref={ref} tabIndex={-1} role={alert ? "alertdialog" : "dialog"} aria-modal="true"
      aria-labelledby={labelId} aria-describedby={bodyId} data-tm-modal
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, details > summary:first-of-type, [tabindex]')]
          .filter((element) => !element.matches(':disabled') && element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = items[0]; const last = items[items.length - 1];
        if (!first) { event.preventDefault(); event.currentTarget.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); closeRef.current(); }}
      className="tm-modal">
      <div className={`tm-modal-layout ${sheet ? "tm-modal-sheet" : "tm-modal-centered"}`}>
        <div aria-hidden="true" onClick={() => closeRef.current()} className="tm-fade-in tm-modal-scrim" />
        {children}
      </div>
      <div ref={toastHostRef} data-modal-toast-host />
    </dialog>, document.body,
  );
}

export function Sheet({ open, onClose, title, children, className = "", header, atmosphereRoute, returnFocus }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode;
  /** Optional presentation hooks; modal containment and its default header stay shared. */
  className?: string; header?: ReactNode; atmosphereRoute?: string;
  /** Resolve a replaced logical opener; null deliberately refuses restoration. */
  returnFocus?: () => HTMLElement | null;
}) {
  const titleId = useId();
  return <Modal open={open} close={onClose} labelId={titleId} returnFocus={returnFocus} sheet>
    <div className={`tm-sheet-in tm-sheet-panel ${className}`}>
      {atmosphereRoute ? <div data-app-atmosphere-host data-atmosphere-route={atmosphereRoute} aria-hidden="true" /> : null}
      <div className="tm-sheet-grab" aria-hidden="true" />
      {header === undefined ? <div className="tm-sheet-header">
        <div id={titleId} className="tm-sheet-title">
          {typeof title === "string" ? <h2>{title}</h2> : title ?? <h2 className="sr-only">פרטים נוספים</h2>}
        </div>
        <button type="button" data-modal-initial-focus aria-label="סגירה" onClick={onClose} className="tm-icon-button tm-sheet-close">
          <CloseIcon size={22} />
        </button>
      </div> : <><div id={titleId} className="sr-only">{title ?? "פרטים נוספים"}</div>{header}</>}
      <div className="tm-sheet-body">{children}</div>
    </div>
  </Modal>;
}

export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel = "ביטול", tone = "danger", onConfirm, onCancel }: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; cancelLabel?: string;
  tone?: "danger" | "accent"; onConfirm: () => void; onCancel: () => void;
}) {
  const titleId = useId(); const bodyId = useId();
  return <Modal open={open} close={onCancel} labelId={titleId} bodyId={bodyId} alert>
    <div className="tm-pop tm-confirm-panel">
      <h2 id={titleId} className="tm-confirm-title">{title}</h2>
      <div id={bodyId} className="tm-confirm-body">{body}</div>
      <div className="tm-confirm-actions">
        <Button full variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
        <Button full variant="ghost" data-modal-initial-focus onClick={onCancel}>{cancelLabel}</Button>
      </div>
    </div>
  </Modal>;
}
