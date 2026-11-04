import type { FuelType, Vehicle } from './types';
import type { TcoResult } from './tco';
import { benchmarkDocId, modelKey, MIN_PEERS } from './benchmarkIdentity';

export const COST_METHOD = 1;
export const COST_MAX_MONTHLY = 1_000_000;
export const COST_MAX_AGE_MS = 90 * 86400_000;
export interface CostBenchmark {
  vehicleId: string;
  modelKey: string;
  fuelType: FuelType;
  monthlyCost: number;
  months: number;
  method: 1;
}
export type CostPeer = CostBenchmark & { id: string; updatedAt: number };
export type CostComparison =
  | { kind: 'unavailable' }
  | { kind: 'insufficient'; peers: number; required: number }
  | { kind: 'ready'; peers: number; peerAverage: number; yourMonthly: number; differencePercent: number };

const positiveCost = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= COST_MAX_MONTHLY;
/** A full, settled estimate only; no component costs, receipts or identifiers of people/places. */
export function costBenchmark(vehicle: Vehicle, tco: TcoResult): CostBenchmark | null {
  const key = modelKey(vehicle);
  if (!tco.complete || !positiveCost(tco.month) || !Number.isInteger(tco.window) || tco.window < 1 || tco.window > 12
    || !key || key.length > 80 || !vehicle.id || vehicle.id.length > 64 || vehicle.archived || vehicle.deletionPending) return null;
  return { vehicleId: vehicle.id, modelKey: key, fuelType: vehicle.fuelType, monthlyCost: tco.month, months: tco.window, method: COST_METHOD };
}

/** Distinct other accounts, same model AND fuel, recent summaries of the same complete-cost method. */
export function compareCosts(uid: string, vehicle: Vehicle, yours: number | null, rows: readonly unknown[], now: number): CostComparison {
  if (!positiveCost(yours)) return { kind: 'unavailable' };
  const owners = new Map<string, CostPeer>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const peer = raw as CostPeer;
    if (peer.method !== COST_METHOD || peer.modelKey !== modelKey(vehicle) || peer.fuelType !== vehicle.fuelType
      || !positiveCost(peer.monthlyCost) || !Number.isInteger(peer.months) || peer.months < 1 || peer.months > 12
      || typeof peer.vehicleId !== 'string' || !peer.vehicleId || peer.vehicleId.length > 64 || typeof peer.id !== 'string'
      || !Number.isFinite(peer.updatedAt) || peer.updatedAt < now - COST_MAX_AGE_MS || peer.updatedAt > now + 300_000) continue;
    const suffix = `__${peer.vehicleId}`;
    if (!peer.id.endsWith(suffix)) continue;
    const owner = peer.id.slice(0, -suffix.length);
    if (!owner || owner === uid || benchmarkDocId(owner, peer.vehicleId) !== peer.id) continue;
    const previous = owners.get(owner);
    if (!previous || peer.updatedAt > previous.updatedAt || (peer.updatedAt === previous.updatedAt && peer.id < previous.id)) owners.set(owner, peer);
  }
  const peers = [...owners.values()];
  if (peers.length < MIN_PEERS) return { kind: 'insufficient', peers: peers.length, required: MIN_PEERS };
  const peerAverage = peers.reduce((sum, peer) => sum + peer.monthlyCost, 0) / peers.length;
  return { kind: 'ready', peers: peers.length, peerAverage, yourMonthly: yours, differencePercent: (yours - peerAverage) / peerAverage * 100 };
}
