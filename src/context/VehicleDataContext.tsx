/* oxlint-disable react/only-export-components -- A context provider and its consumer hook share the same private context. */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, onSnapshot, type QuerySnapshot, type DocumentData } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { subscribeResilient } from '../lib/subscribeResilient';
import { useAuth } from './AuthContext';
import { useData } from './DataContext';
import { useMaintenance } from '../hooks/useMaintenance';
import { localDay, type MaintenancePlan } from '../lib/maintenance/model';
import { EXTRA_COLLECTIONS, decodeVehicleRecord, validVehicleRecord, type VehicleCollection, type VehicleRecord } from '../lib/vehicle/model';
import { emptyExtraSources, recordExtraSourceError, type ExtraSourceState } from '../lib/vehicle/sourceState';
import { buildLedger, currentMileage, mileageEvidence, periodSummary, reminderRows } from '../lib/vehicle/derived';
export interface EditingRecord { collection: VehicleCollection; record?: VehicleRecord; completePlan?: MaintenancePlan }
function useVehicleSources() {
  const {user}=useAuth();const data=useData();const uid=user?.uid??'',vehicleId=data.activeVehicle?.id??'';const scope=`${uid}/${vehicleId}`;
  const care=useMaintenance(uid,vehicleId);
  const [extra,setExtra]=useState<ExtraSourceState>(emptyExtraSources);
  const [today,setToday]=useState(localDay);
  useEffect(()=>{const resume=()=>setToday(localDay());window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);const timer=setInterval(resume,60000);return()=>{clearInterval(timer);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};},[]);
  useEffect(()=>{if(!uid||!vehicleId)return;let current=true;const invalid=new Map<string,number>();
    const empty=emptyExtraSources(scope);
    const off=EXTRA_COLLECTIONS.map(name=>subscribeResilient<QuerySnapshot<DocumentData>>((next,error)=>onSnapshot(collection(db,'users',uid,'vehicles',vehicleId,name),{includeMetadataChanges:true},next,error),snap=>{
      const rows=snap.docs.map(d=>decodeVehicleRecord(name,{...d.data(),id:d.id}));const valid=rows.filter(r=>validVehicleRecord(name,r));invalid.set(name,rows.length-valid.length);
      setExtra(old=>{const prev=old.scope===scope?old:empty;return {...prev,data:{...prev.data,[name]:valid},loaded:[...new Set([...prev.loaded,name])],cached:[...prev.cached.filter(n=>n!==name),...(snap.metadata.fromCache?[name]:[])],errors:prev.errors.filter(n=>n!==name),malformed:[...invalid.values()].reduce((a,b)=>a+b,0)};});
    },{isCurrent:()=>current,label:name,onError:()=>setExtra(old=>recordExtraSourceError(old,scope,name))}));
    return()=>{current=false;off.forEach(fn=>fn());};
  },[uid,vehicleId,scope]);
  const scoped=extra.scope===scope?extra:emptyExtraSources(scope);
  const mileage=useMemo(()=>mileageEvidence(data.fillups,data.observations,care.data),[data.fillups,data.observations,care.data]);
  const ledger=useMemo(()=>buildLedger(data.fillups,data.observations,care.data,scoped.data),[data.fillups,data.observations,care.data,scoped.data]);
  const incomplete=care.loading||care.cached.length>0||care.errors.length>0||care.malformed>0||scoped.loaded.length<2||scoped.cached.length>0||scoped.errors.length>0||scoped.malformed>0||data.loadingFillups||data.fillupsFromCache||!!data.fillupsError||data.malformedFillups.length>0||data.observationsStatus!=='ready'||data.outbox.some(op=>op.vehicleId===vehicleId);
  const reminders=useMemo(()=>reminderRows(care.data,mileage,today),[care.data,mileage,today]);
  const current=currentMileage(mileage,today);
  const month=periodSummary(ledger,mileage,today.slice(0,7)+'-01',today,incomplete);
  return {uid,vehicleId,scope,today,care,extra:scoped.data,extraErrors:scoped.errors,incomplete,mileage,currentMileage:current,ledger,reminders,month};
}
type State=ReturnType<typeof useVehicleSources>&{editing:EditingRecord|null;edit:(next:EditingRecord|null)=>void};
const Context=createContext<State|null>(null);
export function VehicleDataProvider({children}:{children:ReactNode}) {
  const state=useVehicleSources();const [editor,setEditor]=useState<{scope:string;value:EditingRecord|null}>({scope:'',value:null});
  const editing=editor.scope===state.scope?editor.value:null;
  return <Context.Provider value={{...state,editing,edit:value=>setEditor({scope:state.scope,value})}}>{children}</Context.Provider>;
}
export function useVehicleData():State {const context=useContext(Context);if(!context)throw new Error('VehicleDataProvider is required');return context;}
