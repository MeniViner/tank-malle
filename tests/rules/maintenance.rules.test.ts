import { readFileSync } from 'node:fs';
import { beforeAll,afterAll,beforeEach,describe,it } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc,setDoc,getDoc,updateDoc,deleteDoc } from 'firebase/firestore';
let env: RulesTestEnvironment;
beforeAll(async()=>{env=await initializeTestEnvironment({projectId:'demo-tank-care-rules',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8')}});},60000);
afterAll(async()=>{await env?.cleanup();});
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'users/alice/vehicles/v'),{make:'Test',model:'Car',fuelType:'95',archived:false,priceAdjustment:0});});});
const service = {schemaVersion:1,version:1,title:'טיפול',day:'2026-10-19',jobs:['oil','tires'],costAgorot:123456,odometer:120000,garage:'מוסך',notes:'',completedPlanIds:['oil']};
const plan = {schemaVersion:1,version:1,title:'טיפול הבא',job:'oil',dueDay:'2027-10-19',dueOdometer:130000,intervalMonths:12,intervalKm:10000,basis:'completion',source:'owner',notes:'',active:true};
const expense = {schemaVersion:1,version:1,title:'ביטוח',day:'2026-10-19',category:'insurance',costAgorot:0,notes:''};
const mileage = {schemaVersion:1,version:1,day:'2026-10-19',odometer:120000,notes:''};
const path=(collection:string)=>`users/alice/vehicles/v/${collection}/r`;
const owner=()=>env.authenticatedContext('alice').firestore();
describe('private Spark care records',()=>{
  for(const [collection,payload] of Object.entries({serviceEvents:service,maintenancePlans:plan,vehicleExpenses:expense,odometerReadings:mileage})) {
    it(`${collection}: owner CRUD; nobody else including admin can read/write`,async()=>{
      const ref=doc(owner(),path(collection)); await assertSucceeds(setDoc(ref,payload)); await assertSucceeds(getDoc(ref));
      await assertSucceeds(updateDoc(ref,{version:2,notes:'תיקון'}));
      await assertFails(updateDoc(ref,{version:2,notes:'stale'}));
      for(const context of [env.authenticatedContext('bob'),env.authenticatedContext('root',{admin:true}),env.unauthenticatedContext()]) {
        const foreign=doc(context.firestore(),path(collection)); await assertFails(getDoc(foreign));await assertFails(setDoc(foreign,payload));await assertFails(deleteDoc(foreign));
      }
      await assertSucceeds(deleteDoc(ref));
    });
    it(`${collection}: rejects photo/model/extra fields and creation with stale revision`,async()=>{
      await assertFails(setDoc(doc(owner(),path(collection)),{...payload,photo:'data:image/png;base64,secret'}));
      await assertFails(setDoc(doc(owner(),path(collection)),{...payload,version:2}));
    });
    it(`${collection}: refuses writes during account deletion`,async()=>{
      await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'users/alice'),{deletionPending:true});});
      await assertFails(setDoc(doc(owner(),path(collection)),payload));
    });
  }
  it('distinguishes unknown and zero cost; rejects fractions, negatives and invalid categories',async()=>{
    for(const costAgorot of [null,0,123]) await assertSucceeds(setDoc(doc(owner(),`users/alice/vehicles/v/serviceEvents/c${costAgorot}`),{...service,costAgorot}));
    for(const patch of [{costAgorot:-1},{costAgorot:1.2},{odometer:-1},{odometer:123.5},{jobs:['unknown']},{completedPlanIds:['a/b']},{notes:'x'.repeat(2001)}]) await assertFails(setDoc(doc(owner(),path('serviceEvents')),{...service,...patch}));
  });
  it('requires a target and a positive compatible interval',async()=>{
    for(const patch of [{dueDay:null,dueOdometer:null},{intervalMonths:0},{intervalKm:-1},{dueOdometer:null,intervalKm:10000},{basis:'AI'}]) await assertFails(setDoc(doc(owner(),path('maintenancePlans')),{...plan,...patch}));
  });
});

it('cannot create or update care under a missing or deleting vehicle, and deletion locks cannot be cleared',async()=>{
  await assertSucceeds(setDoc(doc(owner(),path('vehicleExpenses')),expense));
  await assertSucceeds(updateDoc(doc(owner(),'users/alice/vehicles/v'),{deletionPending:true,archived:true}));
  await assertFails(updateDoc(doc(owner(),path('vehicleExpenses')),{version:2,costAgorot:500}));
  await assertFails(setDoc(doc(owner(),path('serviceEvents')),service));
  await assertFails(updateDoc(doc(owner(),'users/alice/vehicles/v'),{deletionPending:false}));
  await assertSucceeds(deleteDoc(doc(owner(),path('vehicleExpenses'))));
  await assertSucceeds(deleteDoc(doc(owner(),'users/alice/vehicles/v')));
  await assertFails(setDoc(doc(owner(),path('serviceEvents')),service));
});
