import { expect, it } from 'vitest';
import { notificationPreferences } from './notificationPreferences';
import { reminderRows } from './derived';
import { EMPTY_CARE } from '../maintenance/model';
import { validVehicleRecord, vehiclePayload } from './model';

it('uses source defaults and accepts only the supported advance windows',()=>{
  expect(notificationPreferences({})).toMatchObject({leadDays:7,leadKm:1000,reminders:true,sync:true,prices:true});
  expect(notificationPreferences({reminderLeadDays:99,reminderLeadKm:NaN})).toMatchObject({leadDays:7,leadKm:1000});
  expect(notificationPreferences({reminderLeadDays:14,reminderLeadKm:2000,syncNotifications:false})).toMatchObject({leadDays:14,leadKm:2000,sync:false});
});
it('changes advance warnings without shifting deadlines, completion or occurrence identity',()=>{
  const care={...EMPTY_CARE,maintenancePlans:[{id:'p',schemaVersion:1 as const,version:1,title:'Oil',job:'oil' as const,dueDay:'2026-11-01',dueOdometer:null,intervalMonths:1,intervalKm:null,basis:'completion' as const,source:'owner' as const,notes:'',active:true}]};
  const short=reminderRows(care,[],'2026-10-22',{days:7,km:1000})[0],long=reminderRows(care,[],'2026-10-22',{days:14,km:1000})[0];
  expect(short.status).toBe('later');expect(long.status).toBe('soon');expect(short.due).toEqual(long.due);expect(short.occurrence).toBe(long.occurrence);
  expect(reminderRows(care,[],'2026-11-02',{days:1,km:500})[0].status).toBe('due');
});
it('preserves old state documents and stores deletion only as an occurrence tombstone',()=>{
  const old={id:'n',schemaVersion:1 as const,version:1,occurrence:'reminder:p:initial',read:true,archived:true,snoozeUntilDay:null};
  expect(validVehicleRecord('notificationStates',old)).toBe(true);expect(validVehicleRecord('notificationStates',{...old,deleted:true})).toBe(true);
  expect(vehiclePayload('notificationStates',{...old,version:2,deleted:true})).toMatchObject({occurrence:old.occurrence,deleted:true,archived:true});
  expect(validVehicleRecord('notificationStates',{...old,deleted:'true'})).toBe(false);expect(validVehicleRecord('notificationStates',{...old,deleted:true,costAgorot:5})).toBe(false);
});
