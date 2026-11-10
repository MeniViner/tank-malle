import type { Fillup, FuelPrices, FuelType, StationRef, Vehicle } from "./stats";

export type { Fillup, FuelPrices, FuelType, StationRef, Vehicle };

export type ThemeSetting = "system" | "light" | "dark";
export type Units = "kmPerLiter" | "litersPer100";

export interface UserSettings {
  theme: ThemeSetting;
  /** Curated accent id; legacy IDs resolve to plate without rewriting stored data. */
  accentColor: string;
  /** Retained for backup compatibility; custom colours now resolve to plate. */
  customAccent?: string | null;
  units: Units;
  activeVehicleId?: string | null;
  onboardingDone?: boolean;
  /** Publish one anonymous economy summary for the peer comparison. */
  shareBenchmarks?: boolean;
  /** Separate explicit opt-in for a pseudonymous full ownership-cost summary. */
  shareTcoBenchmarks?: boolean;
  quickEntry?: boolean;
  reminderNotifications?: boolean;
  issueNotifications?: boolean;
  syncNotifications?: boolean;
  priceNotifications?: boolean;
  reminderLeadDays?: number;
  reminderLeadKm?: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  accentColor: "plate",
  customAccent: null,
  units: "kmPerLiter",
  activeVehicleId: null,
  onboardingDone: false,
  shareBenchmarks: true,
  shareTcoBenchmarks: false,
};

export interface UserProfile {
  displayName: string | null;
  photoURL: string | null;
  email: string | null;
  settings: UserSettings;
  createdAt?: number;
}

/**
 * A station on a fill-up. `stationId` is the identity; everything else is a
 * snapshot of how the station looked at the time, so a later rename does not
 * rewrite history. Defined once, in stats.ts, and re-exported here.
 */
export type Station = StationRef;

/** Everything the add/edit form needs to produce a Fillup document. */
export interface FillupDraft {
  date: number;
  odometer: string;
  liters: string;
  pricePerLiter: string;
  totalCost: string;
  isFullTank: boolean;
  /** True when the user declared undocumented fill-ups before this record. */
  continuityBreakBefore: boolean;
  station: Station | null;
  notes: string;
}

/** Result of a plate lookup against the Israeli vehicle registry. */
export interface PlateLookupResult {
  found: boolean;
  source: "private" | "motorcycle" | "heavy" | "offroad" | "deregistered" | null;
  plateNumber: string;
  make?: string;
  model?: string;
  year?: number | null;
  fuelType?: FuelType;
  engineVolume?: number | null;
  /** Human-readable category, e.g. "רכב פרטי · בנזין". */
  category?: string;
  /** Registry codes, used to join the WLTP spec register exactly. */
  tozeretCd?: number | null;
  degemCd?: number | null;
  /**
   * Design v3: from the registry's fuel label. "ev" for a battery-electric car
   * (fuelType stays "other"), "phev" for a plug-in; null/absent = not stated.
   */
  powertrain?: import('./vehicle/v3Fields').Powertrain | null;
}
