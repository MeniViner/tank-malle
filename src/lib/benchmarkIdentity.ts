import type { Vehicle } from './types';

export const MIN_PEERS = 4;
export const BENCHMARK_SEPARATOR = '__';
export function benchmarkDocId(uid: string, vehicleId: string): string {
  return `${uid}${BENCHMARK_SEPARATOR}${vehicleId}`;
}
export function modelKey(vehicle: Pick<Vehicle, 'make' | 'model'>): string {
  return `${vehicle.make} ${vehicle.model}`.toLowerCase().replace(/\s+/g, ' ').trim();
}
