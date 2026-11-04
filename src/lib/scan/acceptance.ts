import { decimals } from './identity';

/**
 * Extra conditions for values the camera fills in WITHOUT a person typing
 * them. The review form keeps its own, unchanged limits for typed values.
 * These checks only reject; they never repair, round or complete a number.
 */
export function automaticPumpPlausible({ total, liters }: { total: string; liters: string }) {
  if (!/^\d{1,5}\.\d{2}$/.test(total) || !/^\d{1,3}\.\d{2,3}$/.test(liters) || decimals(total) !== 2) return false;
  const amount = Number(total), volume = Number(liters);
  if (!(amount > 0 && amount <= 50000 && volume > 0 && volume <= 500)) return false;
  // A broad physical band for any road fuel, including LPG. A swapped pair
  // (₪26.092 for 202.73 L) implies 0.13 ₪/L and is refused here.
  const paid = amount / volume;
  return paid >= 1 && paid <= 40;
}
export function automaticOdometerPlausible(odometer: string) {
  return /^\d{1,7}$/.test(odometer) && Number(odometer) < 3_000_000;
}
