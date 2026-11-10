import { AppMark } from "../components/icons";
import { APP_VERSION } from "../lib/version";

/** Quiet boot screen, using the same wordmark as the entry flow. */
export function Splash() {
  return (
    <div role="status" aria-label="טוען את טנק מלא" className="relative flex min-h-dvh flex-col items-center justify-center bg-transparent px-8 text-ink">
      <AppMark size={58} color="var(--ink)" />
      <h1 className="mt-6 font-display text-[72px] font-normal">טנק מלא</h1>
      <p className="mt-1 text-[16px] text-ink-2">יומן התדלוקים שלך</p>
      <span aria-hidden="true" className="mt-6 h-[2px] w-28 overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full w-1/2 animate-pulse bg-accent" />
      </span>
      <span dir="ltr" className="num absolute bottom-10 text-[12px] text-ink-2">v{APP_VERSION}</span>
    </div>
  );
}
