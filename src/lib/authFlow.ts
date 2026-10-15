/** Preserve the OAuth provider configuration; Firebase domains alone are insufficient. */
export function authDomainFor(hostname: string, projectId: string, configured: string): string {
  // web.app may be authorized in Firebase but still absent from Google's OAuth
  // redirect allowlist. Never silently change the configured OAuth redirect.
  return hostname === `${projectId}.firebaseapp.com` ? hostname : configured;
}

export const REDIRECT_MARKER = "tm.auth.redirect";

export function authErrorMessage(code: string): string | null {
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return null;
  if (code === "auth/network-request-failed") return "אין חיבור לאינטרנט. נסו שוב כשיש קליטה.";
  if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") return "חלון ההתחברות נחסם. אפשרו חלונות קופצים ונסו שוב.";
  if (code === "auth/unauthorized-domain") return "כתובת האפליקציה אינה מורשית להתחברות.";
  if (code === "auth/web-storage-unsupported") return "שמירת ההתחברות חסומה בדפדפן. אפשרו אחסון לאתר ונסו שוב.";
  return "ההתחברות לא הושלמה. נסו שוב.";
}
