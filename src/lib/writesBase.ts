import { FILLUP_KEYS, toEpochMillis } from "./fillupSerializer";
import type { OutboxPayload } from "./outbox";

function equal(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].every(key => equal(left[key], right[key]));
  }
  return a === b;
}

/** Exact comparison of editable fields plus concurrency markers; no rounding. */
export function fillupBaseMatches(before: OutboxPayload, server: OutboxPayload): boolean {
  return FILLUP_KEYS.filter(key => key !== "createdAt").every(key => {
    if (key === "version") return (before[key] ?? 0) === (server[key] ?? 0);
    // Defaults assigned by the shared document reader on pre-upgrade records.
    if (key === "schemaVersion") return (before[key] ?? 1) === (server[key] ?? 1);
    if (key === "fullTankSource") return (before[key] ?? "user") === (server[key] ?? "user");
    if (key === "continuityBreakBefore") return (before[key] ?? false) === (server[key] ?? false);
    if (key === "date") return toEpochMillis(before[key]) === toEpochMillis(server[key]);
    return equal(before[key], server[key]);
  });
}

