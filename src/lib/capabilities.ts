/**
 * Capability flags.
 *
 * Each flag gates a feature that depends on infrastructure this project does
 * not currently run. The point is not configurability for its own sake — it is
 * that the UI must be able to tell the difference between "no community
 * reports yet" and "community reporting is not running at all", and say the
 * true one.
 *
 * All default to OFF, which is the honest Spark behaviour.
 */

function flag(value: unknown): boolean {
  return value === "1" || value === "true";
}

export const CAPABILITIES = {
  /** Community station-price reporting and the public aggregates it feeds. */
  stationPriceCommunity: flag(import.meta.env.VITE_STATION_PRICE_COMMUNITY_ENABLED),
  /** The scheduled regulated-price updater. */
  fuelPriceAutomation: flag(import.meta.env.VITE_FUEL_PRICE_AUTOMATION_ENABLED),
  /** The /api/vehicle-lookup CORS proxy. */
  vehicleLookupProxy: flag(import.meta.env.VITE_VEHICLE_LOOKUP_PROXY),
  /** An external station-price provider, off unless explicitly configured. */
  externalPriceProvider:
    typeof import.meta.env.VITE_STATION_PRICE_PROVIDER === "string" &&
    import.meta.env.VITE_STATION_PRICE_PROVIDER !== "",
} as const;

/** What to tell the user when a capability is off. Never a fake empty result. */
export const CAPABILITY_OFF_TEXT = {
  stationPriceCommunity:
    "דיווחי מחירים מהקהילה עדיין לא פעילים באפליקציה. מוצג המחיר המרבי המפוקח, כשהוא ידוע.",
  fuelPriceAutomation: "המחיר המרבי המפוקח מתעדכן ידנית, לא אוטומטית.",
} as const;
