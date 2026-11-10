/**
 * "לכלול בעלות הרכב" — the single ownership predicate.
 *
 * An expense the owner switched off (`excluded: true`) stays in the journal and
 * in the journal's own totals (tagged "לא בעלות הרכב"), but it is not a cost of
 * owning the car: TCO, per-km figures, spending averages, the spending chart,
 * the by-month table, the business statement total and every shared/community
 * summary leave it out. Every aggregate asks this module; nothing re-implements
 * the check.
 *
 * Only expenses can be excluded. Fuel and service rows always count.
 */

/** Hebrew tag shown on an excluded journal row and as the statement group title. */
export const EXCLUDED_LABEL = 'לא בעלות הרכב';

/** A raw stored record (VehicleExpense or anything else). Missing field = included. */
export function isExcludedRecord(record: unknown): boolean {
  return !!record && typeof record === 'object' && (record as { excluded?: unknown }).excluded === true;
}

/** Anything aggregated: ledger rows, financial rows, or raw records. */
export interface OwnershipCandidate { kind?: string; excluded?: boolean; record?: unknown }

/** True when the row is an expense the owner left out of the vehicle's ownership cost. */
export function isExcludedFromOwnership(row: OwnershipCandidate): boolean {
  if (row.kind !== undefined && row.kind !== 'expense') return false;
  return row.excluded === true || isExcludedRecord(row.record);
}

/** The predicate every ownership aggregate filters with. */
export function countsTowardOwnership(row: OwnershipCandidate): boolean {
  return !isExcludedFromOwnership(row);
}

export function ownershipRows<T extends OwnershipCandidate>(rows: readonly T[]): T[] {
  return rows.filter(countsTowardOwnership);
}
