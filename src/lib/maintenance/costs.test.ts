import { expect,it } from 'vitest';
import { careCosts } from './costs';
import { EMPTY_CARE, type ServiceEvent } from './model';
import { parseFillupDocument } from '../fillupSerializer';
const service:ServiceEvent={id:'s',schemaVersion:1,version:1,day:'2026-10-01',title:'Invoice',jobs:['oil','tires','brakes'],odometer:null,costAgorot:50000,garage:'',notes:'',completedPlanIds:[]};
it('counts every invoice once across more than one UI page, subtracts refunds and separates unknown/zero',()=>{
  const result=careCosts({...EMPTY_CARE,serviceEvents:Array.from({length:120},(_,i)=>({...service,id:String(i)})),vehicleExpenses:[{id:'refund',schemaVersion:1,version:1,day:service.day,title:'Refund',category:'refund',costAgorot:10000,notes:''},{id:'unknown',schemaVersion:1,version:1,day:service.day,title:'Unknown',category:'other',costAgorot:null,notes:''},{id:'free',schemaVersion:1,version:1,day:service.day,title:'Free',category:'other',costAgorot:0,notes:''}]},[],'2026-01-01','2026-10-19',true);
  expect(result).toMatchObject({maintenance:6000000,refunds:10000,total:5990000,unknown:1,incomplete:true});
});
it('legacy missing fuel cost remains unknown, explicit zero remains known and date filtering is inclusive',()=>{
  const raw={date:new Date('2026-10-01T12:00:00').getTime(),odometer:1000,liters:10};
  const missing=parseFillupDocument('missing',raw),zero=parseFillupDocument('zero',{...raw,totalCost:0});
  if(!missing.ok||!zero.ok)throw new Error('fixture');
  expect(careCosts(EMPTY_CARE,[missing.fillup,zero.fillup],'2026-10-01','2026-10-01',false)).toMatchObject({unknown:1,total:0});
  expect(careCosts(EMPTY_CARE,[missing.fillup],'2026-10-02','2026-10-19',false).unknown).toBe(0);
});
