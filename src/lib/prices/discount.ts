import type { Vehicle } from '../stats';

export interface FuelDiscount { kind: 'amount' | 'percent'; value: number }

export function validFuelDiscount(value: unknown): value is FuelDiscount {
  if (!value || typeof value !== 'object') return false;
  const rule = value as FuelDiscount;
  return (rule.kind === 'amount' || rule.kind === 'percent') &&
    Number.isFinite(rule.value) && rule.value >= 0 && rule.value <= (rule.kind === 'percent' ? 100 : 20);
}

/** A stored absolute price is never converted into an invented discount. */
export function vehicleDiscount(vehicle: Pick<Vehicle, 'priceAdjustment' | 'priceDiscount'> | null | undefined): FuelDiscount | null {
  if (vehicle?.priceDiscount !== undefined) return validFuelDiscount(vehicle.priceDiscount) ? vehicle.priceDiscount : null;
  const delta = vehicle?.priceAdjustment;
  return typeof delta === 'number' && Number.isFinite(delta) && delta < 0
    ? { kind: 'amount', value: -delta } : null;
}

export function discountedPrice(official: number, rule: FuelDiscount | null): number {
  const discount = rule ? rule.kind === 'percent' ? official * rule.value / 100 : rule.value : 0;
  return Math.round(Math.max(0, official - discount) * 1000) / 1000;
}

export function discountLabel(rule: FuelDiscount | null): string {
  return rule && rule.value > 0 ? rule.kind === 'percent'
    ? `${rule.value}% הנחה מהמחיר הרשמי`
    : `${rule.value.toFixed(2)} ₪ הנחה לליטר מהמחיר הרשמי` : 'ללא הנחה';
}
