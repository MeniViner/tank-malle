import { parseDecimal } from "../../lib/format";
import type { FuelType, Vehicle } from "../../lib/types";
import type { VehicleSpecs } from "../../lib/vehicleSpecs";
import { EV_LIMITS, evFieldsForCreation, readPowertrain, type Powertrain } from "../../lib/vehicle/v3Fields";

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
  /** Design v3: from the plate registry ("ev" for a battery-electric car). */
  powertrain?: Powertrain | null;
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
/**
 * EV battery figures the owner types on the confirm step. The ministry
 * registers carry no battery capacity or WLTP range, so these are the owner's
 * own (optional) values; a sourced supplement may prefill them, never overwrite.
 */
export interface WizardBattery { readonly kwh: AuthoredNumber; readonly wltp: AuthoredNumber }
export const emptyWizardBattery = (): WizardBattery => ({ kwh: { value: "", authored: false }, wltp: { value: "", authored: false } });
/** A typed value, including an explicit clear, belongs to the user. */
export function suggestWizardBattery(current: WizardBattery, specs: VehicleSpecs): WizardBattery {
  const kwh = specs.battery?.kwh, wltp = specs.battery?.wltp;
  return {
    kwh: !current.kwh.authored && positive(kwh) ? { value: String(kwh), authored: false } : current.kwh,
    wltp: !current.wltp.authored && positive(wltp) ? { value: String(wltp), authored: false } : current.wltp,
  };
}
export function clearWizardBatterySuggestions(current: WizardBattery): WizardBattery {
  return {
    kwh: current.kwh.authored ? current.kwh : { value: "", authored: false },
    wltp: current.wltp.authored ? current.wltp : { value: "", authored: false },
  };
}
/** Battery-electric as confirmed on the wizard: the draft (registry or the owner's choice), else the spec lookup. */
export function wizardIsEv(draft: WizardDraft, specs: VehicleSpecs | null): boolean {
  return (readPowertrain(draft.powertrain) ?? readPowertrain(specs?.powertrain)) === "ev";
}
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
    draft.tozeretCd ?? null, draft.degemCd ?? null, draft.engineCc ?? null, draft.powertrain ?? null]);
}
export interface WizardErrors {
  make?: string; model?: string; year?: string;
  tank?: string; declared?: string; nickname?: string;
  batteryKwh?: string; batteryWltp?: string;
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
const BATTERY_ERRORS = {
  kwh: "יש להזין קיבולת בין 0.1 ל־500 kWh, או להשאיר ריק",
  wltp: "יש להזין טווח בין 1 ל־2,000 ק״מ, או להשאיר ריק",
} as const;
const inRange = (value: number | null, [low, high]: readonly [number, number]) =>
  value !== null && Number.isFinite(value) && value >= low && value <= high;
/** Exact typed values (never rounded); null when blank. Errors only for a typed, out-of-range value. */
function parseWizardBattery(battery: WizardBattery): { kwh: number | null; wltp: number | null; errors: WizardErrors } {
  const errors: WizardErrors = {};
  const kwh = battery.kwh.value.trim() ? parseDecimal(battery.kwh.value) : null;
  const wltp = battery.wltp.value.trim() ? parseDecimal(battery.wltp.value) : null;
  if (battery.kwh.value.trim() && !inRange(kwh, EV_LIMITS.kwh)) errors.batteryKwh = BATTERY_ERRORS.kwh;
  if (battery.wltp.value.trim() && !inRange(wltp, EV_LIMITS.wltp)) errors.batteryWltp = BATTERY_ERRORS.wltp;
  return { kwh, wltp, errors };
}
/** Confirm-step validation: identity details, plus the battery figures for an EV. */
export function validateWizardConfirm(draft: WizardDraft, specs: VehicleSpecs | null, battery: WizardBattery): WizardErrors {
  return { ...validateWizardDetails(draft), ...(wizardIsEv(draft, specs) ? parseWizardBattery(battery).errors : {}) };
}
export function buildWizardVehicle(draft: WizardDraft, numbers: WizardNumbers, nickname: string, specs: VehicleSpecs | null,
  battery: WizardBattery = emptyWizardBattery()):
  { ok: true; vehicle: Omit<Vehicle, "id" | "createdAt"> } | { ok: false; errors: WizardErrors } {
  const isEv = wizardIsEv(draft, specs);
  const typedBattery = isEv ? parseWizardBattery(battery) : null;
  const errors = { ...validateWizardDetails(draft), ...typedBattery?.errors };
  // A battery-electric car has no tank and no litre consumption: the extras
  // step hides those fields, and nothing typed earlier is stored for it.
  const tankTyped = !isEv && numbers.tank.value.trim() !== "";
  const declaredTyped = !isEv && numbers.declared.value.trim() !== "";
  const tank = tankTyped ? parseDecimal(numbers.tank.value) : null;
  const declared = declaredTyped ? parseDecimal(numbers.declared.value) : null;
  if (tankTyped && !positive(tank)) errors.tank = "יש להזין נפח גדול מאפס, או להשאיר ריק";
  if (declaredTyped && !positive(declared)) errors.declared = "יש להזין נתון גדול מאפס, או להשאיר ריק";
  if (nickname.trim().length > 60) errors.nickname = "הכינוי ארוך מדי";
  if (Object.keys(errors).length) return { ok: false, errors };

  // The owner's battery figures are stored exactly as typed (an explicit clear
  // stays empty); an untouched blank keeps the sourced supplement, if any.
  // The registers themselves have no kWh/range.
  const ev = evFieldsForCreation({
    powertrain: isEv ? "ev" : readPowertrain(draft.powertrain) ?? specs?.powertrain, motorKw: specs?.motorKw,
    battery: typedBattery ? {
      kwh: battery.kwh.authored ? typedBattery.kwh : typedBattery.kwh ?? specs?.battery?.kwh ?? null,
      wltp: battery.wltp.authored ? typedBattery.wltp : typedBattery.wltp ?? specs?.battery?.wltp ?? null,
    } : null,
  });
  // A battery-electric car has no fuel tank: never store a body-type litre estimate for it.
  const estimate = ev.powertrain !== "ev" && !numbers.tank.authored && positive(specs?.suggestedTankLiters) ? specs.suggestedTankLiters : null;
  const exactDeclared = declaredTyped && specs?.declaredSource === "exact-year"
    && numbers.declared.value === String(specs.declaredKmPerLiter);
  // The existing enrichment policy preserves user-owned nulls after creation
  // and reload; an untouched missing value remains eligible for suggestions.
  return { ok: true, vehicle: {
    make: draft.make.trim(), model: draft.model.trim(), year: draft.year ? Number.parseInt(draft.year, 10) : null,
    plateNumber: draft.plateNumber || null, fuelType: draft.fuelType,
    tankLiters: tankTyped ? tank : estimate,
    tankLitersSource: tankTyped ? specs?.trustedTankLiters === tank ? "trusted" : "user" : !isEv && numbers.tank.authored ? "user" : estimate !== null ? "estimate" : null,
    declaredKmPerLiter: declared,
    declaredSource: declaredTyped ? exactDeclared ? specs?.consumptionIsOfficial ? "exact-year" : "co2-estimate" : "user" : !isEv && numbers.declared.authored ? "user" : null,
    tankSourceUrl: isEv || (!tankTyped && numbers.tank.authored) ? null : specs?.tankSourceUrl ?? null,
    specSourceUrl: isEv || (!declaredTyped && numbers.declared.authored) ? null : specs?.sourceUrl ?? null,
    priceAdjustment: 0, manualPricePerLiter: null, nickname: nickname.trim() || null, archived: false,
    tozeretCd: draft.tozeretCd ?? null, degemCd: draft.degemCd ?? null,
    ...ev,
  } };
}
