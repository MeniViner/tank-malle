/**
 * Release 1.8.0 carried an experimental scanner that could keep a correction
 * log on the device (IndexedDB `tank-malle-scan-v2`, with small black-and-white
 * crops of pump displays) and a per-device switch. Both are gone; this removes
 * what they may have left behind.
 */
export const LEGACY_SCAN_DB = 'tank-malle-scan-v2', LEGACY_SCAN_FLAG = 'tank-malle:scanV2';

export function deleteLegacyScanData(): Promise<void> {
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_SCAN_FLAG); } catch { /* Storage may be unavailable; the database below is what matters. */ }
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LEGACY_SCAN_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('scan-data-delete-failed'));
    // Another tab still has it open: it is deleted when that tab closes.
    request.onblocked = () => resolve();
  });
}
