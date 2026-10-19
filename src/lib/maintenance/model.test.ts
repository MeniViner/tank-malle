import { describe, expect, it } from 'vitest';
import { addMonths, nextDue, dueStatus, validCareRecord, latestMileage, type MaintenancePlan, type ServiceEvent } from './model';
const plan: MaintenancePlan = { id:'oil',schemaVersion:1,version:1,title:'שמן',job:'oil',dueDay:'2026-01-31',dueOdometer:100000,intervalMonths:12,intervalKm:10000,basis:'completion',source:'manufacturer',notes:'',active:true };
const event: ServiceEvent = { id:'e',schemaVersion:1,version:1,title:'טיפול',day:'2026-03-15',odometer:101200,costAgorot:80000,garage:'',jobs:['oil','tires'],notes:'',completedPlanIds:['oil'] };
describe('maintenance facts and deadlines',()=>{
  it('clamps calendar months including leap years',()=>{expect(addMonths('2024-01-31',1)).toBe('2024-02-29');expect(addMonths('2026-01-31',1)).toBe('2026-02-28');});
  it('uses completed measurements and recalculates after deletion',()=>{
    expect(nextDue(plan,[event])).toEqual({day:'2027-03-15',odometer:111200,completed:false});
    expect(nextDue(plan,[])).toEqual({day:'2026-01-31',odometer:100000,completed:false});
  });
  it('does not move fixed manufacturer milestones after a late completion',()=>{
    expect(nextDue({...plan,basis:'fixed'},[event])).toEqual({day:'2027-01-31',odometer:110000,completed:false});
  });
  it('never resets another task from a generic category match',()=>{expect(nextDue({...plan,id:'brakes'},[event]).odometer).toBe(100000);});
  it('unknown mileage is not zero and either threshold triggers due',()=>{
    const due={day:'2027-01-01',odometer:110000,completed:false};
    expect(dueStatus(due,null,'2026-10-19')).toBe('unknown');
    expect(dueStatus(due,{odometer:110001,day:'2026-10-10'},'2026-10-19')).toBe('due');
    expect(dueStatus({...due,day:'2026-10-01'},null,'2026-10-19')).toBe('due');
    expect(dueStatus(due,{odometer:100000,day:'2026-01-01'},'2026-10-19')).toBe('unknown');
  });
  it('preserves unknown versus free costs and rejects impossible values',()=>{
    expect(validCareRecord('serviceEvents',{...event,costAgorot:null})).toBe(true);
    expect(validCareRecord('serviceEvents',{...event,costAgorot:0})).toBe(true);
    for(const patch of [{costAgorot:-1},{costAgorot:1.2},{day:'2026-02-30'},{odometer:100.5},{completedPlanIds:['a/b']},{jobs:[]}]) expect(validCareRecord('serviceEvents',{...event,...patch})).toBe(false);
  });
  it('does not invent a recurring mileage target without measured completion mileage',()=>{expect(nextDue(plan,[{...event,odometer:null}]).odometer).toBeNull();});
  it('ignores future readings and preserves zero',()=>{expect(latestMileage([{day:'2026-10-19',odometer:0},{day:'2026-11-01',odometer:300}], '2026-10-19')?.odometer).toBe(0);});
});
it('a missing completion mileage keeps a recurring distance reminder unknown even with a future date',()=>{
  const due=nextDue(plan,[{...event,odometer:null}]);
  expect(due.needsMileage).toBe(true);
  expect(dueStatus(due,{day:'2026-10-19',odometer:90000},'2026-10-19')).toBe('unknown');
});
it('quarantines future schema fields instead of dropping them on edit',()=>{
  expect(validCareRecord('serviceEvents',{...event,photo:'pixels'})).toBe(false);
  expect(validCareRecord('maintenancePlans',{...plan,schemaVersion:2})).toBe(false);
});

it('editing a linked invoice updates only explicitly completed reminders and deletion rolls back',()=>{
  const other={...plan,id:'tires'};
  const edited={...event,day:'2026-04-01',odometer:102000};
  expect(nextDue(plan,[edited],'2026-10-19')).toMatchObject({day:'2027-04-01',odometer:112000});
  expect(nextDue(other,[edited],'2026-10-19')).toMatchObject({day:other.dueDay,odometer:other.dueOdometer});
  expect(nextDue(plan,[],'2026-10-19')).toMatchObject({day:plan.dueDay,odometer:plan.dueOdometer});
});
it('an already crossed distance stays due even if stale, while absent measurements never imply later',()=>{
  const due={day:'2027-12-01',odometer:100000,completed:false};
  expect(dueStatus(due,{day:'2026-01-01',odometer:100001},'2026-10-19')).toBe('due');
  expect(dueStatus(due,null,'2026-10-19')).toBe('unknown');
  expect(dueStatus({...due,day:'2026-10-19'},null,'2026-10-19')).toBe('due');
});
