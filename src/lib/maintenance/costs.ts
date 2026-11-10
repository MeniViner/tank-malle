import type {Fillup} from '../types';
import {localDay,type CareData} from './model';
import {financialTotals} from '../vehicle/financial';
import {countsTowardOwnership,isExcludedRecord} from '../vehicle/ownership';
/** Legacy care exports share the same financial rules as the unified journal.
 * Ownership totals: an excluded expense is reported only in excludedAgorot/excludedCount. */
export function careCosts(data:CareData,fillups:Fillup[],from:string,to:string,incomplete:boolean) {
  const within=(day:string)=>day>=from&&day<=to;
  const rows=[...fillups.filter(r=>within(localDay(new Date(r.date)))).map(r=>({kind:'fuel',financial:true,amountAgorot:r.totalCostUnknown?null:Math.round(r.totalCost*100)})),
    ...data.serviceEvents.filter(r=>within(r.day)).map(r=>({kind:'service',financial:true,amountAgorot:r.costAgorot})),
    ...data.vehicleExpenses.filter(r=>within(r.day)).map(r=>({kind:'expense',financial:true,excluded:isExcludedRecord(r),amountAgorot:r.costAgorot===null?null:r.costAgorot*(r.category==='refund'?-1:1)}))];
  const {excludedAgorot,excludedCount}=financialTotals(rows);
  return {...financialTotals(rows.filter(countsTowardOwnership)),excludedAgorot,excludedCount,incomplete};
}
