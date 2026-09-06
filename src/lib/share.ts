/**
 * Sharing the app.
 *
 * Public product information and the canonical root URL, and nothing else. Not
 * the current route — which is very often `/fillup/abc123` — not the vehicle,
 * not a statistic, not a referral tag. Someone sharing an app with a friend has
 * not agreed to hand over their fuel log along with it.
 *
 * Dependencies are injected so the whole thing is testable without a browser
 * and so nothing here reads `window` at module scope.
 */

/** The canonical public entry point. Never `location.href`. */
export const APP_SHARE_URL = "https://tank-malle.web.app";
export const APP_SHARE_TITLE = "טנק מלא";
export const APP_SHARE_TEXT =
  "טנק מלא — מעקב תדלוקים, צריכת דלק והוצאות במקום אחד.";

export interface SharePayload {
  title: string;
  text: string;
  url: string;
}

/** Exactly what leaves the device. Frozen so a caller cannot decorate it. */
export function buildSharePayload(): SharePayload {
  return Object.freeze({
    title: APP_SHARE_TITLE,
    text: APP_SHARE_TEXT,
    url: APP_SHARE_URL,
  });
}

export type ShareOutcome =
  /** The native sheet accepted it. */
  | "shared"
  /** The link went to the clipboard instead. */
  | "copied"
  /** The user dismissed the native sheet. Not an error; say nothing. */
  | "cancelled"
  /** Nothing automatic worked; show the URL and let them copy it by hand. */
  | "manual";

export interface ShareDeps {
  share?: (data: SharePayload) => Promise<void>;
  copy?: (text: string) => Promise<void>;
}

/**
 * A dismissed share sheet rejects with `AbortError`, which is a person
 * changing their mind — not a failure, and not something to apologise for with
 * a toast.
 */
function isCancellation(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "AbortError" || name === "NotAllowedError";
}

/**
 * Share, then fall back.
 *
 * Native sheet → clipboard → a sheet showing the URL. Each step is only tried
 * when the previous one is genuinely unavailable or genuinely failed.
 */
export async function shareApp(deps: ShareDeps): Promise<ShareOutcome> {
  const payload = buildSharePayload();

  if (deps.share) {
    try {
      await deps.share(payload);
      return "shared";
    } catch (error) {
      if (isCancellation(error)) return "cancelled";
      // Platform said no. Fall through to the clipboard.
    }
  }

  if (deps.copy) {
    try {
      await deps.copy(payload.url);
      return "copied";
    } catch {
      // Clipboard permissions vary wildly; the manual sheet always works.
    }
  }

  return "manual";
}

/**
 * Bind `shareApp` to the real browser.
 *
 * `navigator.share` is only offered when the platform also reports it can share
 * this payload, so a desktop Chrome that defines the method but refuses text
 * shares goes straight to the clipboard rather than throwing first.
 */
export function browserShareDeps(): ShareDeps {
  const payload = buildSharePayload();
  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    (typeof navigator.canShare !== "function" || navigator.canShare(payload));

  return {
    share: canShare ? (data) => navigator.share(data) : undefined,
    copy:
      typeof navigator !== "undefined" && navigator.clipboard?.writeText
        ? (text) => navigator.clipboard.writeText(text)
        : undefined,
  };
}
