import { careDraftKey, readCareDraft, writeCareDraft, removeCareDraft } from '../../lib/maintenance/draft';
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { CareGlyph } from './CareGlyph';
import { CheckIcon, ChevronStart, ChevronEnd } from '../icons';
import { Field } from '../Field';
import { Button } from '../Button';
import { Toggle } from '../Segmented';
import { Sheet, ConfirmDialog } from '../Sheet';
import { JOBS, EXPENSES, localDay, validCareRecord, type CareCollection, type CareRecord, type Job, type MaintenancePlan } from '../../lib/maintenance/model';
import { parseNumberInput } from '../../lib/numeric';

const TITLES: Record<CareCollection,string> = { serviceEvents: 'טיפול שבוצע', maintenancePlans: 'תזכורת לטיפול', vehicleExpenses: 'הוצאה לרכב', odometerReadings: 'עדכון קילומטראז׳' };
export function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="flex flex-col gap-1.5 text-sm font-semibold text-muted">{label}<select aria-label={label} className="min-h-12 w-full min-w-0 rounded-xl border border-line bg-surface p-3 text-base text-ink" value={value} onChange={e=>onChange(e.target.value)}>{children}</select></label>;
}
export function CareEditor({ uid, vehicleId, collection, record: currentRecord, plans, completePlan, onClose, onSave }: {
  uid: string; vehicleId: string; collection: CareCollection; record?: CareRecord; plans: MaintenancePlan[]; completePlan?: MaintenancePlan;
  onClose: () => void; onSave: (record: CareRecord, base?: CareRecord) => Promise<void>;
}) {
  const draftKey = careDraftKey(uid, vehicleId, collection, currentRecord?.id ?? (completePlan ? `complete-${completePlan.id}` : 'new'));
  const [restored] = useState(() => readCareDraft(draftKey));
  const [record] = useState(() => restored?.base && validCareRecord(collection, restored.base) ? restored.base : currentRecord);
  function restore<T>(key: string, fallback: T): T {
    const value = restored?.fields[key];
    if (Array.isArray(fallback)) return Array.isArray(value) && value.every(v=>typeof v==='string') ? value as T : fallback;
    return typeof value === typeof fallback ? value as T : fallback;
  }
  const service = record && 'jobs' in record ? record : null;
  const plan = record && 'dueDay' in record ? record : null;
  const [id] = useState(() => restore('id', record?.id ?? crypto.randomUUID()));
  const [title,setTitle] = useState(() => restore('title', record && 'title' in record ? record.title : completePlan?.title ?? ''));
  const [titleAuthored,setTitleAuthored] = useState(() => restore('titleAuthored',!!record || !!completePlan || !!restored?.fields.title));
  const [day,setDay] = useState(() => restore('day', record && 'day' in record ? record.day : localDay()));
  const [odo,setOdo] = useState(() => restore('odo', record && 'odometer' in record && record.odometer !== null ? String(record.odometer) : ''));
  const [cost,setCost] = useState(() => restore('cost', record && 'costAgorot' in record && record.costAgorot !== null ? String(record.costAgorot / 100) : ''));
  const [notes,setNotes] = useState(() => restore('notes', record?.notes ?? ''));
  const [garage,setGarage] = useState(() => restore('garage', service?.garage ?? ''));
  const [jobs,setJobs] = useState<Job[]>(() => restore('jobs', service?.jobs ?? (completePlan ? [completePlan.job] : [])));
  const [completed,setCompleted] = useState(() => restore('completed', service?.completedPlanIds ?? (completePlan ? [completePlan.id] : [])));
  const [job,setJob] = useState<Job>(() => restore('job', plan?.job ?? 'periodic'));
  const [dueDay,setDueDay] = useState(() => restore('dueDay', plan?.dueDay ?? ''));
  const [dueOdo,setDueOdo] = useState(() => restore('dueOdo', plan?.dueOdometer !== null && plan?.dueOdometer !== undefined ? String(plan.dueOdometer) : ''));
  const [months,setMonths] = useState(() => restore('months', plan?.intervalMonths ? String(plan.intervalMonths) : ''));
  const [km,setKm] = useState(() => restore('km', plan?.intervalKm ? String(plan.intervalKm) : ''));
  const [basis,setBasis] = useState<MaintenancePlan['basis']>(() => restore('basis', plan?.basis ?? 'manual'));
  const [source,setSource] = useState<MaintenancePlan['source']>(() => restore('source', plan?.source ?? 'owner'));
  const [active,setActive] = useState(() => restore('active', plan?.active ?? true));
  const [category,setCategory] = useState(() => restore('category', record && 'category' in record ? record.category : 'other'));
  const [step,setStep] = useState(() => restore('_step', record || completePlan || restored || collection === 'odometerReadings' ? 1 : 0));
  const heading = useRef<HTMLHeadingElement>(null);
  const [linkedOpen,setLinkedOpen] = useState(completed.length>0);
  useEffect(()=>{heading.current?.focus();},[step]);
  const [discard,setDiscard] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const signature=JSON.stringify({id,title,titleAuthored,day,odo,cost,notes,garage,jobs,completed,job,dueDay,dueOdo,months,km,basis,source,active,category});
  const [original]=useState(signature);
  const [storageFailed,setStorageFailed] = useState(false);
  const saved = useRef(false);
  const dirty = !!restored || signature !== original;
  useEffect(()=>{
    if (!saved.current && dirty) setStorageFailed(!writeCareDraft(draftKey,{fields:{...JSON.parse(signature),_step:step},base:record??null}));
    else if (!saved.current) setStorageFailed(!removeCareDraft(draftKey));
  },[draftKey,signature,record,dirty,step]);
  useEffect(()=>{
    if (!storageFailed) return;
    const preventLoss=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',preventLoss);return()=>window.removeEventListener('beforeunload',preventLoss);
  },[storageFailed,dirty]);
  const close=()=>{if(busy)return;if(storageFailed)setDiscard(true);else onClose();};
  const optionalNumber = (value: string) => value.trim() === '' ? null : parseNumberInput(value,'odometer').value;
  async function save() {
    if (busy) return; setError('');
    const rawCost = cost.trim() === '' ? null : parseNumberInput(cost,'money').value;
    const cents = rawCost === null ? null : Math.abs(rawCost*100-Math.round(rawCost*100)) < 1e-7 ? Math.round(rawCost*100) : NaN;
    const base = { id, schemaVersion: 1 as const, version: (record?.version ?? 0)+1, notes: notes.trim() };
    const next: CareRecord = collection === 'serviceEvents' ? { ...base, title: title.trim(), day, odometer: optionalNumber(odo), costAgorot: cents, garage: garage.trim(), jobs, completedPlanIds: completed }
      : collection === 'maintenancePlans' ? { ...base, title: title.trim(), job, dueDay: dueDay || null, dueOdometer: optionalNumber(dueOdo), intervalMonths: basis === 'manual' ? null : optionalNumber(months), intervalKm: basis === 'manual' ? null : optionalNumber(km), basis, source, active }
      : collection === 'vehicleExpenses' ? { ...base, title: title.trim(), day, category, costAgorot: cents }
      : { ...base, day, odometer: optionalNumber(odo) as number, notes: notes.trim() };
    if (!validCareRecord(collection,next) || (collection !== 'maintenancePlans' && day > localDay())) {
      setError(collection === 'maintenancePlans' ? 'יש להזין שם ויעד בתאריך או בק״מ. מרווח חזרה צריך להיות מספר שלם וחיובי, עם יעד מתאים.' : 'בדקו את השדות: תאריך עד היום, שם, קילומטראז׳ שלם ועלות שאינה שלילית (עד שתי ספרות אחרי הנקודה).'); return;
    }
    setBusy(true);
    try { await onSave(next,record); saved.current=true; removeCareDraft(draftKey); } catch (e) { setError(e instanceof Error ? e.message : 'השמירה לא הושלמה. הפרטים נשארו כאן.'); setBusy(false); }
  }
  const serviceMode=collection==='serviceEvents',expenseMode=collection==='vehicleExpenses',planMode=collection==='maintenancePlans';
  const selectedLabel=serviceMode?jobs.map(j=>JOBS[j]).join(' · '):expenseMode?EXPENSES[category]:JOBS[job];
  const nextStep=()=>{if(serviceMode&&!jobs.length)return;if(!title.trim())setTitle(selectedLabel);setError('');setStep(1);};
  const choice=(value:string)=>{
    if(serviceMode){const next=jobs.includes(value as Job)?jobs.filter(j=>j!==value):[...jobs,value as Job];setJobs(next);if(!titleAuthored)setTitle(next.map(j=>JOBS[j]).join(' · '));}
    else {if(expenseMode)setCategory(value as typeof category);else setJob(value as Job);if(!titleAuthored)setTitle(expenseMode?EXPENSES[value as keyof typeof EXPENSES]:JOBS[value as Job]);setStep(1);}
  };
  return <><Sheet open onClose={close} title={<h2 className="text-lg font-bold">{record?'עריכת ':''}{TITLES[collection]}</h2>}>
    <form className="care-editor" onSubmit={e=>{e.preventDefault();if(step===0)nextStep();else void save();}}>
      {restored ? <p role="status" className="care-restored"><CheckIcon size={17}/>הטיוטה שלך שוחזרה. אפשר להמשיך מאיפה שעצרת.</p>:null}
      {step===0 ? <>
        <div className="care-step-heading"><span>01 / 02</span><h3 ref={heading} tabIndex={-1}>{serviceMode?'מה בוצע ברכב?':expenseMode?'על מה ההוצאה?':'למה נזכיר לך?'}</h3><p>{serviceMode?'אפשר לבחור כמה עבודות מאותה חשבונית.':expenseMode?'גם הוצאות שוטפות וגם כסף שחזר אליך.':'בוחרים טיפול, ואז קובעים מועד לפי ההנחיות שלך.'}</p></div>
        <div className="care-choice-grid" role="group" aria-label={serviceMode?'מה בוצע?':expenseMode?'סוג הוצאה':'סוג טיפול'}>
          {Object.entries(expenseMode?EXPENSES:JOBS).map(([key,label])=>{
            const selected=serviceMode?jobs.includes(key as Job):expenseMode?category===key:job===key;
            return <button key={key} type="button" className="care-choice" aria-pressed={selected} onClick={()=>choice(key)}><CareGlyph kind={key}/><span>{label}</span>{selected?<CheckIcon size={16}/>:<span className="care-choice-dot"/>}</button>;
          })}
        </div>
        {!expenseMode?<p className="care-quiet-note">מגבים, מיזוג או חלק אחר? בחרו ״אחר״ והוסיפו תיאור.</p>:null}
        {serviceMode?<p className="care-quiet-note">{jobs.length?jobs.length===1?'עבודה אחת בחשבונית':`${jobs.length} עבודות בחשבונית אחת`:'העלות נרשמת פעם אחת, גם אם נבחרו כמה עבודות.'}</p>:null}
      </>:<>
        {collection!=='odometerReadings'?<button type="button" className="care-selection" aria-label="שינוי סוג הרשומה" onClick={()=>setStep(0)}><span className="care-selection-icon"><CareGlyph kind={expenseMode?category:planMode?job:jobs[0]}/></span><span><small>{expenseMode?'סוג ההוצאה':planMode?'הטיפול הבא':'מה בוצע'}</small><b>{selectedLabel}</b></span><ChevronStart size={18}/></button>:null}
        <div className="care-step-heading"><h3 ref={heading} tabIndex={-1}>{planMode?'מתי להזכיר לך?':collection==='odometerReadings'?'כמה קילומטרים הרכב עבר?':category==='refund'&&expenseMode?'כמה כסף חזר אליך?':serviceMode?'פרטי הטיפול':'פרטי ההוצאה'}</h3></div>
        {serviceMode||expenseMode?<div className="care-amount"><Field label="עלות כוללת" big inputMode="decimal" value={cost} placeholder="לא ידוע" onChange={e=>setCost(e.target.value)} suffix="₪"/><p>{expenseMode&&category==='refund'?'סכום חיובי שהוחזר לך. נפחית אותו מסך ההוצאות.':'הסכום לכל החשבונית. אפשר להשאיר ריק, או להזין 0 אם לא שילמת.'}</p></div>:null}
        {!planMode?<div className="care-details-group"><Field row type="date" label="תאריך ביצוע" value={day} max={localDay()} onChange={e=>setDay(e.target.value)}/>{serviceMode||collection==='odometerReadings'?<Field row label="קילומטראז׳ בעת הביצוע" inputMode="numeric" value={odo} onChange={e=>setOdo(e.target.value)} suffix="ק״מ" placeholder={serviceMode?'לא ידוע':'מד מרחק מצטבר'}/>:null}</div>:null}
        {planMode?<>
          <div className="care-details-group"><Field row label="תאריך יעד" type="date" value={dueDay} onChange={e=>setDueDay(e.target.value)}/><Field row label="יעד קילומטראז׳" inputMode="numeric" value={dueOdo} onChange={e=>setDueOdo(e.target.value)} suffix="ק״מ" placeholder="למשל 180000"/></div>
          <p className="care-quiet-note">אפשר תאריך, קילומטרים או שניהם — המוקדם מביניהם. לפי הוראות היצרן או המוסך שלך.</p>
          <div className="care-toggle"><span><b>תזכורת חוזרת</b><small>לקבוע גם את הטיפול הבא</small></span><Toggle ariaLabel="תזכורת חוזרת" checked={basis!=='manual'} onChange={checked=>setBasis(checked?'completion':'manual')}/></div>
          {basis!=='manual'?<div className="care-repeat"><div className="grid grid-cols-2 gap-3"><Field label="חזרה כל מספר חודשים" inputMode="numeric" value={months} onChange={e=>setMonths(e.target.value)} placeholder="חודשים"/><Field label="חזרה כל מספר ק״מ" inputMode="numeric" value={km} onChange={e=>setKm(e.target.value)} placeholder="ק״מ"/></div><SelectField label="חישוב המועד הבא" value={basis} onChange={v=>setBasis(v as typeof basis)}><option value="completion">מהטיפול האחרון שבוצע</option><option value="fixed">לפי יעדים קבועים מהיעד הראשון</option></SelectField><p className="care-quiet-note">חזרה בחודשים דורשת תאריך יעד, וחזרה בק״מ דורשת יעד קילומטראז׳.</p></div>:null}
        </>:null}
        {serviceMode&&plans.length?<details className="care-disclosure" open={linkedOpen} onToggle={e=>setLinkedOpen(e.currentTarget.open)}><summary><span>עדכון תזכורות</span><small>{completed.length?`${completed.length} סומנו כהושלמו`:'הטיפול הזה משלים תזכורת?'}</small></summary><p className="care-quiet-note">רק התזכורות שתסמנו יתקדמו למועד הבא.</p>{plans.filter(p=>p.active||completed.includes(p.id)).map(p=><label key={p.id} className="care-check-row"><input type="checkbox" checked={completed.includes(p.id)} onChange={e=>setCompleted(prev=>e.target.checked?[...prev,p.id]:prev.filter(id=>id!==p.id))}/><span>{p.title}</span></label>)}</details>:null}
        <details className="care-disclosure"><summary><span>עוד פרטים</span><small>{planMode?'תיאור, מקור ההנחיה והערות':serviceMode?'תיאור, מוסך והערות':'תיאור והערות'}</small></summary><div className="flex flex-col gap-4 pt-3">
          {collection!=='odometerReadings'?<Field label="תיאור" dir="auto" maxLength={120} value={title} onChange={e=>{setTitle(e.target.value);setTitleAuthored(true);}}/>:null}
          {serviceMode?<Field label="מוסך / ספק" dir="auto" value={garage} maxLength={160} onChange={e=>setGarage(e.target.value)}/>:null}
          {planMode?<><SelectField label="מקור ההנחיה" value={source} onChange={v=>setSource(v as typeof source)}><option value="owner">הגדרה שלי</option><option value="manufacturer">הוראות יצרן</option><option value="garage">המלצת מוסך</option></SelectField><div className="care-toggle"><span>תזכורת פעילה</span><Toggle ariaLabel="תזכורת פעילה" checked={active} onChange={setActive}/></div></>:null}
          <label className="flex flex-col gap-2 text-sm font-semibold text-muted">הערות<textarea aria-label="הערות" dir="rtl" className="min-h-24 rounded-xl border border-line bg-surface p-3 text-base text-ink" maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="מה חשוב לזכור בפעם הבאה?"/></label>
        </div></details>
      </>}
      {error?<p role="alert" className="care-form-error">{error}</p>:null}
      {storageFailed?<p role="alert" className="care-form-error">לא ניתן לשמור טיוטה במכשיר. השאירו את הטופס פתוח.</p>:null}
      <div className="care-editor-footer">
        {step===0&&serviceMode?<Button type="submit" full disabled={!jobs.length}>המשך לפרטי הטיפול<ChevronEnd size={18}/></Button>:step===1?<Button type="submit" loading={busy} full>שמירת {TITLES[collection]}</Button>:null}
        {dirty?<div className="care-draft-status"><span>{storageFailed?'הטיוטה לא נשמרה':'טיוטה נשמרת אוטומטית במכשיר'}</span><button type="button" disabled={busy} onClick={()=>setDiscard(true)}>מחיקת הטיוטה</button></div>:null}
      </div>
    </form>
  </Sheet><ConfirmDialog open={discard} title="למחוק את הטיוטה?" body="הפרטים שערכת עדיין לא נשמרו בהיסטוריית הרכב." confirmLabel="יציאה ללא שמירה" cancelLabel="המשך עריכה" onConfirm={()=>{if(!removeCareDraft(draftKey)){setError('לא ניתן למחוק את הטיוטה מהמכשיר. נסו שוב.');setDiscard(false);return;}saved.current=true;onClose();}} onCancel={()=>setDiscard(false)}/></>;
}
