import { validDay } from './maintenance/model';
import { isVehicleDocMap, VEHICLE_DOC_COST_MAX, type VehicleDocKey } from './vehicle/documents';
import type { LedgerRow } from './vehicle/derived';

export type TcoPartId = 'fuel' | 'service' | 'mandatory' | 'coverage' | 'test' | 'other';
export interface TcoPart {
  id: TcoPartId;
  label: string;
  /** Unknown component totals remain unknown, including partially priced history. */
  value: number | null;
  /** Available subtotal, retained without pretending it prices unknown records. */
  knownValue: number;
  docKey?: VehicleDocKey;
}
export interface TcoResult {
  parts: TcoPart[];
  month: number | null;
  year: number | null;
  missing: TcoPart[];
  window: number;
  windowStart: string;
  perKm: number | null;
  complete: boolean;
  lowerBound: boolean;
  fuelThisMonth: number | null;
}
export interface TcoInput {
  ledger: readonly LedgerRow[];
  docs: unknown;
  today: string;
  kmPerDay: number | null;
  incomplete?: boolean;
}

const monthIndex = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
function documentCost(docs: unknown, key: VehicleDocKey): number | null {
  const row = isVehicleDocMap(docs) ? docs[key] : null;
  const cost = isVehicleDocMap(row) ? row.cost : null;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 && cost <= VEHICLE_DOC_COST_MAX ? cost : null;
}
function category(row: LedgerRow): string | null {
  return row.kind === 'expense' && 'category' in row.record ? row.record.category : null;
}
function amount(row: LedgerRow): number | null {
  if (row.kind === 'fuel' && 'totalCost' in row.record) {
    const cost = row.record.totalCost;
    return row.record.totalCostUnknown || !Number.isFinite(cost) || cost < 0 ? null : cost;
  }
  return row.amountAgorot !== null && Number.isFinite(row.amountAgorot) ? row.amountAgorot / 100 : null;
}

/** Read-only ownership estimate. No date clock, rounding, writes, or SDK dependencies. */
export function calculateTco({ ledger, docs, today, kmPerDay, incomplete = false }: TcoInput): TcoResult {
  if (!validDay(today)) throw new TypeError('TCO requires a valid civil day');
  const history = ledger.filter(row => validDay(row.day) && row.day <= today);
  const first = history.reduce((day, row) => row.day < day ? row.day : day, today);
  const window = Math.min(12, Math.max(1, monthIndex(today) - monthIndex(first) + 1));
  const start = monthIndex(today) - window + 1;
  const windowStart = `${Math.floor(start / 12)}-${String(start % 12 + 1).padStart(2, '0')}-01`;
  const rows = history.filter(row => row.day >= windowStart);
  const mandatory = documentCost(docs, 'mandatory');
  const test = documentCost(docs, 'test');
  const coverageRow = isVehicleDocMap(docs) && isVehicleDocMap(docs.coverage) ? docs.coverage : null;
  const coverageType = coverageRow?.type;
  const insured = coverageType === 'comprehensive' || coverageType === 'third';
  const coverage = coverageType === 'none' ? 0 : insured ? documentCost(docs, 'coverage') : null;
  // An explicit absence of optional cover must not hide a mandatory-insurance invoice.
  const hasInsuranceDocumentCost = mandatory !== null || (insured && coverage !== null);
  let knownRecords = 0;
  let unknownRefund = false;
  const variable = (id: 'fuel' | 'service' | 'other', label: string, include: (row: LedgerRow) => boolean): TcoPart => {
    const selected = rows.filter(include);
    let known = 0;
    let unknown = incomplete;
    for (const row of selected) {
      const value = amount(row);
      if (value === null) { unknown = true; if (category(row) === 'refund') unknownRefund = true; }
      else { known += value; knownRecords++; }
    }
    return { id, label, value: unknown ? null : known / window, knownValue: known / window };
  };
  const fixed = (id: 'mandatory' | 'coverage' | 'test', label: string, annual: number | null): TcoPart =>
    ({ id, label, value: annual === null ? null : annual / 12, knownValue: annual === null ? 0 : annual / 12, docKey: id });
  const parts = [
    variable('fuel', 'דלק', row => row.kind === 'fuel'),
    variable('service', 'טיפולים ותיקונים', row => row.kind === 'service'),
    fixed('mandatory', 'ביטוח חובה', mandatory),
    fixed('coverage', coverageType === 'comprehensive' ? 'ביטוח מקיף' : coverageType === 'third' ? 'ביטוח צד ג׳' : 'ביטוח רכב', coverage),
    fixed('test', 'טסט ואגרת רישוי', test),
    variable('other', 'חניה, אגרות ושאר', row => row.kind === 'expense'
      && !(category(row) === 'insurance' && hasInsuranceDocumentCost)
      && !(category(row) === 'registration' && test !== null)),
  ];
  const missing = parts.filter(part => part.value === null);
  const hasKnownCost = knownRecords > 0 || mandatory !== null || test !== null || (insured && coverage !== null);
  const month = hasKnownCost ? parts.reduce((sum, part) => sum + part.knownValue, 0) : null;
  const currentFuel = rows.filter(row => row.kind === 'fuel' && row.day.slice(0, 7) === today.slice(0, 7));
  const fuelThisMonth = incomplete || !history.some(row => row.kind === 'fuel') || currentFuel.some(row => amount(row) === null) ? null
    : currentFuel.reduce((sum, row) => sum + amount(row)!, 0);
  return { parts, month, year: month === null ? null : month * 12, missing, window, windowStart,
    perKm: month !== null && kmPerDay !== null && Number.isFinite(kmPerDay) && kmPerDay > 0 ? month / (kmPerDay * 30.4) : null,
    complete: !missing.length && history.some(row => row.kind === 'fuel'), lowerBound: !incomplete && !unknownRefund, fuelThisMonth };
}
