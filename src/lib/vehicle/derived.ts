import {financialTotals} from "./financial";
import type { Fillup } from '../types';
import type { TankObservation } from '../tank/types';
import { localDay, nextDue, dueStatus, type CareData, type CareCollection } from '../maintenance/model';
import type { ExtraData, VehicleCollection, VehicleRecord } from './model';
export interface MileageEvidence { id:string; source:'fillups'|'observations'|'serviceEvents'|'odometerReadings'; day:string; at:number|null; odometer:number }
export interface LedgerRow { key:string; id:string; collection:VehicleCollection|'fillups'|'observations'; kind:'fuel'|'service'|'expense'|'odometer'|'tank'|'issue'; day:string; at:number|null; title:string; notes:string; amountAgorot:number|null; financial:boolean; odometer:number|null; record:VehicleRecord|Fillup|TankObservation }
export function mileageEvidence(fillups: Fillup[], observations: TankObservation[], care: CareData): MileageEvidence[] {
  return [...fillups.map(r=>({id:r.id,source:'fillups' as const,day:localDay(new Date(r.date)),at:r.date,odometer:r.odometer})),
    ...observations.filter(r=>r.odometer!=null).map(r=>({id:r.id,source:'observations' as const,day:localDay(new Date(r.observedAt)),at:r.observedAt,odometer:r.odometer!})),
    ...care.odometerReadings.map(r=>({id:r.id,source:'odometerReadings' as const,day:r.day,at:null,odometer:r.odometer})),
    ...care.serviceEvents.filter(r=>r.odometer!==null).map(r=>({id:r.id,source:'serviceEvents' as const,day:r.day,at:null,odometer:r.odometer!}))]
    .filter(r=>Number.isFinite(r.odometer) && (r.at===null || Number.isFinite(r.at))).sort((a,b)=>a.day.localeCompare(b.day) || (a.at!==null && b.at!==null ? a.at-b.at : a.odometer-b.odometer) || a.id.localeCompare(b.id));
}
export function currentMileage(evidence: MileageEvidence[], today: string) {
  const rows=evidence.filter(r=>r.day<=today);const day=rows.at(-1)?.day;if(!day)return null;
  const same=rows.filter(r=>r.day===day);const uncertain=same.some(r=>r.at===null) && new Set(same.map(r=>r.odometer)).size>1;
  const ordered=same.every(r=>r.at!==null) ? [...same].sort((a,b)=>b.at!-a.at!) : [...same].sort((a,b)=>b.odometer-a.odometer);
  return {...ordered[0],ambiguous:uncertain,minimum:Math.min(...same.map(r=>r.odometer)),maximum:Math.max(...same.map(r=>r.odometer))};
}
export function buildLedger(fillups: Fillup[], observations: TankObservation[], care: CareData, extra: ExtraData): LedgerRow[] {
  const rows: LedgerRow[] = fillups.map(r=>({key:`fillups/${r.id}`,id:r.id,collection:'fillups',kind:'fuel',day:localDay(new Date(r.date)),at:r.date,title:r.station?.name || 'תדלוק',notes:r.notes||'',amountAgorot:r.totalCostUnknown?null:Math.round(r.totalCost*100),financial:true,odometer:r.odometer,record:r}));
  for(const collection of ['serviceEvents','vehicleExpenses','odometerReadings'] as const) for(const r of care[collection]) rows.push({key:`${collection}/${r.id}`,id:r.id,collection,kind:collection==='serviceEvents'?'service':collection==='vehicleExpenses'?'expense':'odometer',day:r.day,at:null,title:'title' in r?r.title:'עדכון קילומטראז׳',notes:r.notes,amountAgorot:'costAgorot' in r && r.costAgorot!==null?r.costAgorot*('category' in r&&r.category==='refund'?-1:1):null,financial:'costAgorot' in r,odometer:'odometer' in r?r.odometer:null,record:r});
  for(const r of observations) rows.push({key:`observations/${r.id}`,id:r.id,collection:'observations',kind:r.kind==='odometer'?'odometer':'tank',day:localDay(new Date(r.observedAt)),at:r.observedAt,title:r.kind==='odometer'?'עדכון קילומטראז׳':'עדכון מצב המיכל',notes:'',amountAgorot:null,financial:false,odometer:r.odometer??null,record:r});
  for(const r of extra.vehicleIssues) rows.push({key:`vehicleIssues/${r.id}`,id:r.id,collection:'vehicleIssues',kind:'issue',day:r.day,at:null,title:r.title,notes:r.symptoms+' '+r.notes,amountAgorot:null,financial:false,odometer:r.odometer,record:r});
  return rows.sort((a,b)=>b.day.localeCompare(a.day) || (a.at!==null&&b.at!==null?b.at-a.at:0) || a.key.localeCompare(b.key));
}
export function periodSummary(rows: LedgerRow[], evidence: MileageEvidence[], from:string,to:string,incomplete=false) {
  const selected=rows.filter(r=>r.day>=from && r.day<=to);const financial=selected.filter(r=>r.financial);
  const totals=financialTotals(selected);
  const points=evidence.filter(r=>r.day>=from && r.day<=to);const firstDay=points[0]?.day,lastDay=points.at(-1)?.day;
  const first=points.filter(r=>r.day===firstDay),last=points.filter(r=>r.day===lastDay);
  const ambiguous=first.some(r=>r.at===null)&&new Set(first.map(r=>r.odometer)).size>1 || last.some(r=>r.at===null)&&new Set(last.map(r=>r.odometer)).size>1;
  const start=first.filter(r=>r.at!==null).sort((a,b)=>a.at!-b.at!)[0]??first[0];const end=last.filter(r=>r.at!==null).sort((a,b)=>b.at!-a.at!)[0]??last.at(-1);
  const distance=start&&end&&start.day<end.day&&!ambiguous&&end.odometer>start.odometer ? end.odometer-start.odometer : null;
  // Ratios use ONLY costs inside the measured interval, with exact-time boundaries when available.
  const covered=distance!==null ? financial.filter(r=>r.day>=start.day&&r.day<=end.day && (r.day!==start.day || start.at===null || r.at!==null&&r.at>=start.at) && (r.day!==end.day || end.at===null || r.at!==null&&r.at<=end.at)) : [];
  const boundaryUnknown=financial.some(r=>(r.day===start?.day||r.day===end?.day)&&r.at===null) && (start?.at!==null || end?.at!==null);

  const continuityMissing=!!start&&!!end&&selected.some(r=>r.kind==='fuel'&&r.id!==start.id&&(r.record as Fillup).continuityBreakBefore&&r.day>=start.day&&r.day<=end.day);
  const ratiosKnown=distance!==null&&!incomplete&&!boundaryUnknown&&!continuityMissing&&covered.every(r=>r.amountAgorot!==null);
  return {...totals,incomplete,count:selected.length,financialCount:financial.length,distance,fromDay:start?.day??null,toDay:end?.day??null,ambiguous,boundaryUnknown,continuityMissing,
    costPerKm:ratiosKnown?covered.reduce((s,r)=>s+r.amountAgorot!,0)/100/distance!:null,
    fuelPerKm:ratiosKnown?covered.filter(r=>r.kind==='fuel').reduce((s,r)=>s+r.amountAgorot!,0)/100/distance!:null,
};
}
export function reminderRows(care: CareData, evidence: MileageEvidence[], today: string) {
  const mileage=currentMileage(evidence,today);
  return care.maintenancePlans.map(plan=>{const due=nextDue(plan,care.serviceEvents,today);const status=mileage?.ambiguous && due.odometer!==null && mileage.minimum<due.odometer && mileage.maximum>=due.odometer && !(due.day&&due.day<=today) ? 'unknown' : dueStatus(due,mileage,today);
    // Completion identity is included even if manual recurrence keeps the same target.
    const last=care.serviceEvents.filter(e=>e.day<=today&&e.completedPlanIds.includes(plan.id)).sort((a,b)=>b.day.localeCompare(a.day)||(b.odometer??-1)-(a.odometer??-1)||a.id.localeCompare(b.id))[0];
    const cycle=last?`${last.id}:${last.day}:${last.odometer??'-'}`:'initial';
    const occurrence=`reminder:${plan.id}:${due.day??'-'}:${due.odometer??'-'}:${cycle}`;
    return {plan,due,status,occurrence}; });
}
export const careCollection = (name: string): name is CareCollection => ['serviceEvents','vehicleExpenses','odometerReadings','maintenancePlans'].includes(name);
