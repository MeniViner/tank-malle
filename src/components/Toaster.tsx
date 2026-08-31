import { useToast } from "../context/ToastContext";
import { CheckIcon, CloseIcon, InfoIcon, WarningIcon } from "./icons";

const TONES = {
  success: {
    icon: CheckIcon,
    ring: "bg-success-soft text-success-ink",
  },
  error: {
    icon: WarningIcon,
    ring: "bg-danger-soft text-danger-ink",
  },
  info: {
    icon: InfoIcon,
    ring: "bg-accent-soft text-accent",
  },
} as const;

/**
 * Toast stack. Sits above the tab bar so the primary action stays reachable
 * while a toast (and its Undo) is visible.
 */
export function Toaster() {
  const { toasts, dismissToast } = useToast();
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[100px] z-[70] flex flex-col items-center gap-2 px-4 pb-safe"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const tone = TONES[toast.tone];
        const Icon = tone.icon;
        return (
          <div
            key={toast.id}
            className="tm-toast-in pointer-events-auto flex w-full max-w-[390px] items-center gap-3 rounded-[18px] border border-line bg-surface p-3 shadow-[0_18px_40px_-16px_rgb(13_35_28/0.4)]"
          >
            <span
              className={`flex size-9 flex-none items-center justify-center rounded-tile ${tone.ring}`}
            >
              <Icon size={18} />
            </span>

            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14.5px] font-bold text-ink">{toast.title}</span>
              {toast.detail ? (
                <span className="truncate text-[12.5px] text-muted">{toast.detail}</span>
              ) : null}
            </div>

            {toast.onUndo ? (
              <button
                type="button"
                onClick={() => {
                  void toast.onUndo?.();
                  dismissToast(toast.id);
                }}
                className="min-h-[36px] flex-none rounded-pill bg-surface-2 px-3.5 text-[13px] font-bold text-accent"
              >
                {toast.undoLabel ?? "ביטול"}
              </button>
            ) : (
              <button
                type="button"
                aria-label="סגירה"
                onClick={() => dismissToast(toast.id)}
                className="flex size-9 flex-none items-center justify-center rounded-pill text-muted"
              >
                <CloseIcon size={16} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
