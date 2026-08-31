import type { Fillup, FuelPrices, FuelType, Vehicle } from "./stats";

export type { Fillup, FuelPrices, FuelType, Vehicle };

export type ThemeSetting = "system" | "light" | "dark";
export type Units = "kmPerLiter" | "litersPer100";

export interface UserSettings {
  theme: ThemeSetting;
  /** Accent id from ACCENTS, or "custom". */
  accentColor: string;
  /** Hex value, only meaningful when accentColor === "custom". */
  customAccent?: string | null;
  units: Units;
  activeVehicleId?: string | null;
  onboardingDone?: boolean;
  /** Publish one anonymous economy summary for the peer comparison. */
  shareBenchmarks?: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  accentColor: "teal",
  customAccent: null,
  units: "kmPerLiter",
  activeVehicleId: null,
  onboardingDone: false,
  shareBenchmarks: true,
};

export interface UserProfile {
  displayName: string | null;
  photoURL: string | null;
  email: string | null;
  settings: UserSettings;
  createdAt?: number;
}

export interface Station {
  name: string;
  lat?: number;
  lng?: number;
}

/** Everything the add/edit form needs to produce a Fillup document. */
export interface FillupDraft {
  date: number;
  odometer: string;
  liters: string;
  pricePerLiter: string;
  totalCost: string;
  isFullTank: boolean;
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
}
