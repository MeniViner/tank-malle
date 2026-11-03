import { DEFAULT_SETTINGS, type UserProfile } from "./types";

export type LoginProfile = Pick<UserProfile, "displayName" | "photoURL" | "email">;

/**
 * Login telemetry may win the race to create the first profile document.
 * Complete only absent top-level fields from the transaction's actual read:
 * existing preferences, explicit nulls and unknown fields remain owned by it.
 */
export function missingProfileFields(
  existing: Record<string, unknown>,
  identity: LoginProfile,
  createdAt: unknown,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {
    displayName: identity.displayName,
    photoURL: identity.photoURL,
    email: identity.email,
    settings: { ...DEFAULT_SETTINGS },
    createdAt,
  };
  return Object.fromEntries(Object.entries(defaults).filter(([key]) => !Object.hasOwn(existing, key)));
}
