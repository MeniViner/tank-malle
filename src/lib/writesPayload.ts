import { SERVER_TIMESTAMP, toEpochMillis } from "./fillupSerializer";
import type { OutboxPayload } from "./outbox";

/** Content equality for documents without a dedicated serializer (timestamps ignored). */
export function genericPayloadMatches(mine: OutboxPayload, theirs: OutboxPayload): boolean {
  const matches = (value: unknown, other: unknown): boolean => {
    if (value === SERVER_TIMESTAMP) return true;
    if (other && typeof other === "object" && "toMillis" in other) other = toEpochMillis(other);
    if (value && typeof value === "object" && other && typeof other === "object") {
      return Object.entries(value).every(([key, child]) => matches(child, (other as OutboxPayload)[key]));
    }
    return JSON.stringify(value ?? null) === JSON.stringify(other ?? null);
  };
  return Object.entries(mine).every(([key, value]) => {
    const other = key.split(".").reduce<unknown>((current, part) =>
      current && typeof current === "object" ? (current as OutboxPayload)[part] : undefined, theirs);
    return matches(value, other);
  });
}
