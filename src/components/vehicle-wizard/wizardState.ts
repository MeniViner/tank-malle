import { parseDecimal } from "../../lib/format";
import type { FuelType, Vehicle } from "../../lib/types";
import type { VehicleSpecs } from "../../lib/vehicleSpecs";

export type WizardStep = "plate" | "confirm" | "extras";
export interface WizardDraft {
  make: string;
  model: string;
  year: string;
  fuelType: FuelType;
  plateNumber: string;
  fromRegistry: boolean;
  category?: string;
  tozeretCd?: number | null;
  degemCd?: number | null;
  engineCc?: number | null;
}
export const EMPTY_WIZARD_DRAFT: WizardDraft = {
  make: "", model: "", year: "", fuelType: "95", plateNumber: "",
  fromRegistry: false, tozeretCd: null, degemCd: null, engineCc: null,
};
export interface AuthoredNumber { readonly value: string; readonly authored: boolean }
export interface WizardNumbers { readonly tank: AuthoredNumber; readonly declared: AuthoredNumber }
export const emptyWizardNumbers = (): WizardNumbers => ({
  tank: { value: "", authored: false }, declared: { value: "", authored: false },
});
export const typeWizardNumber = (value: string): AuthoredNumber => ({ value, authored: true });
const positive = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** A typed value, including an explicit clear, belongs to the user. */
export function suggestWizardNumbers(current: WizardNumbers, specs: VehicleSpecs): WizardNumbers {
  return {
    tank: !current.tank.authored && positive(specs.trustedTankLiters)
      ? { value: String(specs.trustedTankLiters), authored: false } : current.tank,
    declared: !current.declared.authored && specs.declaredSource === "exact-year" && positive(specs.declaredKmPerLiter)
      ? { value: String(specs.declaredKmPerLiter), authored: false } : current.declared,
  };
}
/** Changing vehicle identity invalidates provider suggestions, not authored input. */
export function clearWizardSuggestions(current: WizardNumbers): WizardNumbers {
  return {
    tank: current.tank.authored ? current.tank : { value: "", authored: false },
    declared: current.declared.authored ? current.declared : { value: "", authored: false },
  };
}
export function wizardIdentity(draft: WizardDraft): string {
  return JSON.stringify([draft.make, draft.model, draft.year, draft.fuelType,
    draft.tozeretCd ?? null, draft.degemCd ?? null, draft.engineCc ?? null]);
}
export interface WizardErrors {
  make?: string; model?: string; year?: string;
  tank?: string; declared?: string; nickname?: string;
}
export function validateWizardDetails(draft: WizardDraft): WizardErrors {
  const errors: WizardErrors = {};
  if (!draft.make.trim()) errors.make = "חסר יצרן";
  else if (draft.make.trim().length > 60) errors.make = "שם היצרן ארוך מדי";
  if (draft.model.trim().length > 80) errors.model = "שם הדגם ארוך מדי";
  if (draft.year && (!/^\d{4}$/.test(draft.year) || Number(draft.year) < 1900 || Number(draft.year) > 2100)) {
    errors.year = "יש להזין שנה בין 1900 ל־2100";
  }
  return errors;
}
export function buildWizardVehicle(draft: WizardDraft, numbers: WizardNumbers, nickname: string, specs: VehicleSpecs | null):
  { ok: true; vehicle: Omit<Vehicle, "id" | "createdAt"> } | { ok: false; errors: WizardErrors } {
  const errors = validateWizardDetails(draft);
  const tankTyped = numbers.tank.value.trim() !== "";
  const declaredTyped = numbers.declared.value.trim() !== "";
  const tank = tankTyped ? parseDecimal(numbers.tank.value) : null;
  const declared = declaredTyped ? parseDecimal(numbers.declared.value) : null;
  if (tankTyped && !positive(tank)) errors.tank = "יש להזין נפח גדול מאפס, או להשאיר ריק";
  if (declaredTyped && !positive(declared)) errors.declared = "יש להזין נתון גדול מאפס, או להשאיר ריק";
  if (nickname.trim().length > 60) errors.nickname = "הכינוי ארוך מדי";
  if (Object.keys(errors).length) return { ok: false, errors };

  const estimate = !numbers.tank.authored && positive(specs?.suggestedTankLiters) ? specs.suggestedTankLiters : null;
  const exactDeclared = declaredTyped && specs?.declaredSource === "exact-year"
    && numbers.declared.value === String(specs.declaredKmPerLiter);
  // The existing enrichment policy preserves user-owned nulls after creation
  // and reload; an untouched missing value remains eligible for suggestions.
  return { ok: true, vehicle: {
    make: draft.make.trim(), model: draft.model.trim(), year: draft.year ? Number.parseInt(draft.year, 10) : null,
    plateNumber: draft.plateNumber || null, fuelType: draft.fuelType,
    tankLiters: tankTyped ? tank : estimate,
    tankLitersSource: tankTyped ? specs?.trustedTankLiters === tank ? "trusted" : "user" : numbers.tank.authored ? "user" : estimate !== null ? "estimate" : null,
    declaredKmPerLiter: declared,
    declaredSource: declaredTyped ? exactDeclared ? specs?.consumptionIsOfficial ? "exact-year" : "co2-estimate" : "user" : numbers.declared.authored ? "user" : null,
    tankSourceUrl: !tankTyped && numbers.tank.authored ? null : specs?.tankSourceUrl ?? null,
    specSourceUrl: !declaredTyped && numbers.declared.authored ? null : specs?.sourceUrl ?? null,
    priceAdjustment: 0, manualPricePerLiter: null, nickname: nickname.trim() || null, archived: false,
    tozeretCd: draft.tozeretCd ?? null, degemCd: draft.degemCd ?? null,
  } };
}
