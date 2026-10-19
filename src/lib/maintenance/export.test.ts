import { expect,it } from 'vitest';
import { careBackup,readCareBackup,importPreview,careCostsCsv,careCalendar } from './export';
import { EMPTY_CARE,type CareData,type MaintenancePlan } from './model';
const data:CareData={...EMPTY_CARE,vehicleExpenses:[{id:'e',schemaVersion:1,version:3,title:'=SUM(A1)',day:'2026-10-01',costAgorot:null,notes:'שורה\nשנייה',category:'insurance'}]};
const plan:MaintenancePlan={id:'p',schemaVersion:1,version:1,title:'טיפול; שנתי, לרכב\nחדש',dueDay:'2027-01-31',dueOdometer:100000,intervalMonths:12,intervalKm:10000,basis:'completion',source:'owner',job:'oil',notes:'א'.repeat(100),active:true};
it('round trips a complete, scoped numeric backup and preserves unknown costs',()=>{
  const backup=readCareBackup(careBackup({id:'v',label:'רכב'},data,false));
  expect(backup.records).toEqual(data);expect(backup.incomplete).toBe(false);
  expect(importPreview(backup,EMPTY_CARE)).toMatchObject({duplicates:0,conflicts:0,additions:[{collection:'vehicleExpenses',record:{version:1,costAgorot:null}}]});
});
it('deduplicates repeated imports without overwriting a different record',()=>{
  const backup=readCareBackup(careBackup({id:'v',label:'רכב'},data,false));
  expect(importPreview(backup,data)).toEqual({duplicates:1,conflicts:0,additions:[]});
  expect(importPreview(backup,{...data,vehicleExpenses:[{...data.vehicleExpenses[0],costAgorot:100}]})).toEqual({duplicates:0,conflicts:1,additions:[]});
});
it('rejects future schema, duplicate ids, unknown fields and corrupt files',()=>{
  const json=careBackup({id:'v',label:'רכב'},data,false);
  for(const input of ['{',json.replace('"version": 1','"version": 2'),JSON.stringify({...JSON.parse(json),records:{...data,vehicleExpenses:[data.vehicleExpenses[0],data.vehicleExpenses[0]]}}),JSON.stringify({...JSON.parse(json),records:{...data,vehicleExpenses:[{...data.vehicleExpenses[0],photo:'pixels'}]}})]) expect(()=>readCareBackup(input)).toThrow();
});
it('CSV preserves Hebrew, commas, quoted text, null versus zero and literal formula prefixes',()=>{
  const csv=careCostsCsv({...data,vehicleExpenses:[...data.vehicleExpenses,{...data.vehicleExpenses[0],id:'z',costAgorot:0,title:'"ללא תשלום", אחריות'}]});
  expect(csv.startsWith('\uFEFF')).toBe(true);expect(csv).toContain("\"'=SUM(A1)\"");expect(csv).toContain('"0"');expect(csv).toContain('"""ללא תשלום"", אחריות"');
});
it('calendar uses date-only target, escaped text, short UTF-8 lines and no guessed mileage date',()=>{
  const ics=careCalendar('v',plan,EMPTY_CARE,new Date('2026-10-19T09:00:00Z'))!;
  expect(ics).toContain('DTSTART;VALUE=DATE:20270131');expect(ics).toContain('DTSTAMP:20261019T090000Z');expect(ics.replaceAll('\r\n ', '')).toContain('SUMMARY:טיפול\\; שנתי\\, לרכב\\nחדש');
  expect(ics.split('\r\n').every(line=>new TextEncoder().encode(line).length<=75)).toBe(true);
  expect(careCalendar('v',{...plan,dueDay:null,intervalMonths:null},EMPTY_CARE)).toBeNull();
});
