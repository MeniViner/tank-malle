import { careDraftKey, readCareDraft, writeCareDraft, removeCareDraft } from '../../lib/maintenance/draft';
import { useAppUpdateBlocker } from '../../hooks/useAppUpdateBlocker';
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { CareGlyph } from './CareGlyph';
import { CheckIcon, ChevronStart, ChevronEnd, CloseIcon } from '../icons';
import { Field } from '../Field';
import { CivilDateField } from '../CivilDateField';
import { PumpDisplay, PumpDisplayRow } from '../DesignPrimitives';
import { Button } from '../Button';
import { NumericText, NumRun } from '../Fmt';
import { Toggle } from '../Segmented';
import { Sheet, ConfirmDialog } from '../Sheet';
import { useAccountScope } from '../account/useAccountScope';
import { JOBS, EXPENSES, localDay, validCareRecord, type CareCollection, type CareRecord, type Job, type MaintenancePlan } from '../../lib/maintenance/model';
import { parseNumberInput } from '../../lib/numeric';
import { vehicleDay } from '../../lib/vehicle/format';
import { int } from '../../lib/format';
import { formatCivilDay, parseCivilDay } from '../../lib/civilDate';
import '../../care-entry-design.css';

const TITLES: Record<CareCollection,string> = { serviceEvents: 'טיפול שבוצע', maintenancePlans: 'תזכורת לטיפול', vehicleExpenses: 'הוצאה לרכב', odometerReadings: 'עדכון קילומטראז׳' };
export function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="flex flex-col gap-1.5 text-sm font-semibold text-muted">{label}<select aria-label={label} className="min-h-12 w-full min-w-0 rounded-md border border-line bg-surface p-3 text-base text-ink" value={value} onChange={e=>onChange(e.target.value)}>{children}</select></label>;
}
export function CareEditor({ uid, vehicleId, collection, record: currentRecord, plans, completePlan, initialJob, currentOdometer, odometerIntent, completionDefaults, onClose, onSave }: {
  uid: string; vehicleId: string; collection: CareCollection; record?: CareRecord; plans: MaintenancePlan[]; completePlan?: MaintenancePlan;
  completionDefaults?: {costAgorot:number|null;garage:string;odometer:number|null;previousDay:string|null};
  initialJob?: Job; odometerIntent?: 'current';
  currentOdometer?: {day:string;odometer:number;ambiguous:boolean;minimum:number;maximum:number} | null;
  onClose: () => void; onSave: (record: CareRecord, base?: CareRecord, onAccepted?: () => void) => Promise<void>;
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
  const captureEditor = useAccountScope(`${uid}/${vehicleId}/${collection}/${id}`);
  const [title,setTitle] = useState(() => restore('title', record && 'title' in record ? record.title : completePlan?.title ?? (initialJob ? JOBS[initialJob] : '')));
  const [titleAuthored,setTitleAuthored] = useState(() => restore('titleAuthored',!!record || !!completePlan || !!restored?.fields.title));
  const [day,setDay] = useState(() => {
    const draft = restore('day', record && 'day' in record ? record.day : localDay());
    return formatCivilDay(draft) || draft;
  });
  const [odo,setOdo] = useState(() => restore('odo', record && 'odometer' in record ? record.odometer === null ? '' : String(record.odometer) : completionDefaults?.odometer != null ? String(completionDefaults.odometer) : ''));
  const [cost,setCost] = useState(() => restore('cost', record && 'costAgorot' in record ? record.costAgorot === null ? '' : String(record.costAgorot / 100) : completionDefaults?.costAgorot != null ? String(completionDefaults.costAgorot / 100) : ''));
  const [notes,setNotes] = useState(() => restore('notes', record?.notes ?? ''));
  const [garage,setGarage] = useState(() => restore('garage', service?.garage ?? completionDefaults?.garage ?? ''));
  const [jobs,setJobs] = useState<Job[]>(() => restore('jobs', service?.jobs ?? (completePlan ? [completePlan.job] : [])));
  const [completed,setCompleted] = useState(() => restore('completed', service?.completedPlanIds ?? (completePlan ? [completePlan.id] : [])));
  const [job,setJob] = useState<Job>(() => restore('job', plan?.job ?? initialJob ?? 'periodic'));
  const [dueDay,setDueDay] = useState(() => {
    const draft = restore('dueDay', plan?.dueDay ?? '');
    return formatCivilDay(draft) || draft;
  });
  const [dueOdo,setDueOdo] = useState(() => restore('dueOdo', plan?.dueOdometer !== null && plan?.dueOdometer !== undefined ? String(plan.dueOdometer) : ''));
  const [months,setMonths] = useState(() => restore('months', plan?.intervalMonths ? String(plan.intervalMonths) : ''));
  const [km,setKm] = useState(() => restore('km', plan?.intervalKm ? String(plan.intervalKm) : ''));
  const [basis,setBasis] = useState<MaintenancePlan['basis']>(() => restore('basis', plan?.basis ?? 'manual'));
  const [source,setSource] = useState<MaintenancePlan['source']>(() => restore('source', plan?.source ?? 'owner'));
  const [active,setActive] = useState(() => restore('active', plan?.active ?? true));
  const [category,setCategory] = useState(() => restore('category', record && 'category' in record ? record.category : 'other'));
  const [step,setStep] = useState(() => restore('_step', record || completePlan || initialJob || restored || collection === 'odometerReadings' ? 1 : 0));
  const heading = useRef<HTMLHeadingElement>(null);
  const [linkedOpen,setLinkedOpen] = useState(completed.length>0);
  useEffect(()=>{heading.current?.focus();},[step]);
  const [discard,setDiscard] = useState(false);
  const [largeJump,setLargeJump] = useState<{key:string;value:number;minimum:number;maximum:number;ambiguous:boolean}|null>(null);
  const [busy,setBusy] = useState(false);
  const saving = useRef(false);
  const [error,setError] = useState('');
  const errorMessage = useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(error)errorMessage.current?.focus();},[error]);
  const signature=JSON.stringify({id,title,titleAuthored,day,odo,cost,notes,garage,jobs,completed,job,dueDay,dueOdo,months,km,basis,source,active,category});
  const [original]=useState(signature);
  const [storageFailed,setStorageFailed] = useState(false);
  const saved = useRef(false);
  const dirty = !!restored || signature !== original;
  useAppUpdateBlocker((storageFailed && dirty) || busy);
  useEffect(()=>{
    if (!saved.current && dirty) setStorageFailed(!writeCareDraft(draftKey,{fields:{...JSON.parse(signature),_step:step},base:record??null}));
    else if (!saved.current) setStorageFailed(!removeCareDraft(draftKey));
  },[draftKey,signature,record,dirty,step]);
  useEffect(()=>{
    if (!storageFailed) return;
    const preventLoss=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',preventLoss);return()=>window.removeEventListener('beforeunload',preventLoss);
  },[storageFailed,dirty]);
  const close=()=>{if(saving.current)return;if(storageFailed)setDiscard(true);else onClose();};
  const optionalNumber = (value: string) => value.trim() === '' ? null : parseNumberInput(value,'odometer').value;
  async function save(confirmedOdometer?: string) {
    if (saving.current) return; setError('');
    if (confirmedOdometer) setLargeJump(null);
    const recordDay = parseCivilDay(day), targetDay = parseCivilDay(dueDay);
    if (collection === 'maintenancePlans' ? dueDay !== '' && !targetDay : !recordDay) {
      setError('בדקו את התאריך — למשל 05/09/2026.'); return;
    }
    const rawCost = cost.trim() === '' ? null : parseNumberInput(cost,'money').value;
    const cents = rawCost === null ? null : Math.abs(rawCost*100-Math.round(rawCost*100)) < 1e-7 ? Math.round(rawCost*100) : NaN;
    const base = { id, schemaVersion: 1 as const, version: (record?.version ?? 0)+1, notes: notes.trim() };
    const next: CareRecord = collection === 'serviceEvents' ? { ...base, title: title.trim(), day: recordDay!, odometer: optionalNumber(odo), costAgorot: cents, garage: garage.trim(), jobs, completedPlanIds: completed }
      : collection === 'maintenancePlans' ? { ...base, title: title.trim(), job, dueDay: targetDay, dueOdometer: optionalNumber(dueOdo), intervalMonths: basis === 'manual' ? null : optionalNumber(months), intervalKm: basis === 'manual' ? null : optionalNumber(km), basis, source, active }
      : collection === 'vehicleExpenses' ? { ...base, title: title.trim(), day: recordDay!, category, costAgorot: cents }
      : { ...base, day: recordDay!, odometer: optionalNumber(odo) as number, notes: notes.trim() };
    if (!validCareRecord(collection,next) || (collection !== 'maintenancePlans' && recordDay! > localDay())) {
      setError(collection === 'maintenancePlans' ? 'יש להזין שם ויעד בתאריך או בק״מ. מרווח חזרה צריך להיות מספר שלם וחיובי, עם יעד מתאים.' : 'בדקו את השדות: תאריך עד היום, שם, קילומטראז׳ שלם ועלות שאינה שלילית (עד שתי ספרות אחרי הנקודה).'); return;
    }
    // This is a confirmation for a deliberately current reading only. Existing
    // records, historical dates, services, imports and the mileage engine retain
    // their existing validation and same-day ambiguity behavior.
    if (collection === 'odometerReadings' && !record && odometerIntent === 'current' && recordDay === localDay() && currentOdometer && 'odometer' in next && next.odometer !== null) {
      const latest = currentOdometer.ambiguous ? currentOdometer.maximum : currentOdometer.odometer;
      if (next.odometer < latest) {
        setError(`הקריאה נמוכה מקילומטראז׳ שכבר תועד (${latest.toLocaleString('he-IL')} ק״מ). בדקו את המספר או בחרו תאריך היסטורי מתאים.`); return;
      }
      const minimum = next.odometer - (currentOdometer.ambiguous ? currentOdometer.maximum : currentOdometer.odometer);
      const maximum = next.odometer - (currentOdometer.ambiguous ? currentOdometer.minimum : currentOdometer.odometer);
      const key = JSON.stringify([uid,vehicleId,id,recordDay,next.odometer,currentOdometer.day,currentOdometer.odometer,currentOdometer.minimum,currentOdometer.maximum,currentOdometer.ambiguous]);
      if (maximum > 3000 && confirmedOdometer !== key) {
        setLargeJump({key,value:next.odometer,minimum,maximum,ambiguous:currentOdometer.ambiguous}); return;
      }
    }
    setLargeJump(null);
    const isCurrent=captureEditor();
    // Clear this draft at durable local acceptance, before the adapter closes the
    // modal. A stale account/editor completion must not clear a newer draft.
    const accepted=()=>{if(isCurrent()){saved.current=true;removeCareDraft(draftKey);}};
    saving.current=true;setBusy(true);
    try { await onSave(next,record,accepted); accepted(); }
    catch (e) { if(isCurrent()){setError(e instanceof Error ? e.message : 'השמירה לא הושלמה. הפרטים נשארו כאן.');setBusy(false);} }
    finally {saving.current=false;}
  }
  const serviceMode=collection==='serviceEvents',expenseMode=collection==='vehicleExpenses',planMode=collection==='maintenancePlans';
  const selectedLabel=serviceMode?jobs.map(j=>JOBS[j]).filter(Boolean).join(' · ')||'טיפול':expenseMode?EXPENSES[category]??'הוצאה לרכב':JOBS[job]??'טיפול';
  const nextStep=()=>{if(serviceMode&&!jobs.length)return;if(!title.trim())setTitle(selectedLabel);setError('');setStep(1);};
  const choice=(value:string)=>{
    if(serviceMode){const next=jobs.includes(value as Job)?jobs.filter(j=>j!==value):[...jobs,value as Job];setJobs(next);if(!titleAuthored)setTitle(next.map(j=>JOBS[j]).join(' · '));}
    else {if(expenseMode)setCategory(value as typeof category);else setJob(value as Job);if(!titleAuthored)setTitle(expenseMode?EXPENSES[value as keyof typeof EXPENSES]:JOBS[value as Job]);setStep(1);}
  };
  const fullHeight=serviceMode||expenseMode;
  const odometerMode=collection==='odometerReadings';
  const entryHeading=step===0
    ? serviceMode?'מה עשו ברכב?':expenseMode?'על מה ההוצאה?':'למה נזכיר לך?'
    : planMode?'מתי להזכיר לך?':odometerMode?'עדכון קילומטראז׳'
      : record?serviceMode?'עריכת טיפול':'עריכת הוצאה'
        : title.trim()||selectedLabel;
  const showTitle=fullHeight&&(!!record||(serviceMode&&jobs.includes('custom'))||(expenseMode&&category==='other'));
  const hasExtraDetails=planMode||serviceMode||expenseMode&&!showTitle;
  const notesField=<label className="care-entry-notes">
    <span>הערות</span>
    <textarea data-testid="care-notes" aria-label="הערות" dir="rtl" maxLength={2000} value={notes}
      onChange={e=>setNotes(e.target.value)}
      placeholder={serviceMode?'מה הוחלף?':odometerMode?'למשל: לפני נסיעה ארוכה':'מה חשוב לזכור?'} rows={3}/>
  </label>;
  const titleField=<Field label="תיאור" data-testid="care-title" dir="auto" maxLength={120} value={title}
    onChange={e=>{setTitle(e.target.value);setTitleAuthored(true);}}/>;
  const customHeader=fullHeight?<div className="care-entry-top">
    <button type="button" className="tm-icon-button" data-modal-initial-focus
      data-testid={step===1?'care-back':'care-close'} disabled={busy}
      aria-label={step===1?'חזרה לבחירה':'סגירה'} onClick={step===1?()=>setStep(0):close}>
      {step===1?<ChevronEnd size={22}/>:<CloseIcon size={22}/>}
    </button>
    <span data-testid="care-step" data-step={step+1} className="care-entry-step" aria-label={'שלב '+(step+1)+' מתוך 2'}>
      <NumRun>{step+1} / 2</NumRun>
    </span>
    {step===1?<button type="button" className="tm-icon-button" data-testid="care-close" disabled={busy}
      aria-label="סגירה" onClick={close}><CloseIcon size={22}/></button>:<span className="care-entry-top-spacer" aria-hidden="true"/>}
  </div>:undefined;

  return <><Sheet open onClose={close} title={(record?'עריכת ':'')+TITLES[collection]}
    className={fullHeight?'care-entry-sheet':odometerMode?'care-odometer-sheet':''}
    header={customHeader} atmosphereRoute={serviceMode?'/service':expenseMode?'/expense':undefined}>
    <form data-testid="care-entry" data-collection={collection} data-mode={record?'edit':'create'}
      className={'care-editor'+(!planMode?' care-v2-editor':'')} aria-busy={busy||undefined}
      onSubmit={e=>{e.preventDefault();if(step===0)nextStep();else void save();}}>
      <div className={fullHeight?'care-entry-scroll':'care-entry-sheet-content'} data-testid={fullHeight?'care-scroll':'care-sheet-content'}>
        <fieldset disabled={busy} className="care-entry-fields">
          {restored?<p role="status" data-testid="care-draft-restored" className="care-restored"><CheckIcon size={17}/>הטיוטה שוחזרה</p>:null}
          {!odometerMode?<div className={'care-step-heading'+(fullHeight?' care-entry-heading':'')}>
            {!fullHeight&&step===0?<span><NumRun>1 / 2</NumRun></span>:null}
            <h3 ref={heading} tabIndex={-1}><NumericText>{entryHeading}</NumericText></h3>
            {fullHeight&&step===1&&entryHeading!==selectedLabel?<p className="care-entry-category" data-testid="care-selected-label">
              <CareGlyph kind={expenseMode?category:jobs[0]}/><NumericText>{selectedLabel}</NumericText>
            </p>:null}
          </div>:null}

          {step===0?<>
            <div className="care-choice-grid" role="group" aria-label={serviceMode?'מה עשו ברכב?':expenseMode?'סוג הוצאה':'סוג טיפול'}>
              {Object.entries(expenseMode?EXPENSES:JOBS).map(([key,label])=>{
                const selected=serviceMode?jobs.includes(key as Job):expenseMode?category===key:job===key;
                return <button key={key} type="button" className="care-choice" aria-pressed={selected}
                  data-testid={(expenseMode?'care-category-':'care-job-')+key} onClick={()=>choice(key)}>
                  <CareGlyph kind={key}/><span>{label}</span>
                  {selected?<CheckIcon size={16}/>:<span className="care-choice-dot" aria-hidden="true"/>}
                </button>;
              })}
            </div>
            {serviceMode?<p className="care-quiet-note">
              {jobs.length?<><NumericText>{jobs.length===1?'עבודה אחת בחשבונית':jobs.length+' עבודות בחשבונית אחת'}</NumericText> · סכום כולל אחד</>
                :'אפשר לבחור כמה עבודות. העלות נרשמת פעם אחת.'}
            </p>:expenseMode?<p className="care-quiet-note">גם כסף שהוחזר לכם נכנס לכאן.</p>
              :<p className="care-quiet-note">בוחרים טיפול, ואז קובעים מועד לפי ההנחיות שלכם.</p>}
          </>:<>
            {!odometerMode&&!fullHeight?<button type="button" className="care-selection"
              aria-label="שינוי סוג הרשומה" data-testid="care-selection" onClick={()=>setStep(0)}>
              <span className="care-selection-icon"><CareGlyph kind={expenseMode?category:planMode?job:jobs[0]}/></span>
              <span><small>{planMode?'הטיפול הבא':'מה בוצע'}</small><b><NumericText>{selectedLabel}</NumericText></b></span>
              <ChevronStart size={18}/>
            </button>:null}

            {completePlan&&completionDefaults?.previousDay&&!restored&&!record
              &&(completionDefaults.costAgorot!==null||completionDefaults.garage)?<p className="care-quiet-note" data-testid="care-completion-source">
                הצעה מהטיפול ב־<NumericText>{vehicleDay(completionDefaults.previousDay)}</NumericText>:
                {' '}{completionDefaults.costAgorot!==null&&completionDefaults.garage?'עלות ומוסך':completionDefaults.costAgorot!==null?'עלות':'מוסך'}
              </p>:null}
            {showTitle?titleField:null}
            {!planMode?<div className={fullHeight?'care-entry-details':odometerMode?'care-odometer-details':'care-details-group'}>
              {serviceMode||expenseMode?<div className="care-entry-cost">
                <Field label={expenseMode&&category==='refund'?'סכום שהוחזר':'עלות כוללת'} data-testid="care-cost"
                  inputMode="decimal" value={cost} placeholder="לא ידוע" onChange={e=>setCost(e.target.value)} suffix="₪"/>
                <p className="care-quiet-note">
                  {expenseMode&&category==='refund'?'סכום חיובי שהוחזר לכם':<NumericText>ריק אם לא ידוע · 0 אם לא שילמתם</NumericText>}
                </p>
              </div>:null}
              <div className={fullHeight||odometerMode?undefined:'px-4 py-3.5'}>
                <CivilDateField label="תאריך ביצוע" data-testid="care-day" required draftText={day} onDraftTextChange={setDay}/>
              </div>
              {serviceMode?<Field row={!fullHeight} label="קילומטראז׳ בזמן הטיפול"
                data-testid="care-odo" inputMode="numeric" value={odo} onChange={e=>setOdo(e.target.value)}
                suffix="ק״מ" placeholder="הקריאה בלוח הקילומטרים"/>:null}
              {odometerMode?<PumpDisplay className="care-odometer-pump">
                <PumpDisplayRow label="קילומטראז׳" data-testid="care-odo" inputMode="numeric" value={odo}
                  onChange={e=>setOdo(e.target.value)} unit="ק״מ" placeholder="הקריאה בלוח הקילומטרים"
                  caption={!record&&odometerIntent==='current'&&currentOdometer?currentOdometer.ambiguous
                    ? <>באותו יום תועדו <NumRun>{`${int(currentOdometer.minimum)}–${int(currentOdometer.maximum)}`}</NumRun> ק״מ. סדר הקריאות אינו ידוע.</>
                    : <NumericText>{`הקריאה האחרונה: ${int(currentOdometer.odometer)} ק״מ · ${vehicleDay(currentOdometer.day)}`}</NumericText>:undefined}/>
              </PumpDisplay>:null}
            </div>:null}

            {planMode?<>
              <div className="care-details-group">
                <div className="border-b border-line px-4 py-3.5">
                  <CivilDateField label="תאריך יעד" data-testid="care-due-day" draftText={dueDay} onDraftTextChange={setDueDay}/>
                </div>
                <Field row label="יעד קילומטראז׳" inputMode="numeric" value={dueOdo} onChange={e=>setDueOdo(e.target.value)} suffix="ק״מ" placeholder="למשל 180000"/>
              </div>
              <p className="care-quiet-note">אפשר תאריך, קילומטרים או שניהם — המוקדם מביניהם. לפי הוראות היצרן או המוסך שלכם.</p>
              <div className="care-toggle"><span><b>תזכורת חוזרת</b><small>לקבוע גם את הטיפול הבא</small></span>
                <Toggle ariaLabel="תזכורת חוזרת" checked={basis!=='manual'} onChange={checked=>setBasis(checked?'completion':'manual')}/>
              </div>
              {basis!=='manual'?<div className="care-repeat">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="חזרה כל מספר חודשים" inputMode="numeric" value={months} onChange={e=>setMonths(e.target.value)} placeholder="חודשים"/>
                  <Field label="חזרה כל מספר ק״מ" inputMode="numeric" value={km} onChange={e=>setKm(e.target.value)} placeholder="ק״מ"/>
                </div>
                <SelectField label="חישוב המועד הבא" value={basis} onChange={v=>setBasis(v as typeof basis)}>
                  <option value="completion">מהטיפול האחרון שבוצע</option><option value="fixed">לפי יעדים קבועים מהיעד הראשון</option>
                </SelectField>
                <p className="care-quiet-note">חזרה בחודשים דורשת תאריך יעד, וחזרה בק״מ דורשת יעד קילומטראז׳.</p>
              </div>:null}
            </>:null}

            {!planMode?notesField:null}
            {serviceMode&&plans.length?<details className="care-disclosure" open={linkedOpen} onToggle={e=>setLinkedOpen(e.currentTarget.open)}>
              <summary><span>עדכון תזכורות</span><small><NumericText>{completed.length?completed.length===1?'1 סומנה כהושלמה':completed.length+' סומנו כהושלמו':'הטיפול הזה משלים תזכורת?'}</NumericText></small></summary>
              <p className="care-quiet-note">רק התזכורות שתסמנו יתקדמו למועד הבא.</p>
              {plans.filter(p=>p.active||completed.includes(p.id)).map(p=><label key={p.id} className="care-check-row">
                <input type="checkbox" data-testid={'care-completed-'+p.id} checked={completed.includes(p.id)}
                  disabled={!completed.includes(p.id)&&completed.length>=8}
                  onChange={e=>setCompleted(prev=>e.target.checked?[...prev,p.id]:prev.filter(id=>id!==p.id))}/>
                <span><NumericText>{p.title}</NumericText></span>
              </label>)}
            </details>:null}
            {hasExtraDetails?<details className="care-disclosure">
              <summary><span>עוד פרטים</span><small>{planMode?'תיאור, מקור ההנחיה והערות':serviceMode?showTitle?'מוסך':'תיאור ומוסך':'תיאור'}</small></summary>
              <div className="care-entry-extra">
                {!showTitle&&!odometerMode?titleField:null}
                {serviceMode?<Field label="מוסך / ספק" data-testid="care-garage" dir="auto" value={garage} maxLength={160} onChange={e=>setGarage(e.target.value)}/>:null}
                {planMode?<>
                  <SelectField label="מקור ההנחיה" value={source} onChange={v=>setSource(v as typeof source)}>
                    <option value="owner">הגדרה שלי</option><option value="manufacturer">הוראות יצרן</option><option value="garage">המלצת מוסך</option>
                  </SelectField>
                  <div className="care-toggle"><span>תזכורת פעילה</span><Toggle ariaLabel="תזכורת פעילה" checked={active} onChange={setActive}/></div>
                  {notesField}
                </>:null}
              </div>
            </details>:null}
          </>}
        </fieldset>
        {error?<p ref={errorMessage} tabIndex={-1} role="alert" data-testid="care-error" className="care-form-error"><NumericText>{error}</NumericText></p>:null}
        {storageFailed?<p role="alert" data-testid="care-draft-error" className="care-form-error">לא ניתן לשמור טיוטה במכשיר. השאירו את הטופס פתוח.</p>:null}
      </div>
      <div className={'care-editor-footer'+(fullHeight?' care-entry-footer':'')}>
        {step===0&&serviceMode?<Button type="submit" data-testid="care-next" aria-label="המשך לפרטי הטיפול" full disabled={!jobs.length||busy}>המשך<ChevronStart size={18}/></Button>
          :step===1?<Button type="submit" data-testid="care-save" aria-label={'שמירת '+TITLES[collection]} loading={busy} full>{fullHeight?'שמירה':'שמירת '+TITLES[collection]}</Button>:null}
        {dirty?<div className="care-draft-status" data-testid="care-draft" data-draft-state={storageFailed?'failed':'saved'}>
          <span>{storageFailed?'הטיוטה לא נשמרה':'טיוטה נשמרת במכשיר'}</span>
          <button type="button" disabled={busy} onClick={()=>setDiscard(true)}>מחיקת הטיוטה</button>
        </div>:null}
      </div>
    </form>
  </Sheet><ConfirmDialog open={discard} title="למחוק את הטיוטה?" body="הפרטים שערכתם עדיין לא נשמרו ביומן."
    confirmLabel="יציאה ללא שמירה" cancelLabel="המשך עריכה"
    onConfirm={()=>{if(!removeCareDraft(draftKey)){setError('לא ניתן למחוק את הטיוטה מהמכשיר. נסו שוב.');setDiscard(false);return;}saved.current=true;onClose();}}
    onCancel={()=>setDiscard(false)}/>
    <ConfirmDialog open={largeJump!==null} title="הקילומטראז׳ נכון?" tone="accent" confirmLabel="כן, זו הקריאה" cancelLabel="לתקן את המספר"
      body={largeJump?<p>{largeJump.ambiguous
        ? <>הזנתם <NumRun>{int(largeJump.value)}</NumRun> ק״מ. הפער מהקריאות שתועדו באותו יום הוא <NumRun>{`${int(largeJump.minimum)}–${int(largeJump.maximum)}`}</NumRun> ק״מ; סדרן אינו ידוע.</>
        : <NumericText>{`הזנתם ${int(largeJump.value)} ק״מ — תוספת של ${int(largeJump.maximum)} ק״מ מהקריאה האחרונה.`}</NumericText>}</p>:null}
      onCancel={()=>setLargeJump(null)} onConfirm={()=>{if(largeJump)void save(largeJump.key);}}/></>;
}
