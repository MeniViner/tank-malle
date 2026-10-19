import type { CareCollection, CareRecord } from './model';
export function careDraftKey(uid: string, vehicle: string, collection: CareCollection, record = 'new'): string {
  return `tm.care-draft.v1.${encodeURIComponent(uid)}.${encodeURIComponent(vehicle)}.${collection}.${encodeURIComponent(record)}`;
}
export interface CareDraft { fields: Record<string, unknown>; base: CareRecord | null }
export function readCareDraft(key: string): CareDraft | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (saved?.version !== 1 || !Number.isFinite(saved.at) || Date.now() - saved.at > 30 * 86400000 ||
      !saved.data?.fields || typeof saved.data.fields !== 'object' || Array.isArray(saved.data.fields)) return null;
    return saved.data;
  } catch { return null; }
}
export function writeCareDraft(key: string, data: CareDraft): boolean {
  try { localStorage.setItem(key, JSON.stringify({ version: 1, at: Date.now(), data })); return true; }
  catch { return false; }
}
export function removeCareDraft(key: string): boolean {
  try { localStorage.removeItem(key); return true; } catch { return false; }
}
