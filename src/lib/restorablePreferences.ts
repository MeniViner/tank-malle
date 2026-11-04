import type { UserSettings } from "./types";

/** Cost-sharing consent requires a fresh explicit action, never a restored preference. */
export const restorablePreferences = (raw: Record<string, unknown>): Partial<UserSettings> => {
  const out: Partial<UserSettings> = {};
  for (const key of ["quickEntry", "reminderNotifications", "issueNotifications", "syncNotifications", "priceNotifications", "shareBenchmarks"] as const) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  if ([1, 3, 7, 14].includes(Number(raw.reminderLeadDays)) && typeof raw.reminderLeadDays === "number") out.reminderLeadDays = raw.reminderLeadDays;
  if ([500, 1000, 2000].includes(Number(raw.reminderLeadKm)) && typeof raw.reminderLeadKm === "number") out.reminderLeadKm = raw.reminderLeadKm;
  if (["light", "dark", "system"].includes(String(raw.theme))) out.theme = raw.theme as UserSettings["theme"];
  if (["kmPerLiter", "litersPer100"].includes(String(raw.units))) out.units = raw.units as UserSettings["units"];
  if (typeof raw.accentColor === "string") out.accentColor = raw.accentColor;
  if (typeof raw.customAccent === "string" && /^#[0-9a-f]{6}$/i.test(raw.customAccent)) out.customAccent = raw.customAccent;
  return out;
};

