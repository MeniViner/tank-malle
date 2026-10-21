import { subscribeResilient } from '../lib/subscribeResilient';
import { useEffect, useState } from 'react';
import { collection, onSnapshot, type QuerySnapshot, type DocumentData } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { CARE_COLLECTIONS, EMPTY_CARE, validCareRecord, type CareData } from '../lib/maintenance/model';

interface State { scope: string; data: CareData; loaded: string[]; cached: string[]; errors: string[]; malformed: number }
/** Scope is checked at render time too: no old vehicle/account flashes during effect cleanup. */
export function useMaintenance(uid: string, vehicleId: string) {
  const scope = `${uid}/${vehicleId}`;
  const [state, setState] = useState<State>({ scope: '', data: EMPTY_CARE, loaded: [], cached: [], errors: [], malformed: 0 });
  useEffect(() => {
    if (!uid || !vehicleId) return;
    let current = true;
    const invalid = new Map<string, number>();
    const base = (prev: State): State => prev.scope === scope ? prev : { scope, data: EMPTY_CARE, loaded: [], cached: [], errors: [], malformed: 0 };
    const off = CARE_COLLECTIONS.map(name => subscribeResilient<QuerySnapshot<DocumentData>>((next,error) => onSnapshot(collection(db,'users',uid,'vehicles',vehicleId,name), { includeMetadataChanges: true }, next,error), snapshot => {
      if (!current) return;
      const rows = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      const valid = rows.filter(row => validCareRecord(name,row));
      invalid.set(name, rows.length-valid.length);
      setState(old => { const prev = base(old); return ({ scope, data: { ...prev.data, [name]: valid }, loaded: [...new Set([...prev.loaded,name])],
        cached: [...prev.cached.filter(n => n !== name), ...(snapshot.metadata.fromCache ? [name] : [])], errors: prev.errors.filter(n => n !== name), malformed: [...invalid.values()].reduce((a,b)=>a+b,0) }); });
    }, { isCurrent: () => current, label: name, onError: () => { if (current) setState(old => { const prev=base(old); return { ...prev, errors: [...new Set([...prev.errors,name])] }; }); } }));
    return () => { current = false; off.forEach(fn => fn()); };
  }, [uid,vehicleId,scope]);
  return state.scope === scope ? { ...state, loading: state.loaded.length<CARE_COLLECTIONS.length } : { scope, data: EMPTY_CARE, loaded: [], cached: [], errors: [], malformed: 0, loading: true };
}
