import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useToast } from "../context/ToastContext";
import { CheckIcon, CloseIcon, InfoIcon, WarningIcon } from "./icons";
import { getModalToastHost, subscribeModalLayers } from "./modalLayers";
import { NumericText } from "./Fmt";

const ICONS = { success: CheckIcon, error: WarningIcon, info: InfoIcon } as const;
const serverToastHost = () => null;

/** Undo remains reachable above navigation and inside a modal's native top layer. */
export function Toaster() {
  const { toasts, dismissToast } = useToast();
  const modalHost = useSyncExternalStore(subscribeModalLayers, getModalToastHost, serverToastHost);
  if (toasts.length === 0) return null;
  const content = <div className={`tm-toast-stack${modalHost ? " tm-toast-stack-modal" : ""}`} role="status" aria-live="polite">
    {toasts.map((toast) => {
      const Icon = ICONS[toast.tone];
      return <div key={toast.id} className="tm-toast-in tm-toast" data-tone={toast.tone}>
        <span className="tm-toast-icon" aria-hidden="true"><Icon size={20} /></span>
        <span className="tm-toast-copy">
          <span data-toast-title className="tm-toast-title"><NumericText>{toast.title}</NumericText></span>
          {toast.detail ? <span data-toast-detail className="tm-toast-detail"><NumericText>{toast.detail}</NumericText></span> : null}
        </span>
        {toast.onUndo ? <button type="button" className="tm-toast-undo" onClick={() => {
          void toast.onUndo?.();
          dismissToast(toast.id);
        }}><NumericText>{toast.undoLabel ?? "ביטול"}</NumericText></button> : <button type="button" aria-label="סגירת ההודעה"
          className="tm-icon-button tm-toast-close" onClick={() => dismissToast(toast.id)}><CloseIcon size={18} /></button>}
      </div>;
    })}
  </div>;
  return modalHost ? createPortal(content, modalHost) : content;
}
