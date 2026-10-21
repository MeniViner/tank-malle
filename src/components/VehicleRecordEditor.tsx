import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVehicleData } from '../context/VehicleDataContext';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { CareEditor } from './maintenance/CareEditor';
import { Field } from './Field';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { localDay, mileageIssue, type CareCollection, type CareRecord } from '../lib/maintenance/model';
import { careCollection } from '../lib/vehicle/derived';
import { validVehicleRecord, type VehicleIssue } from '../lib/vehicle/model';
export function VehicleRecordEditor() {
  const state=useVehicleData();const {saveCareRecord}=useData();const {showToast}=useToast();const scope=useRef(state.scope);useLayoutEffect(()=>{scope.current=state.scope;},[state.scope]);
  const edit=state.editing;if(!edit)return null;const bound=state.scope;
  const onSave=async(record:CareRecord,base?:CareRecord)=>{
    if(scope.current!==bound)throw new Error('הרכב או החשבון התחלפו');
    if('odometer' in record&&record.odometer!==null){const issue=mileageIssue({day:record.day,odometer:record.odometer},state.mileage.filter(r=>r.source!==edit.collection||r.id!==record.id));if(issue)throw new Error(issue);}
    const receipt=await saveCareRecord(state.vehicleId,edit.collection,record,base);
    if(scope.current!==bound)return;state.edit(null);showToast({tone:'info',title:'נשמר במכשיר — ממתין לסנכרון'});
    void receipt.settled.then(ok=>{if(scope.current===bound&&!ok)showToast({tone:'error',title:'הסנכרון לא הושלם — בדקו פעולות שלא סונכרנו'});});
  };
  if(careCollection(edit.collection))return <CareEditor key={`${bound}/${edit.collection}/${edit.record?.id??edit.completePlan?.id??'new'}`} uid={state.uid} vehicleId={state.vehicleId} collection={edit.collection as CareCollection} record={edit.record as CareRecord|undefined} completePlan={edit.completePlan} plans={state.care.data.maintenancePlans} onClose={()=>state.edit(null)} onSave={onSave}/>;
  if(edit.collection==='vehicleIssues')return <IssueEditor key={`${bound}/${edit.record?.id??'new'}`} original={edit.record as VehicleIssue|undefined} onClose={()=>state.edit(null)}/>;
  return null;
}
function IssueEditor({original,onClose}:{original?:VehicleIssue;onClose:()=>void}) {
  const {scope,vehicleId,care,extra,today}=useVehicleData();const {saveCareRecord}=useData();const {showToast}=useToast();
  const [value,setValue]=useState<VehicleIssue>(()=>original??{id:crypto.randomUUID(),schemaVersion:1,version:1,day:localDay(),title:'',symptoms:'',odometer:null,importance:'normal',status:'open',notes:'',serviceEventIds:[],history:[]});
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);const current=useRef(scope);useLayoutEffect(()=>{current.current=scope;},[scope]);const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const patch=(p:Partial<VehicleIssue>)=>setValue(v=>({...v,...p}));
  return <Sheet open title={original?'מעקב אחר תקלה':'מה קורה ברכב?'} onClose={onClose}><form className="vehicle-form" onSubmit={e=>{e.preventDefault();if(busy)return;const bound=scope;
    const latest=extra.vehicleIssues.find(r=>r.id===original?.id);if(original&&JSON.stringify(latest)!==JSON.stringify(original)){setError('הרשומה השתנתה. סגרו ופתחו שוב לפני שמירה.');return;}
    const changes=original&&original.status!==value.status?[...value.history,{day:today,status:value.status,note:value.notes.slice(0,500)}].slice(-10):value.history;
    const next={...value,title:value.title.trim(),version:original?original.version+1:1,history:changes};
    if(!validVehicleRecord('vehicleIssues',next)){setError('בדקו את הכותרת, התאריך והקילומטראז׳.');return;}setBusy(true);setError('');
    void saveCareRecord(vehicleId,'vehicleIssues',next,original).then(receipt=>{if(!mounted.current||current.current!==bound)return;onClose();showToast({tone:'info',title:'התקלה נשמרה במכשיר — ממתינה לסנכרון'});void receipt.settled.then(ok=>{if(!ok)showToast({tone:'error',title:'התקלה טרם סונכרנה. הפרטים נשמרו בתור הפעולות.'});});}).catch(e=>{if(mounted.current)setError(e instanceof Error?e.message:'לא ניתן לשמור');}).finally(()=>{if(mounted.current)setBusy(false);});
  }}>
    <p className="helper">מתעדים את מה שמרגישים, ועוקבים עד לפתרון.</p>
    <Field label="שם התקלה" dir="auto" required maxLength={120} value={value.title} onChange={e=>patch({title:e.target.value})} placeholder="למשל, רעש בזמן בלימה"/>
    <label className="field-label">מה שמתם לב?<textarea maxLength={2000} value={value.symptoms} onChange={e=>patch({symptoms:e.target.value})} rows={3}/></label>
    <Field label="יום הגילוי" type="date" required value={value.day} onChange={e=>patch({day:e.target.value})}/>
    <Field label="קילומטראז׳ בגילוי (רשות)" type="number" min={0} max={9999999} step={1} value={value.odometer??''} onChange={e=>patch({odometer:e.target.value===''?null:Number(e.target.value)})}/>
    <label className="field-label">חשיבות<select aria-label="חשיבות" value={value.importance} onChange={e=>patch({importance:e.target.value as VehicleIssue['importance']})}><option value="normal">למעקב רגיל</option><option value="important">חשוב לי לטפל בקרוב</option></select></label>
    <label className="field-label">מצב<select aria-label="מצב" value={value.status} onChange={e=>patch({status:e.target.value as VehicleIssue['status']})}><option value="open">פתוחה</option><option value="watching">במעקב</option><option value="resolved">נפתרה</option></select></label>
    <details><summary>טיפולים שקשורים לתקלה</summary><p className="helper">עלויות נספרות דרך הטיפול בלבד. סימון קישור אינו יוצר הוצאה נוספת.</p>{care.data.serviceEvents.length?care.data.serviceEvents.map(r=><label className="v-row" key={r.id}><input type="checkbox" disabled={!value.serviceEventIds.includes(r.id)&&value.serviceEventIds.length>=8} checked={value.serviceEventIds.includes(r.id)} onChange={e=>patch({serviceEventIds:e.target.checked?[...value.serviceEventIds,r.id]:value.serviceEventIds.filter(id=>id!==r.id)})}/><span>{r.title}<small>{r.day}</small></span></label>):<p className="helper">אחרי רישום הטיפול ביומן אפשר לקשר אותו כאן.</p>}</details>
    <label className="field-label">הערות ועדכון<textarea rows={3} maxLength={2000} value={value.notes} onChange={e=>patch({notes:e.target.value})}/></label>
    {value.history.length?<details><summary>שינויי המצב האחרונים (עד 10)</summary>{value.history.map((h,i)=><p key={i}>{h.day} · {{open:'פתוחה',watching:'במעקב',resolved:'נפתרה'}[h.status]} · {h.note}</p>)}</details>:null}
    {error?<p role="alert" className="text-danger">{error}</p>:null}<Button type="submit" disabled={busy} full>{busy?'שומרים…':original?'שמירת העדכון':'שמירת תקלה'}</Button>
  </form></Sheet>;
}
