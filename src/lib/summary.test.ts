import { describe, expect, it } from 'vitest';
import { aggregateLedgerSummaries, aggregateSummaries, readUserSummary, summariseLedger, summaryChanged, type UserSummary, type VehicleSummary } from './summary';
import type { LedgerRow } from './vehicle/derived';

const now=new Date(2026,9,22,12).getTime();
const vehicle:VehicleSummary={fuelType:'95',fillups:2,trackedKm:300,liters:40,cost:300,kmPerLiter:15,segments:1,lastFillupAt:now,updatedAt:now};
const summary:UserSummary={version:1,vehicleCount:1,vehicles:{v:vehicle},updatedAt:now};
const row=(kind:LedgerRow['kind'],amountAgorot:number|null,day='2026-10-01')=>({kind,amountAgorot,day,financial:['fuel','service','expense'].includes(kind),notes:'private owner text',id:'private-record'} as LedgerRow);
describe('bounded operational summaries',()=>{
  it('keeps legacy fuel summaries readable without claiming detailed ledger coverage',()=>{
    const parsed=readUserSummary(summary)!;expect(parsed.vehicles.v.ledger).toBeUndefined();
    const totals=aggregateLedgerSummaries([parsed],now);expect(totals.counts.fuel).toBe(2);expect(totals.missingLedgers).toBe(1);expect(totals.months.every(m=>m.published===0)).toBe(true);
  });
  it('publishes coarse monthly costs, subtracting refunds once and retaining unknown costs',()=>{
    const ledger=summariseLedger([row('fuel',20000),row('service',50000),row('expense',-1000),row('expense',null),row('odometer',null)],now);
    expect(ledger.totalAgorot).toBe(69000);expect(ledger.unknownCosts).toBe(1);expect(ledger.counts).toMatchObject({fuel:1,service:1,expense:2,odometer:1});
    expect(ledger.months.at(-1)).toEqual({month:'2026-10',totalAgorot:69000,unknownCosts:1});
    expect(JSON.stringify(ledger)).not.toMatch(/private-record|private owner text/);
  });
  it('keeps the six calendar months ordered across a year boundary',()=>{
    const ledger=summariseLedger([row('expense',5000,'2025-12-31'),row('expense',1000,'2026-02-01')],new Date(2026,0,10,12).getTime());
    expect(ledger.months.map(m=>m.month)).toEqual(['2025-08','2025-09','2025-10','2025-11','2025-12','2026-01']);expect(ledger.months.at(-2)?.totalAgorot).toBe(5000);expect(ledger.months.at(-1)?.totalAgorot).toBe(0);
  });
  it('does not turn missing account or unopened vehicle summaries into full coverage',()=>{
    const data=aggregateLedgerSummaries([{...summary,vehicleCount:2},null],now);expect(data.missingVehicles).toBe(1);expect(data.ledgerVehicles).toBe(0);
    expect(aggregateSummaries([{uid:'a',summary},{uid:'b',summary:null}],now).withoutSummary).toBe(1);
  });
  it('republishes when maintenance changes while fuel figures stay the same, ignoring timestamp-only noise',()=>{
    const first={...vehicle,ledger:summariseLedger([row('service',10000)],now)};
    expect(summaryChanged(first,{...first,updatedAt:now+1000})).toBe(false);
    expect(summaryChanged(first,{...first,ledger:summariseLedger([row('service',12000)],now)})).toBe(true);
    expect(summaryChanged(vehicle,first)).toBe(true);
  });
  it.each([null,[],{...summary,version:'1'},{...summary,vehicleCount:101},{...summary,vehicles:[]},{...summary,vehicles:{v:{...vehicle,cost:Infinity}}},{...summary,vehicles:{v:{...vehicle,fillups:'2'}}}])('rejects malformed owner telemetry without exposing it to chart calculations',value=>{expect(readUserSummary(value)).toBeNull();});
  it('discards malformed detailed costs while retaining valid legacy fuel counts',()=>{
    const parsed=readUserSummary({...summary,vehicles:{v:{...vehicle,ledger:{counts:[],totalAgorot:'500',unknownCosts:0,months:[]}}}})!;
    expect(parsed.vehicles.v.ledger).toBeUndefined();expect(aggregateLedgerSummaries([parsed],now).records).toBe(2);
  });
  it('treats a vehicle id named __proto__ as data',()=>{
    const input=JSON.parse(JSON.stringify({...summary,vehicles:{['__proto__']:vehicle}}));const parsed=readUserSummary(input)!;expect(Object.keys(parsed.vehicles)).toEqual(['__proto__']);expect(aggregateLedgerSummaries([parsed],now).counts.fuel).toBe(2);
  });
});
