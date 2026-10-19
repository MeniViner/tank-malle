import { Field } from '../components/Field';
import { CareTransfer } from '../components/maintenance/CareTransfer';
import { careCalendar, downloadCareFile } from '../lib/maintenance/export';
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { useMaintenance } from '../hooks/useMaintenance';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ConfirmDialog } from '../components/Sheet';
import { CareEditor, SelectField } from '../components/maintenance/CareEditor';
import { dueStatus, latestMileage, localDay, nextDue, mileageIssue, serviceJobs, EXPENSES, type CareCollection, type CareRecord, type MaintenancePlan, type ServiceEvent, type VehicleExpense } from '../lib/maintenance/model';
import { vehicleLabel } from '../lib/format';

const money = (agorot: number | null) => agorot === null ? 'עלות לא ידועה' : new Intl.NumberFormat('he-IL',{ style: 'currency', currency: 'ILS', maximumFractionDigits: 2 }).format(agorot/100);
const dayLabel = (day: string) => new Intl.DateTimeFormat('he-IL').format(new Date(`${day}T12:00:00`));
const STATUS = { done: 'הושלם', due: 'הגיע הזמן', soon: 'מתקרב', unknown: 'נדרש עדכון ק״מ', later: 'בהמשך' };
interface Editing { collection: CareCollection; record?: CareRecord; completePlan?: MaintenancePlan }

export function Maintenance() {
  const { user } = useAuth(); const { activeVehicle } = useData();
  if (!user || !activeVehicle) return <main className="p-5"><h1>הרכב שלי</h1><p>בחרו רכב פעיל כדי לנהל תחזוקה.</p><Link to="/settings/vehicles">רכבים וארכיון</Link></main>;
  return <CareWorkspace key={`${user.uid}/${activeVehicle.id}`} uid={user.uid} vehicleId={activeVehicle.id} label={vehicleLabel(activeVehicle)} />;
}
function CareWorkspace({ uid,vehicleId,label }: { uid:string;vehicleId:string;label:string }) {
  const { data, loading, cached, errors, malformed } = useMaintenance(uid,vehicleId);
  const { fillups, loadingFillups, fillupsError, malformedFillups, outbox, saveCareRecord, deleteCareRecord } = useData();
  const { showToast } = useToast();
  const [transfer,setTransfer] = useState(false);
  const [tab,setTab] = useState<'upcoming'|'history'|'costs'>('upcoming');
  const [editing,setEditing] = useState<Editing | null>(null);
  const [deleting,setDeleting] = useState<Editing | null>(null);
  const [actionError,setActionError] = useState('');
  const [deletingBusy,setDeletingBusy] = useState(false);
  const [period,setPeriod] = useState('year');
  const [today,setToday] = useState(()=>localDay());
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;const resume=()=>setToday(localDay());window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);return()=>{mounted.current=false;window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};},[]);
  const [historyQuery,setHistoryQuery]=useState('');const [historyLimit,setHistoryLimit]=useState(50);
  const mileage = latestMileage([...data.odometerReadings,...data.serviceEvents.filter(e=>e.odometer!==null).map(e=>({ day:e.day, odometer:e.odometer! })), ...fillups.map(f=>({ day:localDay(new Date(f.date)),odometer:f.odometer }))],today);
  const fromDay = period === 'month' ? today.slice(0,7)+'-01' : period === 'year' ? today.slice(0,4)+'-01-01' : '1900-01-01';
  const services = data.serviceEvents.filter(e=>e.day>=fromDay && e.day<=today);
  const expenses = data.vehicleExpenses.filter(e=>e.day>=fromDay && e.day<=today);
  const fuel = fillups.filter(f=>localDay(new Date(f.date))>=fromDay && localDay(new Date(f.date))<=today).reduce((sum,f)=>sum+Math.round(f.totalCost*100),0);
  const sum = (rows: { costAgorot: number | null }[]) => rows.reduce((s,r)=>s+(r.costAgorot??0),0);
  const unknownCosts = [...services,...expenses].filter(r=>r.costAgorot===null).length;
  const pending = (id:string) => outbox.some(o=>o.vehicleId===vehicleId && o.docId===id && o.kind.startsWith('maintenance.'));
  const upcoming = data.maintenancePlans.filter(p=>p.active).map(plan=>({plan,due:nextDue(plan,data.serviceEvents)}));
  const order = { due:0, soon:1, unknown:2, later:3, done:4 };
  upcoming.sort((a,b)=>order[dueStatus(a.due,mileage,today)]-order[dueStatus(b.due,mileage,today)] || (a.due.day??'9999').localeCompare(b.due.day??'9999'));
  const history = [ ...data.serviceEvents.map(record=>({collection:'serviceEvents' as const,record})), ...data.vehicleExpenses.map(record=>({collection:'vehicleExpenses' as const,record})), ...data.odometerReadings.map(record=>({collection:'odometerReadings' as const,record})) ].filter(({record})=>!historyQuery.trim() || `${'title' in record ? record.title : 'עדכון קילומטראז׳'} ${record.notes} ${record.day} ${'garage' in record ? record.garage : ''}`.toLocaleLowerCase('he-IL').includes(historyQuery.trim().toLocaleLowerCase('he-IL'))).sort((a,b)=>b.record.day.localeCompare(a.record.day));
  async function save(record:CareRecord) {
    if (!editing) return;
    if ('odometer' in record && record.odometer !== null) {
      const others = [...data.odometerReadings.filter(r=>r.id!==record.id), ...data.serviceEvents.filter(r=>r.id!==record.id && r.odometer!==null).map(r=>({day:r.day,odometer:r.odometer!})), ...fillups.map(f=>({day:localDay(new Date(f.date)),odometer:f.odometer}))];
      const issue = mileageIssue({day:record.day,odometer:record.odometer},others);
      if (issue) throw new Error(issue);
    }
    const receipt = await saveCareRecord(vehicleId,editing.collection,record,editing.record);
    if(!mounted.current)return;
    setEditing(null); showToast({ tone:'success', title:'נשמר במכשיר — ממתין לסנכרון' });
    void receipt.settled.then(ok=> { if (!ok && mounted.current) showToast({ tone:'error', title:'הסנכרון לא הושלם — הפרטים נשמרו בפעולות שלא סונכרנו' }); });
  }
  return <main className="flex flex-1 flex-col pb-[112px] pt-safe">
    <AppHeader />
    <div className="tm-page flex flex-col gap-4">
      <div><p className="text-sm text-muted">{label}</p><h1 className="font-display text-3xl font-bold">הרכב שלי</h1><p className="mt-1 text-sm text-muted">טיפולים, תזכורות והוצאות — במקום אחד</p></div>
      <Card className="flex p-4 items-center justify-between gap-2"><div><p className="text-xs text-muted">קריאת קילומטרים אחרונה</p><p className="font-bold">{mileage ? <><bdi>{mileage.odometer.toLocaleString('he-IL')}</bdi> ק״מ</> : 'עדיין אין קריאה'}</p>{mileage ? <p className="text-xs text-muted">נמדד ב־{dayLabel(mileage.day)}</p> : null}</div><Button size="sm" variant="secondary" onClick={()=>setEditing({collection:'odometerReadings'})}>עדכון ק״מ</Button></Card>
      <div className="grid grid-cols-2 gap-2"><Button onClick={()=>setEditing({collection:'serviceEvents'})}>הוספת טיפול</Button><Button variant="secondary" onClick={()=>setEditing({collection:'vehicleExpenses'})}>הוספת הוצאה</Button></div>
      {errors.length ? <div role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">לא ניתן לקרוא חלק מנתוני התחזוקה. הנתונים המוצגים אינם מלאים. <Button size="sm" variant="ghost" onClick={()=>window.location.reload()}>ניסיון חוזר</Button></div> : null}
      {fillupsError || malformedFillups.length ? <p role="alert" className="text-sm text-danger">חלק מנתוני התדלוק אינם זמינים. סיכומי העלות והקילומטראז׳ עלולים להיות חלקיים.</p> : null}
      {malformed ? <p role="alert" className="text-sm text-danger">{malformed} רשומות לא ניתנות לקריאה בגרסה זו; הסיכומים חלקיים.</p> : null}
      {cached.length ? <p role="status" className="text-xs text-muted">מוצגים נתונים מהמכשיר; ייתכן שטרם התקבל כל המידע מהשרת.</p> : null}
      {outbox.some(o=>o.vehicleId===vehicleId&&o.kind.startsWith('maintenance.')) ? <Link to="/settings/unsynced" className="rounded-xl bg-warning-soft p-3 text-sm text-warning-ink">יש רשומות תחזוקה שטרם סונכרנו — הצגת מצב השמירה</Link> : null}
      <div className="flex rounded-xl bg-surface-2 p-1" role="group" aria-label="תצוגת תחזוקה">{(['upcoming','history','costs'] as const).map((value,i)=><button key={value} type="button" className={`min-h-11 min-w-0 flex-1 rounded-lg px-2 text-sm font-semibold ${tab===value?'bg-surface text-ink shadow-sm':'text-muted'}`} aria-pressed={tab===value} onClick={()=>setTab(value)}>{['מה מתקרב','היסטוריה','עלויות'][i]}</button>)}</div>
      {loading && !errors.length ? <p role="status">טוענים את נתוני הרכב…</p> : null}
      {tab==='upcoming' ? <>
        <Button variant="secondary" onClick={()=>setEditing({collection:'maintenancePlans'})}>הוספת תזכורת לטיפול</Button>
        {!loading && !upcoming.length ? <Card className="p-4"><h2 className="min-w-0 break-words font-bold">מה הטיפול הבא שלכם?</h2><p className="mt-1 text-sm text-muted">הוסיפו יעד לפי הוראות היצרן או המוסך. אפשר לקבוע תאריך, קילומטרים או את שניהם.</p></Card> : null}
        {upcoming.map(({plan,due})=>{ const status=dueStatus(due,mileage,today); return <Card key={plan.id} className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2"><h2 className="min-w-0 break-words font-bold">{plan.title}</h2><span className={`rounded-pill px-2 py-1 text-xs ${status==='due'?'bg-warning-soft text-warning-ink':status==='soon'?'bg-accent-soft text-accent':'bg-surface-2 text-muted'}`}>{STATUS[status]}</span></div>
          <p className="text-sm text-muted">{due.day ? dayLabel(due.day) : ''}{due.day && due.odometer!==null ? ' או ' : ''}{due.odometer!==null ? `${due.odometer.toLocaleString('he-IL')} ק״מ` : ''}{due.day && due.odometer!==null ? ' — המוקדם מביניהם' : ''}{due.needsMileage || (!due.day && due.odometer===null && !due.completed) ? 'נדרשת קריאת ק״מ מהטיפול האחרון כדי לחשב יעד חדש.' : ''}</p>
          <p className="text-xs text-muted">מקור: {{owner:'הגדרה שלי',manufacturer:'הוראות יצרן',garage:'המלצת מוסך'}[plan.source]}</p>
          <div className="flex flex-wrap gap-2">{!due.completed ? <Button full size="sm" disabled={pending(plan.id)} onClick={()=>setEditing({collection:'serviceEvents',completePlan:plan})}>רישום טיפול שבוצע</Button> : null}<Button size="sm" variant="ghost" disabled={pending(plan.id)} onClick={()=>setEditing({collection:'maintenancePlans',record:plan})}>עריכת תזכורת</Button>{due.day && !due.completed ? <Button size="sm" variant="ghost" onClick={()=>{
            const calendar=careCalendar(vehicleId,plan,data); if(calendar) {downloadCareFile(calendar,'tank-maleh-reminder.ics','text/calendar;charset=utf-8'); showToast({tone:'info',title:'תזכורת הוכנה ליומן',detail:'קובץ חד פעמי. שינויים באפליקציה לא יעדכנו אותו אוטומטית.'});}
          }}>הוספה ליומן</Button> : null}<Button size="sm" variant="ghost" disabled={pending(plan.id)} onClick={()=>setDeleting({collection:'maintenancePlans',record:plan})}>מחיקה</Button></div>
        </Card>; })}
        {data.maintenancePlans.filter(p=>!p.active).map(plan=><Button variant="ghost" key={plan.id} onClick={()=>setEditing({collection:'maintenancePlans',record:plan})}>{plan.title} · תזכורת מושהית</Button>)}
        <p className="text-xs text-muted">התזכורות מוצגות באפליקציה לפי הנתונים שנרשמו. אין כאן קביעה אוטומטית של מרווחי טיפול לרכב.</p>
      </> : null}
      {tab==='history' ? <>
        <Field label="חיפוש בהיסטוריית הרכב" value={historyQuery} onChange={e=>{setHistoryQuery(e.target.value);setHistoryLimit(50);}} placeholder="שם טיפול, מוסך או הערה" />
        {!loading && !history.length ? <Card className="p-4"><h2 className="min-w-0 break-words font-bold">{historyQuery ? "לא נמצאו רשומות בחיפוש" : "ההיסטוריה מתחילה כאן"}</h2><p className="text-sm text-muted">רשמו טיפול, החלפת צמיגים או הוצאה. אפשר להוסיף גם טיפולים קודמים.</p></Card> : null}
        {history.slice(0,historyLimit).map(({collection,record})=><Card key={`${collection}/${record.id}`} className="flex flex-col gap-2 p-4"><div className="flex items-start justify-between gap-2"><h2 className="min-w-0 break-words font-bold">{'title' in record ? record.title : 'עדכון קילומטראז׳'}</h2><span className="shrink-0 text-xs text-muted">{dayLabel(record.day)}</span></div>
          {collection==='serviceEvents' ? <p className="text-xs text-muted">{serviceJobs(record as ServiceEvent)}</p> : collection==='vehicleExpenses' ? <p className="text-xs text-muted">{EXPENSES[(record as VehicleExpense).category]}</p> : null}
          <p className="text-sm">{'costAgorot' in record ? money(record.costAgorot) : ''}{'odometer' in record && record.odometer!==null ? ` · ${record.odometer.toLocaleString('he-IL')} ק״מ` : ''}</p>
          {record.notes ? <p className="whitespace-pre-wrap break-words text-sm text-muted">{record.notes}</p> : null}
          <div className="flex gap-2"><Button size="sm" variant="ghost" disabled={pending(record.id)} onClick={()=>setEditing({collection,record})}>עריכה</Button><Button size="sm" variant="ghost" disabled={pending(record.id)} onClick={()=>setDeleting({collection,record})}>מחיקה</Button>{pending(record.id)?<span className="self-center text-xs text-muted">ממתין לסנכרון</span>:null}</div>
        </Card>)}
      </> : null}
      {tab==='history' && history.length>historyLimit ? <Button variant="secondary" onClick={()=>setHistoryLimit(n=>n+50)}>הצגת רשומות נוספות ({history.length-historyLimit})</Button> : null}
      {tab==='costs' ? <>
        <SelectField label="תקופת הסיכום" value={period} onChange={setPeriod}><option value="year">השנה</option><option value="month">החודש</option><option value="all">כל התקופה</option></SelectField>
        <Card className="p-4"><p className="text-sm text-muted">סך העלויות שתועדו</p><p className="mt-1 text-3xl font-bold tabular-nums" data-testid="care-total">{money(fuel+sum(services)+sum(expenses))}</p><p className="mt-2 text-xs text-muted">{unknownCosts ? `${unknownCosts} רשומות ללא עלות אינן נכללות בסכום.` : 'כולל הוצאות ותדלוקים שנרשמו בתקופה בלבד.'}{loadingFillups || loading || errors.length || fillupsError || malformedFillups.length ? ' הסיכום עדיין חלקי.' : ''}</p></Card>
        <Card className="p-4"><dl className="flex flex-col gap-3">{[['דלק',fuel],['טיפולים ותחזוקה',sum(services)],['הוצאות נוספות',sum(expenses)]].map(([name,total])=><div key={name} className="flex justify-between gap-2"><dt>{name}</dt><dd className="font-bold">{money(Number(total))}</dd></div>)}</dl></Card>
        <p className="text-xs text-muted">עלות חשבונית טיפול נספרת פעם אחת, גם כשנרשמו בה כמה עבודות. ירידת ערך ועלויות שלא הוזנו אינן נכללות.</p>
      </> : null}
      <Button variant="ghost" disabled={loading && !errors.length} onClick={()=>setTransfer(true)}>גיבוי וייצוא תחזוקה</Button>
      {actionError ? <p role="alert" className="text-sm text-danger">{actionError}</p> : null}
    </div>
    {transfer ? <CareTransfer vehicleId={vehicleId} label={label} data={data} incomplete={loading || !!cached.length || !!errors.length || !!malformed || outbox.some(o=>o.vehicleId===vehicleId&&o.kind.startsWith('maintenance.'))} canImport={!loading && !cached.length && !errors.length && !malformed && !outbox.some(o=>o.vehicleId===vehicleId&&o.kind.startsWith('maintenance.'))} onSave={(name,record)=>saveCareRecord(vehicleId,name,record)} onClose={()=>setTransfer(false)} /> : null}
    {editing ? <CareEditor collection={editing.collection} record={editing.record} completePlan={editing.completePlan} plans={data.maintenancePlans} onClose={()=>setEditing(null)} onSave={save} /> : null}
    <ConfirmDialog open={!!deleting} title="מחיקת רשומה" body="הרשומה תוסר מההיסטוריה, מהעלויות ומחישוב הטיפול הבא. פעולה זו תשפיע גם על התזכורות הקשורות אליה." confirmLabel={deletingBusy?'מוחקים…':'מחיקת הרשומה'} onCancel={()=>{if(!deletingBusy)setDeleting(null);}} onConfirm={()=>{
      if (!deleting?.record || deletingBusy) return; setDeletingBusy(true); setActionError('');
      void deleteCareRecord(vehicleId,deleting.collection,deleting.record).then(async receipt=>{setDeleting(null); if (await receipt.settled) showToast({tone:'success',title:'הרשומה נמחקה'}); else showToast({tone:'error',title:'המחיקה לא הושלמה — בדקו פעולות שלא סונכרנו'});}).catch(()=>setActionError('לא ניתן להשלים את המחיקה. הרשומה לא נשלחה מחדש.')).finally(()=>setDeletingBusy(false));
    }} />
  </main>;
}
