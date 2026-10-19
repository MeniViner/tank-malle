import { parseNumberInput } from '../numeric';
import { deriveReceipt, type ReceiptState } from '../receipt';

export interface ScanDraft { total: string; liters: string; odometer: string }
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
