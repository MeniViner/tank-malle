import type { TankEstimateHandle } from "../../hooks/useTankEstimate";
import type { TankEstimate } from "../../lib/tank";

export type TankSheetEntry = "summary" | "gauge";

export interface TankHeroProps {
  estimate: TankEstimate;
  loading?: boolean;
  onOpen: (entry: TankSheetEntry) => void;
}

export interface TankSheetsProps {
  handle: TankEstimateHandle;
  entry: TankSheetEntry | null;
  enriching: boolean;
  onClose: () => void;
}
