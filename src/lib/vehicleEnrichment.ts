import { toEpochMillis } from './fillupSerializer';
import type { Vehicle } from './types';
import type { MutationReceipt } from './writes';
import { orphanGroups, type OrphanGroup, type OutboxOperation, type OutboxPayload, type ReconcileVerdict } from './outbox';

const TANK = ['tankLiters', 'tankLitersSource', 'tankSourceUrl'] as const;
const CONSUMPTION = ['declaredKmPerLiter', 'declaredSource', 'specSourceUrl'] as const;
const REGISTRY = ['tozeretCd', 'degemCd'] as const;
const ALLOWED = new Set<string>([...TANK, ...CONSUMPTION, ...REGISTRY]);
const IDENTITY = ['make', 'model', 'year', 'plateNumber', 'fuelType', ...REGISTRY] as const;
const has = (value: OutboxPayload, key: string) => Object.hasOwn(value, key);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 9_999_999_999;
const optionalUrl = (value: OutboxPayload, key: string) => !has(value, key) || value[key] === null || (typeof value[key] === 'string' && value[key].length <= 2000);

/**
 * This compact, generated-only patch is reserved for automatic missing-spec
 * enrichment. Explicit vehicle editing includes the vehicle identity fields;
 * a capacity confirmation carries source "user". Neither is classified here.
 * Keeping the distinction in the existing payload makes recovery possible
 * without inventing a new journal kind or writing internal flags to Firestore.
 */
export function isVehicleEnrichmentPatch(payload: OutboxPayload | null): payload is OutboxPayload {
  if (!payload || !Object.keys(payload).length || Object.keys(payload).some(key => !ALLOWED.has(key))) return false;
  const tank = TANK.some(key => has(payload, key));
  const consumption = CONSUMPTION.some(key => has(payload, key));
  if (tank && (!has(payload, 'tankLiters') || !has(payload, 'tankLitersSource') || !positive(payload.tankLiters) || payload.tankLitersSource !== 'trusted' || !optionalUrl(payload, 'tankSourceUrl'))) return false;
  if (consumption && (!has(payload, 'declaredKmPerLiter') || !has(payload, 'declaredSource') || !positive(payload.declaredKmPerLiter) ||
      (payload.declaredSource !== 'exact-year' && payload.declaredSource !== 'co2-estimate') || !optionalUrl(payload, 'specSourceUrl'))) return false;
  if (REGISTRY.some(key => has(payload, key) && (!positive(payload[key]) || !Number.isInteger(payload[key])))) return false;
  return tank || consumption || REGISTRY.some(key => has(payload, key));
}

export function isVehicleEnrichmentOperation(op: OutboxOperation): boolean {
  if (typeof op.uid !== 'string' || !op.uid || typeof op.vehicleId !== 'string' || !op.vehicleId) return false;
  const path = `users/${op.uid}/vehicles/${op.vehicleId}`;
  return op.kind === 'vehicle.update' && op.opType === 'update' &&
    !op.uid.includes('/') && !op.vehicleId.includes('/') && op.path === path &&
    op.docId === op.vehicleId && op.docKey === `${op.uid}|${path}` && isVehicleEnrichmentPatch(op.payload);
}

/** A conditional no-op never supersedes an unrelated manual vehicle update. */
export function recoveryGroupsWithVehicleEnrichment(operations: readonly OutboxOperation[]): OrphanGroup[] {
  return [
    ...orphanGroups(operations.filter(op => !isVehicleEnrichmentOperation(op))),
    ...operations.filter(op => op.status === 'pending' && isVehicleEnrichmentOperation(op))
      .map(newest => ({ newest, superseded: [] })),
  ];
}

function readableIdentity(value: OutboxPayload): boolean {
  return ['make', 'model', 'fuelType'].every(key => has(value, key)) && typeof value.make === 'string' && !!value.make && typeof value.model === 'string' &&
    typeof value.fuelType === 'string' && ['95', '98', 'diesel', 'other'].includes(value.fuelType) &&
    (value.year == null || (typeof value.year === 'number' && Number.isFinite(value.year))) &&
    (value.plateNumber == null || typeof value.plateNumber === 'string') &&
    REGISTRY.every(key => value[key] == null || (positive(value[key]) && Number.isInteger(value[key])));
}

/** Only identity defaults used by the public vehicle reader are normalized. */
export function vehicleSpecIdentityMatches(a: OutboxPayload, b: OutboxPayload): boolean {
  return readableIdentity(a) && readableIdentity(b) &&
    IDENTITY.every(key => (a[key] ?? null) === (b[key] ?? null)) &&
    (toEpochMillis(a.createdAt) ?? 0) === (toEpochMillis(b.createdAt) ?? 0);
}

/** A missing field and an explicitly cleared null are different before-images. */
function sameGroup(before: OutboxPayload, server: OutboxPayload, keys: readonly string[]): boolean {
  return keys.every(key => has(before, key) === has(server, key) && before[key] === server[key]);
}

export type VehicleEnrichmentDecision =
  | { state: 'unverified' }
  | { state: 'complete' }
  | { state: 'update'; patch: OutboxPayload };

/**
 * An automatic suggestion may fill only an unchanged missing group. A newly
 * entered value, a user-owned null, a changed source/URL, or a different car
 * identity makes that suggestion obsolete. This is also the replay policy.
 */
export function vehicleEnrichmentDecision(
  payload: OutboxPayload | null,
  before: OutboxPayload | null,
  server: OutboxPayload | null,
): VehicleEnrichmentDecision {
  if (!isVehicleEnrichmentPatch(payload) || !before || !readableIdentity(before)) return { state: 'unverified' };
  if (!server || server.deletionPending === true || server.archived === true || !vehicleSpecIdentityMatches(before, server)) return { state: 'complete' };
  const patch: OutboxPayload = {};
  const include = (keys: readonly string[], source?: string) => {
    const primary = keys[0];
    if (!has(payload, primary) || before[primary] != null || server[primary] != null ||
        (source && (before[source] === 'user' || server[source] === 'user')) || !sameGroup(before, server, keys)) return;
    for (const key of keys) if (has(payload, key)) patch[key] = payload[key];
  };
  include(TANK, 'tankLitersSource');
  include(CONSUMPTION, 'declaredSource');
  for (const key of REGISTRY) include([key]);
  return Object.keys(patch).length ? { state: 'update', patch } : { state: 'complete' };
}

/** Read-only recovery: an obsolete suggestion is complete; nothing is resent. */
export function vehicleEnrichmentVerdict(op: OutboxOperation, server: OutboxPayload | null): ReconcileVerdict {
  const decision = vehicleEnrichmentDecision(op.payload, op.beforeImage, server);
  const identity = { opId: op.opId, version: op.version };
  if (decision.state === 'complete') return { ...identity, verdict: 'synced' };
  return {
    ...identity,
    verdict: 'unconfirmed',
    reason: decision.state === 'unverified'
      ? 'לא ניתן לאמת את מפרט הרכב המקורי — ההצעה לא הוחלה'
      : 'השלמת מפרט הרכב לא אושרה — אפשר לנסות שוב',
  };
}


/** Listener object replacement is not a new lookup. Only the account/car's
 * semantic identity and which groups remain eligible own the effect lifetime. */
export function vehicleEnrichmentRequestKey(uid: string | null | undefined, vehicle: Vehicle | null): string | null {
  if (!uid || !vehicle) return null;
  const tankMissing = !vehicle.tankLiters && vehicle.tankLitersSource !== 'user';
  const consumptionMissing = !vehicle.declaredKmPerLiter && vehicle.declaredSource !== 'user';
  if (!tankMissing && !consumptionMissing) return null;
  return JSON.stringify([uid, vehicle.id, ...IDENTITY.map(key => vehicle[key] ?? null),
    toEpochMillis(vehicle.createdAt) ?? 0, tankMissing, consumptionMissing]);
}

/** Cancellation is not a verified obsolete proposal. Rejecting preserves its
 * durable journal row instead of acknowledging an empty transaction as a save. */
export async function readCurrentVehicleEnrichmentDecision(
  payload: OutboxPayload | null, before: OutboxPayload | null,
  readServer: () => Promise<OutboxPayload | null>, stillCurrent: () => boolean,
): Promise<VehicleEnrichmentDecision> {
  const assertCurrent = () => {
    if (!stillCurrent()) throw Object.assign(new Error('השלמת מפרט הרכב הופסקה לפני אימות השמירה'), {
      code: 'vehicle-enrichment-cancelled',
    });
  };
  assertCurrent();
  const server = await readServer();
  assertCurrent();
  return vehicleEnrichmentDecision(payload, before, server);
}

/** Durable acceptance alone cannot consume a lookup attempt. */
export async function vehicleEnrichmentSettled(receipt: MutationReceipt | null, stillCurrent: () => boolean): Promise<boolean> {
  return !!receipt && await receipt.settled && stillCurrent();
}
