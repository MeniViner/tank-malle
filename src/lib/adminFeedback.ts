/** A personal triage marker; feedback documents remain append-only. */
const MAX_HANDLED = 500;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1500 && !value.includes('/');

export function adminFeedbackStorageKey(uid: string): string {
  return `tm.adminFeedbackHandled.v1.${encodeURIComponent(uid)}`;
}

/** Ignore malformed browser storage; never allow it to break the inbox. */
export function readHandledFeedback(raw: string | null): Set<string> {
  if (!raw || raw.length > 800_000) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    return new Set(Array.isArray(value) ? value.filter(validId).slice(-MAX_HANDLED) : []);
  } catch { return new Set(); }
}

/** Recent personal markers are bounded, with deterministic eviction of the oldest. */
export function updateHandledFeedback(current: ReadonlySet<string>, id: string, handled: boolean): Set<string> {
  const next = new Set([...current].filter(validId));
  if (!validId(id)) return new Set([...next].slice(-MAX_HANDLED));
  next.delete(id);
  if (handled) next.add(id);
  return new Set([...next].slice(-MAX_HANDLED));
}
