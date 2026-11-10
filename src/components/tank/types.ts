import type { TankEstimateHandle } from "../../hooks/useTankEstimate";
import type { TankEstimate } from "../../lib/tank";

export type TankSheetEntry = "summary" | "gauge";

/**
 * The parts of the one Home estimate that the hero card reads. A full
 * TankEstimate satisfies it; onboarding passes static demo data of this shape.
 */
export interface TankHeroEstimate {
  available: boolean;
  current: Pick<TankEstimate["current"], "level" | "rawLevel" | "asOf">;
  lastLevelReport: TankEstimate["lastLevelReport"];
  reserveLevel: number;
  habit: Pick<TankEstimate["habit"], "canClaim" | "overridden" | "typicalLevel" | "mixed" | "low" | "high">;
  expectedRefuel: TankEstimate["expectedRefuel"];
  rangeToReserveKm: number | null;
  reasons: TankEstimate["reasons"];
}

export interface TankHeroProps {
  estimate: TankHeroEstimate;
  loading?: boolean;
  onOpen: (entry: TankSheetEntry) => void;
}

export interface TankSheetsProps {
  handle: TankEstimateHandle;
  entry: TankSheetEntry | null;
  enriching: boolean;
  onClose: () => void;
}
