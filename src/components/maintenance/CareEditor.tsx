import { useState, useRef, type ReactNode } from 'react';
import { Field } from '../Field';
import { Button } from '../Button';
import { Sheet, ConfirmDialog } from '../Sheet';
import { JOBS, EXPENSES, localDay, validCareRecord, type CareCollection, type CareRecord, type Job, type MaintenancePlan } from '../../lib/maintenance/model';
import { parseNumberInput } from '../../lib/numeric';

const TITLES: Record<CareCollection,string> = { serviceEvents: 'טיפול שבוצע', maintenancePlans: 'תזכורת לטיפול', vehicleExpenses: 'הוצאה לרכב', odometerReadings: 'עדכון קילומטראז׳' };
export function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="flex flex-col gap-1.5 text-sm font-semibold text-muted">{label}<select className="min-h-12 w-full min-w-0 rounded-xl border border-line bg-surface p-3 text-base text-ink" value={value} onChange={e=>onChange(e.target.value)}>{children}</select></label>;
}
export function CareEditor({ collection, record, plans, completePlan, onClose, onSave }: {
  collection: CareCollection; record?: CareRecord; plans: MaintenancePlan[]; completePlan?: MaintenancePlan;
  onClose: () => void; onSave: (record: CareRecord) => Promise<void>;
}) {
  const service = record && 'jobs' in record ? record : null;
  const plan = record && 'dueDay' in record ? record : null;
  const [id] = useState(() => record?.id ?? crypto.randomUUID());
  const [title,setTitle] = useState(record && 'title' in record ? record.title : completePlan?.title ?? '');
  const [day,setDay] = useState(record && 'day' in record ? record.day : localDay());
  const [odo,setOdo] = useState(record && 'odometer' in record && record.odometer !== null ? String(record.odometer) : '');
  const [cost,setCost] = useState(record && 'costAgorot' in record && record.costAgorot !== null ? String(record.costAgorot / 100) : '');
  const [notes,setNotes] = useState(record?.notes ?? '');
  const [garage,setGarage] = useState(service?.garage ?? '');
  const [jobs,setJobs] = useState<Job[]>(service?.jobs ?? [completePlan?.job ?? 'periodic']);
  const [completed,setCompleted] = useState(service?.completedPlanIds ?? (completePlan ? [completePlan.id] : []));
  const [job,setJob] = useState<Job>(plan?.job ?? 'periodic');
  const [dueDay,setDueDay] = useState(plan?.dueDay ?? '');
  const [dueOdo,setDueOdo] = useState(plan?.dueOdometer !== null && plan?.dueOdometer !== undefined ? String(plan.dueOdometer) : '');
  const [months,setMonths] = useState(plan?.intervalMonths ? String(plan.intervalMonths) : '');
  const [km,setKm] = useState(plan?.intervalKm ? String(plan.intervalKm) : '');
  const [basis,setBasis] = useState<MaintenancePlan['basis']>(plan?.basis ?? 'completion');
  const [source,setSource] = useState<MaintenancePlan['source']>(plan?.source ?? 'owner');
  const [active,setActive] = useState(plan?.active ?? true);
  const [category,setCategory] = useState(record && 'category' in record ? record.category : 'other');
  const [discard,setDiscard] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const signature=JSON.stringify({title,day,odo,cost,notes,garage,jobs,completed,job,dueDay,dueOdo,months,km,basis,source,active,category});
  const original=useRef(signature);
  const close=()=>{if(busy)return;if(signature!==original.current)setDiscard(true);else onClose();};
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
    try { await onSave(next); } catch (e) { setError(e instanceof Error ? e.message : 'השמירה לא הושלמה. הפרטים נשארו כאן.'); setBusy(false); }
  }
  return <><Sheet open onClose={close} title={<h2 className="text-lg font-bold">{record ? 'עריכת ' : ''}{TITLES[collection]}</h2>}>
    <form className="flex flex-col gap-4" onSubmit={e=>{ e.preventDefault(); void save(); }}>
      {collection !== 'odometerReadings' ? <Field label="שם הרשומה" maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} placeholder={collection === 'serviceEvents' ? 'למשל: טיפול שנתי והחלפת צמיגים' : collection === 'maintenancePlans' ? 'למשל: החלפת שמן' : 'למשל: ביטוח שנתי'} /> : null}
      {collection !== 'maintenancePlans' ? <Field type="date" label="תאריך ביצוע" value={day} max={localDay()} onChange={e=>setDay(e.target.value)} /> : null}
      {collection === 'serviceEvents' || collection === 'odometerReadings' ? <Field label="קילומטראז׳ בעת הביצוע" inputMode="numeric" value={odo} onChange={e=>setOdo(e.target.value)} suffix="ק״מ" hint={collection === 'serviceEvents' ? 'אפשר להשאיר ריק אם הקריאה אינה ידועה.' : 'מד מרחק מצטבר בק״מ, ולא Trip.'} /> : null}
      {collection === 'serviceEvents' || collection === 'vehicleExpenses' ? <Field label="עלות כוללת" inputMode="decimal" value={cost} onChange={e=>setCost(e.target.value)} suffix="₪" hint="ריק = עלות לא ידועה. 0 = ללא תשלום. סכום אחד לכל החשבונית." /> : null}
      {collection === 'serviceEvents' ? <>
        <fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-sm font-semibold">מה בוצע?</legend><div className="grid grid-cols-2 gap-1">{Object.entries(JOBS).map(([key,label])=><label className="flex min-h-11 items-center gap-2 text-sm" key={key}><input type="checkbox" className="size-5" checked={jobs.includes(key as Job)} onChange={e=>setJobs(prev=> e.target.checked ? [...prev,key as Job] : prev.filter(j=>j!==key))} />{label}</label>)}</div></fieldset>
        <Field label="מוסך / ספק" value={garage} maxLength={160} onChange={e=>setGarage(e.target.value)} />
        {plans.length ? <fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-sm font-semibold">אילו תזכורות הטיפול הזה משלים?</legend><p className="mb-2 text-xs text-muted">רק התזכורות שסומנו יתקדמו למועד הבא.</p>{plans.filter(p=>p.active || completed.includes(p.id)).map(p=><label key={p.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={completed.includes(p.id)} onChange={e=>setCompleted(prev=>e.target.checked ? [...prev,p.id] : prev.filter(id=>id!==p.id))} />{p.title}</label>)}</fieldset> : null}
      </> : null}
      {collection === 'vehicleExpenses' ? <SelectField label="סוג הוצאה" value={category} onChange={value=>setCategory(value as typeof category)}>{Object.entries(EXPENSES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</SelectField> : null}
      {collection === 'maintenancePlans' ? <>
        <SelectField label="סוג טיפול" value={job} onChange={v=>setJob(v as Job)}>{Object.entries(JOBS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</SelectField>
        <p className="text-sm text-muted">הזינו לפי הוראות היצרן או המוסך. אם הוגדרו שני יעדים, הטיפול נדרש כשאחד מהם מגיע.</p>
        <Field label="תאריך יעד" type="date" value={dueDay} onChange={e=>setDueDay(e.target.value)} />
        <Field label="יעד קילומטראז׳" inputMode="numeric" value={dueOdo} onChange={e=>setDueOdo(e.target.value)} suffix="ק״מ" />
        <SelectField label="מקור ההנחיה" value={source} onChange={v=>setSource(v as typeof source)}><option value="owner">הגדרה שלי</option><option value="manufacturer">הוראות יצרן</option><option value="garage">המלצת מוסך</option></SelectField>
        <SelectField label="חישוב המועד הבא" value={basis} onChange={v=>setBasis(v as typeof basis)}><option value="completion">מהטיפול האחרון שבוצע</option><option value="fixed">לפי יעדים קבועים מהיעד הראשון</option><option value="manual">חד פעמי / יעד ידני</option></SelectField>
        {basis !== 'manual' ? <><Field label="חזרה כל מספר חודשים" inputMode="numeric" value={months} onChange={e=>setMonths(e.target.value)} hint="אופציונלי. דורש תאריך יעד." /><Field label="חזרה כל מספר ק״מ" inputMode="numeric" value={km} onChange={e=>setKm(e.target.value)} hint="אופציונלי. דורש יעד קילומטראז׳." /></> : null}
        <label className="flex min-h-11 items-center gap-2 text-sm"><input className="size-5" type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} />תזכורת פעילה</label>
      </> : null}
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-muted">הערות<textarea className="min-h-24 rounded-xl border border-line bg-surface p-3 text-base text-ink" maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)} /></label>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" loading={busy} full>שמירת {TITLES[collection]}</Button>
    </form>
  </Sheet><ConfirmDialog open={discard} title="לצאת בלי לשמור?" body="פרטי התחזוקה שהוזנו עדיין לא נשמרו." confirmLabel="יציאה ללא שמירה" cancelLabel="המשך עריכה" onConfirm={onClose} onCancel={()=>setDiscard(false)} /></>;
}
