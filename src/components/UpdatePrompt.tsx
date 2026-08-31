import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshIcon } from "./icons";

/**
 * "גרסה חדשה זמינה" prompt shown when the service worker has a new build
 * staged. Refreshing is the user's choice — we never reload underneath them
 * mid-entry.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // Without this the hook waits for window's `load` event, which has often
    // already fired by the time React mounts — leaving the SW unregistered.
    immediate: true,
    onRegisterError(error) {
      console.warn("service worker registration failed", error);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[100px] z-[80] flex justify-center px-4 pb-safe">
      <div className="tm-toast-in pointer-events-auto flex w-full max-w-[390px] items-center gap-3 rounded-[20px] border border-line bg-surface p-3 shadow-raised">
        <span className="flex size-9 flex-none items-center justify-center rounded-tile bg-accent-soft text-accent">
          <RefreshIcon size={18} />
        </span>

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[14.5px] font-bold text-ink">גרסה חדשה זמינה</span>
          <span className="truncate text-[12.5px] text-muted">רעננו כדי לעבור אליה</span>
        </div>

        <button
          type="button"
          onClick={() => void updateServiceWorker(true)}
          className="min-h-[40px] flex-none rounded-pill bg-accent px-3.5 text-[13px] font-bold text-accent-contrast transition-[filter,scale] duration-200 active:scale-[0.96]"
        >
          רענון
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          aria-label="סגירה"
          className="min-h-[40px] flex-none px-2 text-[13px] font-semibold text-muted transition-[color,scale] duration-200 active:scale-[0.96]"
        >
          אחר כך
        </button>
      </div>
    </div>
  );
}
