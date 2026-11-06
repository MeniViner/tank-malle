import { parseNumberInput } from '../numeric';
import { deriveReceipt, type ReceiptState } from '../receipt';
import type { DisplayReading } from './automaticDisplay';

export interface ScanDraft { total: string; liters: string; odometer: string }
export type ScanField = keyof ScanDraft;
export interface AcceptedScanDraft { draft: ScanDraft; acceptedFields: ScanField[] }

/**
 * An automatic prefill is replaceable; only an authored field is protected.
 * Record acceptance even when OCR agrees with a prefill so the form can make
 * that receipt value authoritative instead of repricing it later.
 */
export function acceptScanReading(
  current: AcceptedScanDraft,
  reading: DisplayReading,
  protectedFields: readonly ScanField[],
): AcceptedScanDraft {
  const draft = { ...current.draft };
  const acceptedFields = new Set(current.acceptedFields);
  for (const key of ['total', 'liters', 'odometer'] as const) {
    if (!(key in reading) || protectedFields.includes(key)) continue;
    draft[key] = (reading as Partial<ScanDraft>)[key]!;
    acceptedFields.add(key);
  }
  return { draft, acceptedFields: [...acceptedFields] };
}

/** Only called after the review screen. Photo recognition never writes a record. */
export function reviewedScan(draft: ScanDraft): { receipt: ReceiptState; odometer: string } | null {
  const total = parseNumberInput(draft.total, 'money').value;
  const liters = parseNumberInput(draft.liters, 'liters').value;
  const odometer = parseNumberInput(draft.odometer, 'odometer').value;
  if (!(total > 0 && total <= 50000 && liters > 0 && liters <= 500 &&
    total / liters <= 100 && Number.isInteger(odometer) && odometer > 0 && odometer < 3000000)) return null;
  return { receipt: deriveReceipt({ totalCost: String(total), liters: String(liters), pricePerLiter: '',
    authored: ['totalCost', 'liters'] }), odometer: String(odometer) };
}
