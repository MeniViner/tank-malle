import type { DisplayKind, DisplayReading, ScanContext } from './engine';
import { PRICE_MAX, PRICE_MIN } from './engine/read';

import prompt from './cloudPrompt.json';
export const SCAN_MODEL = prompt.model;

export function parseCloudReading(kind: DisplayKind, text: string, context: ScanContext): DisplayReading | null {
  let fields: Record<string, unknown>;
  try { fields = JSON.parse(text); } catch { return null; }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  if (kind === 'odometer') {
    const { odometer } = fields;
    if (typeof odometer !== 'string' || !/^\d{1,7}$/.test(odometer)) return null;
    const km = Number(odometer), last = context.lastOdometer;
    if (!km || km >= 3_000_000 || (last && (km < last || km > last + 5000))) return null;
    return { odometer: String(km) };
  }
  const { total, liters, price } = fields;
  if (typeof total !== 'string' || !/^\d{1,5}\.\d{2}$/.test(total) ||
      typeof liters !== 'string' || !/^\d{1,3}\.\d{2,3}$/.test(liters)) return null;
  const amount = Number(total), volume = Number(liters), implied = amount / volume;
  if (!volume || volume > 500 || (context.tankCapacity && volume > context.tankCapacity * 1.05) ||
      implied < PRICE_MIN || implied > PRICE_MAX) return null;
  if (price !== null && (typeof price !== 'string' || !/^\d{1,2}\.\d{2}$/.test(price))) return null;
  const unitPrice = price === null ? Math.round(implied * 100) / 100 : Number(price);
  const rounding = 0.005 + unitPrice * 0.5 * 10 ** -(liters.length - liters.indexOf('.') - 1);
  if (unitPrice < PRICE_MIN || unitPrice > PRICE_MAX || Math.abs(amount - volume * unitPrice) > rounding + 1e-8) return null;
  return { total, liters };
}
