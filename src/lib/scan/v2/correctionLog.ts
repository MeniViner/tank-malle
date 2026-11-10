/**
 * On-device scan correction log: what the recogniser proposed and what the
 * person confirmed, kept as a training set. Stored in IndexedDB on this device
 * only. It is never synced, never uploaded, and not part of the account
 * export; the person exports it explicitly as a JSON file.
 *
 * Each entry may carry a small 1-bit thumbnail of the guide-box crop (at most
 * 192×96, black and white), not the photograph.
 */
import type { ScanKind } from './guide';

export type CorrectionField = 'total' | 'liters' | 'price' | 'odometer';
export type CorrectionEntry = {
  id?: number;
  at: string;
  kind: ScanKind;
  field: CorrectionField;
  /** The value the verification screen proposed ('' when nothing was read). */
  recognised: string;
  /** The value the person confirmed. */
  confirmed: string;
  changed: boolean;
  confidence: number | null;
  top3: string[];
  digitConfidences: number[];
  /** Constraint checks that failed for the proposal. */
  failedChecks: string[];
  thumbnail?: { width: number; height: number; bits: string };
};

export const CORRECTION_DB = 'tank-malle-scan-v2';
const STORE = 'corrections';
/** Bounded: oldest entries are dropped past this many. */
export const MAX_CORRECTIONS = 2000;

let memory: CorrectionEntry[] | null = null;
let memoryId = 0;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const request = indexedDB.open(CORRECTION_DB, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>, fallback: () => T): Promise<T> {
  const db = await open();
  if (!db) return fallback();
  try {
    const tx = db.transaction(STORE, mode);
    const result = await run(tx.objectStore(STORE));
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
    return result;
  } finally { db.close(); }
}

export async function logCorrections(entries: CorrectionEntry[]): Promise<void> {
  if (!entries.length) return;
  await withStore('readwrite', async store => {
    for (const entry of entries) { const { id: _ignored, ...rest } = entry; void _ignored; store.add(rest); }
    const count = await done(store.count());
    if (count > MAX_CORRECTIONS) {
      const keys = await done(store.getAllKeys(null, count - MAX_CORRECTIONS));
      for (const key of keys) store.delete(key);
    }
  }, () => {
    memory ??= [];
    for (const entry of entries) memory.push({ ...entry, id: ++memoryId });
    if (memory.length > MAX_CORRECTIONS) memory.splice(0, memory.length - MAX_CORRECTIONS);
  });
}

export function listCorrections(): Promise<CorrectionEntry[]> {
  return withStore('readonly', store => done(store.getAll()) as Promise<CorrectionEntry[]>, () => [...(memory ?? [])]);
}

export function countCorrections(): Promise<number> {
  return withStore('readonly', store => done(store.count()), () => memory?.length ?? 0);
}

export function clearCorrections(): Promise<void> {
  return withStore('readwrite', async store => { await done(store.clear()); }, () => { memory = []; });
}

export const CORRECTION_EXPORT_FORMAT = 'tank-malle-scan-corrections-v1';

/** JSON for training; the file never leaves the device unless the person shares it. */
export async function exportCorrections(now = new Date()): Promise<string> {
  const entries = await listCorrections();
  return JSON.stringify({
    format: CORRECTION_EXPORT_FORMAT,
    exportedAt: now.toISOString(),
    note: 'Scan v2 proposals and the values confirmed on this device. Thumbnails are 1-bit, row-major, base64.',
    count: entries.length,
    entries,
  }, null, 1);
}

/** Packs a crop into a ≤192×96 1-bit thumbnail (bright = 1) for the log. */
export function thumbnail(crop: { width: number; height: number; data: ArrayLike<number> }, max = { width: 192, height: 96 }): CorrectionEntry['thumbnail'] {
  const r = Math.min(1, max.width / crop.width, max.height / crop.height);
  const width = Math.max(1, Math.round(crop.width * r)), height = Math.max(1, Math.round(crop.height * r));
  const lumas = new Float32Array(width * height);
  let sum = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(crop.width - 1, Math.floor(x / r)), sy = Math.min(crop.height - 1, Math.floor(y / r)), i = (sy * crop.width + sx) * 4;
    const l = .299 * crop.data[i] + .587 * crop.data[i + 1] + .114 * crop.data[i + 2];
    lumas[y * width + x] = l; sum += l;
  }
  const mean = sum / lumas.length, bytes = new Uint8Array(Math.ceil(lumas.length / 8));
  lumas.forEach((l, i) => { if (l > mean) bytes[i >> 3] |= 1 << (7 - (i & 7)); });
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return { width, height, bits: btoa(binary) };
}

/** Test helper: forget the in-memory fallback. */
export function resetMemoryForTests() { memory = null; memoryId = 0; }
