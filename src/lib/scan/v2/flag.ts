/**
 * `scanV2` feature flag. A per-device choice (the A/B switch in Account),
 * default OFF. Deliberately local, not a synced user setting: it changes no
 * Firestore field or rule, and an experiment on one phone should not follow
 * the person to another device.
 */
export const SCAN_V2_STORAGE_KEY = 'tank-malle:scanV2';
export const SCAN_V2_EVENT = 'tank-malle:scanV2-change';

type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): KeyValue | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function readScanV2(storage: KeyValue | null = defaultStorage()): boolean {
  try { return storage?.getItem(SCAN_V2_STORAGE_KEY) === '1'; } catch { return false; }
}

/** Returns whether the value was stored; a blocked storage leaves the flag off. */
export function writeScanV2(on: boolean, storage: KeyValue | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    if (on) storage.setItem(SCAN_V2_STORAGE_KEY, '1'); else storage.removeItem(SCAN_V2_STORAGE_KEY);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SCAN_V2_EVENT));
    return true;
  } catch { return false; }
}

/** Notifies on changes from this tab (custom event) and other tabs (storage event). */
export function subscribeScanV2(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === SCAN_V2_STORAGE_KEY) listener(); };
  window.addEventListener(SCAN_V2_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(SCAN_V2_EVENT, listener); window.removeEventListener('storage', onStorage); };
}
