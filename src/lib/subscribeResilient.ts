/**
 * Attach a Firestore listener that survives an account handover or a terminated
 * transient connection, without restarting healthy listeners on browser focus.
 *
 * Two things happen when the signed-in user changes, and Firestore handles
 * neither of them for us:
 *
 * 1. Listeners still attached to the OUTGOING account's paths fail with
 *    permission-denied before React runs their cleanup. An onSnapshot with no
 *    error callback rethrows that.
 * 2. Listeners attached to the INCOMING account's paths can be created before
 *    the SDK has finished swapping its auth token, so they are evaluated
 *    against the previous user's credentials and also fail with
 *    permission-denied — and a Firestore listener that fails this way is
 *    terminated permanently. It never retries on its own.
 *
 * (2) is what left a second tab stuck on "add your first vehicle" after
 * switching accounts: the write had landed in Firestore, but the listener that
 * should have delivered it was already dead, and only a manual reload fixed it.
 *
 * So a permission error is re-attached a few times with a short backoff, which
 * is far longer than a token swap needs. A genuine, persistent permission
 * failure exhausts the retries and is then reported rather than hidden.
 * Transient failures have a separate bounded backoff. Once exhausted, browser
 * online/focus/visible events may try one attachment, but do not refill that
 * budget. Only a server-backed snapshot without pending local writes starts a
 * new transient recovery budget: a cached first emission is not recovery proof.
 */
export function subscribeResilient<T>(
  attach: (onNext: (value: T) => void, onError: (error: unknown) => void) => () => void,
  onNext: (value: T) => void,
  options: {
    /** False once the account has moved on; the result is then dropped. */
    isCurrent: () => boolean;
    label: string;
    onError?: (error: unknown) => void;
    maxRetries?: number;
  },
): () => void {
  const requestedRetries = options.maxRetries ?? 5;
  const maxRetries = Number.isFinite(requestedRetries) ? Math.max(0, Math.trunc(requestedRetries)) : 5;
  type Attachment = { stop: (() => void) | null; ended: boolean };
  let active: Attachment | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let permissionAttempts = 0;
  let transientAttempts = 0;
  let resumeTransient = false;
  let lastResumeAt = -Infinity;
  let cancelled = false;
  const current = () => !cancelled && options.isCurrent();
  const transientCodes = new Set(["unavailable", "deadline-exceeded", "aborted", "internal"]);

  const retire = (attachment: Attachment) => {
    // Invalidate before calling stop: it may synchronously flush callbacks.
    attachment.ended = true;
    if (active === attachment) active = null;
    const stop = attachment.stop;
    attachment.stop = null;
    stop?.();
  };

  const start = (): void => {
    if (!current() || active) return;
    resumeTransient = false;
    const attachment: Attachment = { stop: null, ended: false };
    active = attachment;
    const accepts = () => current() && active === attachment && !attachment.ended;
    const fail = (error: unknown) => {
      if (!accepts()) return;
      retire(attachment);
      if (!current()) return;
      const rawCode = (error as { code?: unknown } | null)?.code;
      const code = typeof rawCode === "string" ? rawCode.replace(/^firestore\//, "") : "";
      let delay: number | null = null;
      if (code === "permission-denied" && permissionAttempts < maxRetries) {
        delay = 120 * ++permissionAttempts;
      } else if (transientCodes.has(code)) {
        if (transientAttempts < maxRetries) {
          delay = Math.min(5_000, 250 * 2 ** transientAttempts++);
        } else resumeTransient = true;
      }
      if (delay !== null) {
        timer = setTimeout(() => { timer = null; start(); }, delay);
        return;
      }
      // eslint-disable-next-line no-console
      console.warn(`[tank-maleh] ${options.label} listener failed`, error);
      options.onError?.(error);
    };
    try {
      const stop = attach(value => {
        if (!accepts()) return;
        const metadata = (value as { metadata?: { fromCache?: boolean; hasPendingWrites?: boolean } } | null)?.metadata;
        if (metadata?.fromCache === false && metadata.hasPendingWrites === false) transientAttempts = 0;
        onNext(value);
      }, fail);
      // attach may fail synchronously, before it returns its cleanup function.
      if (attachment.ended || !current() || active !== attachment) {
        retire(attachment);
        stop();
      } else attachment.stop = stop;
    } catch (error) { fail(error); }
  };

  const resume = () => {
    if (!current() || !resumeTransient || active || timer !== null) return;
    const now = Date.now();
    if (now - lastResumeAt < 1_000) return; // Coalesce one focus/visible/online burst.
    lastResumeAt = now;
    start();
  };
  const visible = () => { if (document.visibilityState === "visible") resume(); };
  if (typeof window !== "undefined") {
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
  }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", visible);

  start();

  return () => {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
    }
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visible);
    if (active) retire(active);
  };
}
