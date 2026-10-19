/**
 * Attach a Firestore listener that survives an account handover.
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
  const maxRetries = options.maxRetries ?? 5;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let cancelled = false;

  const start = (): void => {
    if (cancelled) return;
    unsubscribe = attach(
      (value) => {
        if (!cancelled && options.isCurrent()) onNext(value);
      },
      (error) => {
        if (cancelled || !options.isCurrent()) return;

        const code = (error as { code?: string })?.code;
        if (code === "permission-denied" && attempts < maxRetries) {
          attempts += 1;
          unsubscribe?.();
          unsubscribe = null;
          timer = setTimeout(start, 120 * attempts);
          return;
        }

        // eslint-disable-next-line no-console
        console.warn(`[tank-maleh] ${options.label} listener failed`, error);
        options.onError?.(error);
      },
    );
  };

  start();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    unsubscribe?.();
  };
}
