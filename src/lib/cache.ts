/**
 * Last-known-good cache.
 *
 * Firestore's own persistence covers reads it has seen, but it only comes
 * online after the SDK boots and auth resolves — which is exactly the window
 * where a cold start shows empty skeletons. Mirroring the resolved view into
 * localStorage lets the first paint be real content instead, and keeps the
 * app useful on a flaky connection.
 *
 * The cache is per-user and versioned; anything stale or malformed is
 * discarded rather than trusted.
 */

const VERSION = 1;
const PREFIX = "tm.cache.v" + VERSION;
const MAX_AGE_MS = 30 * 86_400_000;

interface Envelope<T> {
  v: number;
  at: number;
  uid: string;
  data: T;
}

function key(uid: string, name: string): string {
  return `${PREFIX}.${uid}.${name}`;
}

export function readCache<T>(uid: string | null | undefined, name: string): T | null {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(key(uid, name));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Envelope<T>;
    if (parsed.v !== VERSION || parsed.uid !== uid) return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) return null;

    return parsed.data;
  } catch {
    return null;
  }
}

export function writeCache<T>(uid: string | null | undefined, name: string, data: T): void {
  if (!uid) return;
  try {
    const envelope: Envelope<T> = { v: VERSION, at: Date.now(), uid, data };
    localStorage.setItem(key(uid, name), JSON.stringify(envelope));
  } catch {
    // Quota exceeded or private mode — the app still works, just without the
    // instant first paint.
  }
}

/** Drop every cached entry for a user, e.g. on sign-out or account deletion. */
export function clearCache(uid: string | null | undefined): void {
  if (!uid) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const name = localStorage.key(i);
      if (name?.startsWith(`${PREFIX}.${uid}.`)) doomed.push(name);
    }
    doomed.forEach((name) => localStorage.removeItem(name));
  } catch {
    /* storage unavailable */
  }
}

/** Remove caches from earlier schema versions. */
export function pruneOldCaches(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const name = localStorage.key(i);
      if (name?.startsWith("tm.cache.v") && !name.startsWith(PREFIX)) doomed.push(name);
    }
    doomed.forEach((name) => localStorage.removeItem(name));
  } catch {
    /* storage unavailable */
  }
}
