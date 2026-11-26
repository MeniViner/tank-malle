import type { FuelType } from '../stats';

export type ChangeSource = 'manual' | 'scheduled' | 'import';
export type PriceChange = {
  fuel: FuelType; before: number | null; after: number;
  oldSource: ChangeSource | null; newSource: ChangeSource; at: number;
};

export function priceChange(fuel: FuelType, series: { current?: { pricePerLiter: number } | null; source?: ChangeSource } | undefined,
  after: number, newSource: ChangeSource, at: number): PriceChange | null {
  const before = series?.current?.pricePerLiter ?? null;
  const oldSource = series?.source ?? null;
  if (!(Number.isFinite(after) && after > 0) || (before === after && oldSource === newSource)) return null;
  return { fuel, before, after, oldSource, newSource, at };
}
