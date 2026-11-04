import { validDay } from '../maintenance/model';

export const VEHICLE_DOC_KEYS = ['test', 'mandatory', 'coverage'] as const;
export type VehicleDocKey = typeof VEHICLE_DOC_KEYS[number];
export type VehicleCoverage = 'comprehensive' | 'third' | 'none';
export const VEHICLE_DOC_TITLES: Record<VehicleDocKey, string> = {
  test: 'טסט שנתי', mandatory: 'ביטוח חובה', coverage: 'ביטוח רכב',
};
export const VEHICLE_COVERAGE_LABELS: Record<VehicleCoverage, string> = {
  comprehensive: 'מקיף', third: 'צד ג׳', none: 'אין',
};
export const VEHICLE_DOC_INSURER_MAX = 160;
export const VEHICLE_DOC_COST_MAX = 1_000_000;
export const VEHICLE_DOC_FIELDS: Record<VehicleDocKey, readonly string[]> = {
  test: ['due', 'cost'], mandatory: ['insurer', 'due', 'cost'], coverage: ['type', 'insurer', 'due', 'cost'],
};

export interface VehicleDocValues {
  test: { due?: string | null; cost?: number | null };
  mandatory: { insurer?: string | null; due?: string | null; cost?: number | null };
  coverage: { type?: VehicleCoverage | null; insurer?: string | null; due?: string | null; cost?: number | null };
}
export type VehicleDocChanges<K extends VehicleDocKey = VehicleDocKey> = Partial<VehicleDocValues[K]>;
export type VehicleDocEmptyKind = 'missing-docs' | 'null-docs' | 'missing-document' | 'null-document';
export type VehicleDocView<K extends VehicleDocKey = VehicleDocKey> =
  | { state: 'absent'; key: K; emptyKind: VehicleDocEmptyKind; values: Readonly<VehicleDocValues[K]>; due: null; daysLeft: null }
  | { state: 'ready'; key: K; values: Readonly<VehicleDocValues[K]>; due: string | null; daysLeft: number | null }
  | { state: 'unavailable'; key: K; reason: 'container' | 'document' | 'fields'; invalidFields: readonly string[]; due: null; daysLeft: null };

declare const vehicleDocumentBrand: unique symbol;
/** A runtime-registered provider token; copying these fields does not grant authority. */
export interface VehicleDocumentSnapshot<K extends VehicleDocKey = VehicleDocKey> {
  readonly vehicleId: string;
  readonly key: K;
  readonly [vehicleDocumentBrand]: K;
}

/** Firestore Timestamp/GeoPoint/Reference/Bytes are objects, but are not maps. */
export function isVehicleDocMap(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function validVehicleDocDay(value: unknown): value is string { return validDay(value); }

export function civilDaysBetween(from: string, to: string): number | null {
  if (!validVehicleDocDay(from) || !validVehicleDocDay(to)) return null;
  return (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000;
}

export function validVehicleDocField(key: VehicleDocKey, field: string, value: unknown): boolean {
  if (!VEHICLE_DOC_FIELDS[key].includes(field)) return false;
  if (value === null) return true;
  if (field === 'due') return validVehicleDocDay(value);
  if (field === 'insurer') return typeof value === 'string' && value.length <= VEHICLE_DOC_INSURER_MAX;
  if (field === 'cost') return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= VEHICLE_DOC_COST_MAX;
  return field === 'type' && (value === 'comprehensive' || value === 'third' || value === 'none');
}

/** Validate explicit known intent only; never trim, default or clean other leaves. */
export function validVehicleDocChanges(key: VehicleDocKey, changes: unknown): changes is Record<string, unknown> {
  return isVehicleDocMap(changes) && Object.keys(changes).length > 0 &&
    Object.entries(changes).every(([field, value]) => validVehicleDocField(key, field, value));
}

export function readVehicleDocument<K extends VehicleDocKey>(docs: unknown, key: K, today: string): VehicleDocView<K> {
  const absent = (emptyKind: VehicleDocEmptyKind): VehicleDocView<K> => ({
    state: 'absent', key, emptyKind, values: {} as Readonly<VehicleDocValues[K]>, due: null, daysLeft: null,
  });
  const unavailable = (reason: 'container' | 'document' | 'fields', invalidFields: readonly string[] = []): VehicleDocView<K> => ({
    state: 'unavailable', key, reason, invalidFields, due: null, daysLeft: null,
  });
  if (docs === undefined) return absent('missing-docs');
  if (docs === null) return absent('null-docs');
  if (!isVehicleDocMap(docs)) return unavailable('container');
  if (!Object.hasOwn(docs, key)) return absent('missing-document');
  const selected = docs[key];
  if (selected === null) return absent('null-document');
  if (!isVehicleDocMap(selected)) return unavailable('document');
  const fields = VEHICLE_DOC_FIELDS[key].filter(field => Object.hasOwn(selected, field));
  const invalidFields = fields.filter(field => !validVehicleDocField(key, field, selected[field]));
  if (invalidFields.length) return unavailable('fields', invalidFields);
  const values = Object.freeze(Object.fromEntries(fields.map(field => [field, selected[field]]))) as Readonly<VehicleDocValues[K]>;
  const due = key === 'coverage' && selected.type === 'none' ? null :
    typeof selected.due === 'string' ? selected.due : null;
  return { state: 'ready', key, values, due, daysLeft: due === null ? null : civilDaysBetween(today, due) };
}
