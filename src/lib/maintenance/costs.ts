import type { Fillup } from '../types';
import { localDay, type CareData } from './model';

/** Aggregate source collections, never the paginated/filtered history view. */
export function careCosts(data: CareData, fillups: Fillup[], from: string, to: string, incomplete: boolean) {
  const within = (day: string) => day >= from && day <= to;
  const services = data.serviceEvents.filter(row => within(row.day));
  const expenses = data.vehicleExpenses.filter(row => within(row.day));
  const fuelRows = fillups.filter(row => Number.isFinite(row.date) && within(localDay(new Date(row.date))));
  const sum = (rows: { costAgorot: number | null }[]) => rows.reduce((total, row) => total + (row.costAgorot ?? 0), 0);
  const fuel = fuelRows.reduce((total, row) => total + (row.totalCostUnknown ? 0 : Math.round(row.totalCost * 100)), 0);
  const maintenance = sum(services);
  const other = sum(expenses.filter(row => row.category !== 'refund'));
  const refunds = sum(expenses.filter(row => row.category === 'refund'));
  const unknown = [...services, ...expenses].filter(row => row.costAgorot === null).length + fuelRows.filter(row=>row.totalCostUnknown).length;
  return { fuel, maintenance, other, refunds, unknown, incomplete, total: fuel + maintenance + other - refunds };
}
