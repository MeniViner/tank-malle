/**
 * What signing out leaves in localStorage: only device preferences (theme, accent, onboarding).
 * Drafts, caches, scan labels and every other per-account key go with the Firestore cache,
 * so the next person on this device starts clean.
 */
const DEVICE_KEYS = new Set(["tm.theme", "tm.accent", "tm.onboarded"]);

export function clearSignedOutLocalStorage(storage: Pick<Storage, "length" | "key" | "removeItem"> = localStorage): void {
  try {
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) if (key && !DEVICE_KEYS.has(key)) storage.removeItem(key);
  } catch { /* best effort: the cache wipe is what protects the data */ }
}
