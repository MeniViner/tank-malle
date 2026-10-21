import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {initializeTestEnvironment,assertSucceeds,assertFails,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,deleteDoc} from 'firebase/firestore';
let env:RulesTestEnvironment;
beforeAll(async()=>{env=await initializeTestEnvironment({projectId:'demo-unified-vehicle-rules',firestore:{host:'127.0.0.1',port:Number(process.env.RULES_FIRESTORE_PORT??8080),rules:readFileSync('firestore.rules','utf8')}});},60000);
afterAll(async()=>{await env?.cleanup();});beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'users/alice/vehicles/v'),{make:'X',model:'Y',fuelType:'95',archived:false,priceAdjustment:0});});});
const issue={schemaVersion:1,version:1,day:'2026-10-21',title:'Braking noise',symptoms:'Under braking',odometer:120000,importance:'important',status:'open',notes:'',serviceEventIds:['s'],history:[]};
const state={schemaVersion:1,version:1,occurrence:'reminder:p:2026-10-01',read:true,archived:false,snoozeUntilDay:null};
for(const [name,value] of [['vehicleIssues',issue],['notificationStates',state]] as const){
  it(`${name} is private even from an administrator, versioned and bounded`,async()=>{const path=`users/alice/vehicles/v/${name}/r`,ref=doc(env.authenticatedContext('alice').firestore(),path);await assertSucceeds(setDoc(ref,value));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),path)));await assertFails(getDoc(doc(env.authenticatedContext('bob').firestore(),path)));await assertFails(getDoc(doc(env.authenticatedContext('admin',{admin:true}).firestore(),path)));
    await assertFails(setDoc(ref,value));await assertSucceeds(setDoc(ref,{...value,version:2}));await assertFails(setDoc(ref,{...value,version:3,photo:'pixels'}));await assertSucceeds(deleteDoc(ref));
  });
  it(`${name} cannot be created under a missing or deleting vehicle/account`,async()=>{const db=env.authenticatedContext('alice').firestore();await assertFails(setDoc(doc(db,`users/alice/vehicles/missing/${name}/r`),value));await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'users/alice/vehicles/v'),{deletionPending:true},{merge:true});});await assertFails(setDoc(doc(db,`users/alice/vehicles/v/${name}/r`),value));await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'users/alice'),{deletionPending:true});});await assertFails(setDoc(doc(db,`users/alice/vehicles/v/${name}/r`),value));});
}
it('validates largest supported issue history within the expression budget and rejects hidden costs/foreign links',async()=>{const ref=doc(env.authenticatedContext('alice').firestore(),'users/alice/vehicles/v/vehicleIssues/r');const maximum={...issue,serviceEventIds:Array.from({length:8},(_,i)=>'service-'+i),history:Array.from({length:10},()=>JSON.stringify({day:'2026-10-21',status:'watching',note:'Follow-up'}))};await assertSucceeds(setDoc(ref,maximum));for(const patch of [{costAgorot:5},{serviceEventIds:['x/y']},{history:[{day:'bad',status:'watching',note:''}]},{status:'green'}])await assertFails(setDoc(ref,{...issue,...patch,version:2}));expect((await getDoc(ref)).data()?.version).toBe(1);});
