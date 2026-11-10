import { useSyncExternalStore } from 'react';
import { readScanV2, subscribeScanV2, writeScanV2 } from '../../../lib/scan/v2/flag';

/** The per-device scanV2 flag (default off) and its setter. */
export function useScanV2(): [boolean, (on: boolean) => boolean] {
  const on = useSyncExternalStore(subscribeScanV2, () => readScanV2(), () => false);
  return [on, writeScanV2];
}
