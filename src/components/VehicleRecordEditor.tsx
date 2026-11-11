import { useEffect, useRef, useState } from 'react';
import { useVehicleData } from '../context/VehicleDataContext';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { CareEditor } from './maintenance/CareEditor';
import { Field } from './Field';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { localDay, mileageIssue, type CareCollection, type CareRecord } from '../lib/maintenance/model';
import { suggestNextReminder, type PlanDefaults } from '../lib/maintenance/nextReminder';
import { CalendarIcon } from './icons';
import { careCollection } from '../lib/vehicle/derived';
import { validVehicleRecord, type VehicleIssue } from '../lib/vehicle/model';
import { useAccountScope } from './account/useAccountScope';
import { NumericText } from './Fmt';
import { vehicleDay } from '../lib/vehicle/format';
import { CivilDateField } from './CivilDateField';
import { formatCivilDay, parseCivilDay } from '../lib/civilDate';
export function VehicleRecordEditor() {
  const state=useVehicleData();const {saveCareRecord}=useData();const {showToast}=useToast();const captureScope=useAccountScope(state.scope);
  const edit=state.editing;if(!edit)return null;const bound=state.scope;
  const previous=edit.completePlan?state.care.data.serviceEvents.filter(event=>event.day<=state.today&&event.completedPlanIds.includes(edit.completePlan!.id)).sort((a,b)=>b.day.localeCompare(a.day)||(b.odometer??-1)-(a.odometer??-1)||a.id.localeCompare(b.id))[0]:undefined;
  const completionDefaults=edit.completePlan&&!edit.record?{costAgorot:previous?.costAgorot??null,garage:previous?.garage??'',odometer:state.currentMileage&&!state.currentMileage.ambiguous?state.currentMileage.odometer:null,previousDay:previous?.day??null}:undefined;
  const onSave=async(record:CareRecord,base?:CareRecord,onAccepted?:()=>void)=>{
    const isCurrent=captureScope();
    if(!isCurrent())throw new Error('הרכב או החשבון התחלפו');
    if('odometer' in record&&record.odometer!==null){const issue=mileageIssue({day:record.day,odometer:record.odometer},state.mileage.filter(r=>r.source!==edit.collection||r.id!==record.id));if(issue)throw new Error(issue);}
    try {
      const receipt=await saveCareRecord(state.vehicleId,edit.collection,record,base);
      if(!isCurrent())return;onAccepted?.();
      // A new service that did not advance a reminder: offer to set the next one straight away.
      const latest=state.currentMileage?state.currentMileage.ambiguous?state.currentMileage.maximum:state.currentMileage.odometer:null;
      const offer=edit.collection==='serviceEvents'&&!base&&'jobs' in record?suggestNextReminder(record,state.care.data.maintenancePlans,latest):null;
      state.edit(offer?{collection:'maintenancePlans',offerPlan:offer}:null);
      void receipt.settled.then(ok=>{if(isCurrent()&&!ok)showToast({tone:'error',title:'הסנכרון לא הושלם — בדקו שינויים שעוד לא עלו לענן'});});
    } catch(error) { if(isCurrent())throw error; }
  };
  if(edit.offerPlan)return <NextReminderOffer key={`${bound}/offer`} defaults={edit.offerPlan} onAccept={()=>state.edit({collection:'maintenancePlans',initialJob:edit.offerPlan!.job,planDefaults:edit.offerPlan})} onClose={()=>state.edit(null)}/>;
  if(careCollection(edit.collection))return <CareEditor key={`${bound}/${edit.collection}/${edit.record?.id??edit.completePlan?.id??'new'}`} uid={state.uid} vehicleId={state.vehicleId} collection={edit.collection as CareCollection} record={edit.record as CareRecord|undefined} completePlan={edit.completePlan} initialJob={edit.initialJob} odometerIntent={edit.odometerIntent} currentOdometer={state.currentMileage} completionDefaults={completionDefaults} planDefaults={edit.planDefaults} plans={state.care.data.maintenancePlans} onClose={()=>state.edit(null)} onSave={onSave}/>;
  if(edit.collection==='vehicleIssues')return <IssueEditor key={`${bound}/${edit.record?.id??'new'}`} original={edit.record as VehicleIssue|undefined} captureParentScope={captureScope} onClose={()=>state.edit(null)}/>;
  return null;
}
/** Shown once, right after a new service: one tap opens a reminder already filled in for the next one. */
function NextReminderOffer({defaults,onAccept,onClose}:{defaults:PlanDefaults;onAccept:()=>void;onClose:()=>void}) {
  const when=[vehicleDay(defaults.dueDay),defaults.dueOdometer!==null?`${defaults.dueOdometer.toLocaleString('he-IL')} ק״מ`:null].filter(Boolean).join(' או ');
  return <Sheet open title="הטיפול נשמר" atmosphereRoute="/vehicle" onClose={onClose}>
    <div className="tm-next-reminder" data-testid="next-reminder-offer">
      <p className="tm-next-reminder-lead">לקבוע כבר עכשיו תזכורת ל{defaults.title}?</p>
      <div className="tm-next-reminder-card"><span className="tm-vehicle-row-icon"><CalendarIcon size={20}/></span>
        <span><small>הצעה למועד הבא</small><b><NumericText>{when}</NumericText></b><small>המוקדם מביניהם · אפשר לשנות לפני השמירה</small></span></div>
      <Button full data-testid="next-reminder-accept" onClick={onAccept}>קביעת תזכורת</Button>
      <Button full variant="ghost" data-testid="next-reminder-skip" onClick={onClose}>לא עכשיו</Button>
    </div>
  </Sheet>;
}

function IssueEditor({original,onClose,captureParentScope}:{original?:VehicleIssue;onClose:()=>void;captureParentScope:()=>()=>boolean}) {
  const {scope,vehicleId,care,extra,today,currentMileage}=useVehicleData();const {saveCareRecord}=useData();const {showToast}=useToast();
  const [value,setValue]=useState<VehicleIssue>(()=>original??{id:crypto.randomUUID(),schemaVersion:1,version:1,day:localDay(),title:'',symptoms:'',odometer:null,importance:'normal',status:'open',notes:'',serviceEventIds:[],history:[]});
  const [dayDraft,setDayDraft]=useState(()=>formatCivilDay(value.day)||value.day);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const captureEditor=useAccountScope(scope);const saving=useRef(false);const errorNode=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(error)errorNode.current?.focus();},[error]);
  const patch=(p:Partial<VehicleIssue>)=>setValue(v=>({...v,...p}));
  return <Sheet open title={original?'מעקב אחר תקלה':'מה קורה ברכב?'} atmosphereRoute="/vehicle" onClose={onClose}><form className="vehicle-form tm-vehicle-form tm-vehicle-issue-form" onSubmit={e=>{e.preventDefault();if(saving.current)return;const isCurrent=captureEditor(),isScopeCurrent=captureParentScope();
    const latest=extra.vehicleIssues.find(r=>r.id===original?.id);if(original&&JSON.stringify(latest)!==JSON.stringify(original)){setError('הרשומה השתנתה. סגרו ופתחו שוב לפני שמירה.');return;}
    const changes=original&&original.status!==value.status?[...value.history,{day:today,status:value.status,note:value.notes.slice(0,500)}].slice(-10):value.history;
    const day=parseCivilDay(dayDraft);
    if(!day){setError('בדקו את התאריך — למשל 05/09/2026.');return;}
    const next={...value,day,title:value.title.trim(),version:original?original.version+1:1,history:changes};
    if(!validVehicleRecord('vehicleIssues',next)){setError('בדקו את הכותרת, התאריך והקילומטראז׳.');return;}if(!isCurrent()||!isScopeCurrent())return;saving.current=true;setBusy(true);setError('');
    void saveCareRecord(vehicleId,'vehicleIssues',next,original).then(receipt=>{if(!isScopeCurrent())return;if(isCurrent())onClose();void receipt.settled.then(ok=>{if(!ok&&isScopeCurrent())showToast({tone:'error',title:'שמירת התקלה טרם אושרה',detail:'אפשר לבדוק בשינויים שעוד לא עלו לענן.'});});}).catch(e=>{if(isCurrent())setError(e instanceof Error?e.message:'לא ניתן לשמור');else if(isScopeCurrent())showToast({tone:'error',title:'שמירת התקלה לא הושלמה',detail:'בדקו את הפרטים ואת השינויים שעוד לא עלו לענן.'});}).finally(()=>{saving.current=false;if(isCurrent())setBusy(false);});
  }}>
    <fieldset disabled={busy}>
    {!original?<div className="tm-vehicle-issue-chips" aria-label="תסמינים נפוצים">{['רעש מוזר','נורה בלוח','רעידות','ריח'].map(title=><button type="button" className="tm-vehicle-chip" key={title} aria-pressed={value.title===title} onClick={()=>patch({title})}>{title}</button>)}</div>:null}
    <Field label="שם התקלה" dir="auto" required maxLength={120} value={value.title} onChange={e=>patch({title:e.target.value})} placeholder="למשל, רעש בזמן בלימה"/>
    <label className="field-label">מה שמתם לב?<textarea maxLength={2000} value={value.symptoms} onChange={e=>patch({symptoms:e.target.value})} rows={3}/></label>
    <CivilDateField label="יום הגילוי" data-testid="issue-day" required draftText={dayDraft} onDraftTextChange={setDayDraft}/>
    <Field label="קילומטראז׳ בגילוי (רשות)" type="number" min={0} max={9999999} step={1} value={value.odometer??''} placeholder={currentMileage?String(currentMileage.ambiguous?currentMileage.maximum:currentMileage.odometer):'0'} onChange={e=>patch({odometer:e.target.value===''?null:Number(e.target.value)})}/>
    <label className="field-label">חשיבות<select aria-label="חשיבות" value={value.importance} onChange={e=>patch({importance:e.target.value as VehicleIssue['importance']})}><option value="normal">למעקב רגיל</option><option value="important">חשוב לי לטפל בקרוב</option></select></label>
    <label className="field-label">מצב<select aria-label="מצב" value={value.status} onChange={e=>patch({status:e.target.value as VehicleIssue['status']})}><option value="open">פתוחה</option><option value="watching">במעקב</option><option value="resolved">נפתרה</option></select></label>
    <details><summary>טיפולים שקשורים לתקלה</summary><p className="helper">עלויות נספרות דרך הטיפול בלבד. סימון קישור אינו יוצר הוצאה נוספת.</p>{care.data.serviceEvents.length?care.data.serviceEvents.map(r=><label className="v-row" key={r.id}><input type="checkbox" disabled={!value.serviceEventIds.includes(r.id)&&value.serviceEventIds.length>=8} checked={value.serviceEventIds.includes(r.id)} onChange={e=>patch({serviceEventIds:e.target.checked?[...value.serviceEventIds,r.id]:value.serviceEventIds.filter(id=>id!==r.id)})}/><span><NumericText>{r.title}</NumericText><small><NumericText>{vehicleDay(r.day)}</NumericText></small></span></label>):<p className="helper">אחרי רישום הטיפול ביומן אפשר לקשר אותו כאן.</p>}</details>
    <label className="field-label">הערות ועדכון<textarea rows={3} maxLength={2000} value={value.notes} onChange={e=>patch({notes:e.target.value})}/></label>
    {value.serviceEventIds.some(id=>!care.data.serviceEvents.some(event=>event.id===id))?<p className="tm-vehicle-note">חלק מהטיפולים המקושרים הוסרו או אינם זמינים. הקישורים השמורים נשארים כפי שהם.</p>:null}
    {value.history.length?<details className="tm-vehicle-disclosure"><summary><NumericText>שינויי המצב האחרונים (עד 10)</NumericText></summary>{value.history.map((h,i)=><p key={i}><NumericText>{`${vehicleDay(h.day)} · ${{open:'פתוחה',watching:'במעקב',resolved:'נפתרה'}[h.status]} · ${h.note}`}</NumericText></p>)}</details>:null}
    </fieldset>
    {error?<p ref={errorNode} tabIndex={-1} role="alert" className="tm-vehicle-error"><NumericText>{error}</NumericText></p>:null}<Button type="submit" disabled={busy} full>{busy?'שומרים…':original?'שמירת העדכון':'שמירת תקלה'}</Button>
  </form></Sheet>;
}
