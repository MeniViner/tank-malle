import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useVehicleData } from '../context/VehicleDataContext';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { VehiclePage, CoverageNotice, VehicleInfo } from '../components/VehicleUI';
import { RunningCosts } from '../components/RunningCosts';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/Sheet';
import { NumericText, NumRun } from '../components/Fmt';
import { CalendarIcon, ChevronStart, PencilIcon, TrashIcon, WarningIcon, CheckIcon } from '../components/icons';
import { useAccountScope } from '../components/account/useAccountScope';
import { observeVehicleRecordDeletion } from '../components/vehicleRecordDeletion';
import { careCalendar, downloadCareFile } from '../lib/maintenance/export';
import { vehicleMoney, vehicleDay } from '../lib/vehicle/format';
import type { VehicleIssue } from '../lib/vehicle/model';

export function VehicleYear() {
  const { year = '' } = useParams();
  const v = useVehicleData();
  if (!/^\d{4}$/.test(year)) return <VehiclePage title="לא נמצאה שנה" back="/vehicle?tab=costs"><p>בחרו שנה מאזור הרכב.</p></VehiclePage>;
  const count = v.ledger.filter(row => row.day.startsWith(year)).length;
  return <VehiclePage title={`שנת ${year}`} back="/vehicle?tab=costs"><CoverageNotice/><RunningCosts from={`${year}-01-01`} to={`${year}-12-31`} year={year}/><Link className="tm-vehicle-link tm-vehicle-links" to={`/history?year=${year}`}>כל הרשומות של השנה<ChevronStart size={18}/></Link><p className="tm-vehicle-note"><NumericText>{`${count} ${count === 1 ? 'רשומה' : 'רשומות'} בשנה זו.`}</NumericText></p></VehiclePage>;
}

export function ReminderDetail() {
  const { scope } = useVehicleData();
  const { planId } = useParams();
  return <ReminderDetailContent key={`${scope}/${planId}`}/>;
}

function ReminderDetailContent() {
  const { planId } = useParams();
  const v = useVehicleData();
  const data = useData();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const captureScope = useAccountScope(v.scope);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const item = v.reminders.find(row => row.plan.id === planId);
  if (!item) return <VehiclePage title="תזכורת" back="/vehicle"><p>{v.care.loading ? 'טוענים…' : 'התזכורת אינה זמינה ברכב הפעיל.'}</p></VehiclePage>;
  const { plan, due } = item;
  const events = v.care.data.serviceEvents.filter(event => event.completedPlanIds.includes(plan.id));
  const intervals = [plan.intervalMonths !== null ? plan.intervalMonths === 1 ? 'כל חודש' : `כל ${plan.intervalMonths} חודשים` : null, plan.intervalKm !== null ? `כל ${plan.intervalKm.toLocaleString('he-IL')} ק״מ` : null].filter(Boolean).join(' או ');
  return <VehiclePage title={plan.title} back="/vehicle">
    <CoverageNotice/>
    <section className="tm-vehicle-detail-hero"><span className="tm-vehicle-eyebrow">המועד הבא · {{ completion: 'מההשלמה', fixed: 'מחזור קבוע', manual: 'הגדרה ידנית' }[plan.basis]}</span><h2><NumericText>{due.completed ? 'הטיפול תועד' : due.day ? vehicleDay(due.day) : 'לפי קילומטראז׳'}</NumericText></h2>{due.odometer !== null ? <p><NumericText>{`${due.day ? 'או ' : ''}${due.odometer.toLocaleString('he-IL')} ק״מ${due.day ? ' · המוקדם מביניהם' : ''}`}</NumericText></p> : null}<p>{due.needsMileage ? 'נדרשת קריאת ק״מ בטיפול האחרון כדי לחשב את היעד הבא.' : plan.active ? 'התזכורת פעילה' : 'התזכורת מושהית'}</p>{plan.basis !== 'manual' && intervals ? <p className="tm-vehicle-note"><NumericText>{intervals}</NumericText></p> : null}</section>
    {!due.completed ? <Button full onClick={() => v.edit({ collection: 'serviceEvents', completePlan: plan })}>רישום טיפול שבוצע</Button> : null}
    <div className="tm-vehicle-links">
      <button className="tm-vehicle-link" type="button" onClick={() => v.edit({ collection: 'maintenancePlans', record: plan })}><PencilIcon size={19}/><span>עריכת התזכורת</span><ChevronStart size={18}/></button>
      <Link className="tm-vehicle-link" to={`/history?kind=service&plan=${encodeURIComponent(plan.id)}`}><span>היסטוריית הטיפולים<small><NumericText>{`${events.length} ${events.length === 1 ? 'טיפול מקושר' : 'טיפולים מקושרים'}`}</NumericText></small></span><ChevronStart size={18}/></Link>
      {due.day && !due.completed ? <button className="tm-vehicle-link" type="button" onClick={() => { const now = new Date(); const calendar = careCalendar(v.vehicleId, plan, v.care.data, now); if (calendar) downloadCareFile(calendar, 'tank-maleh-reminder.ics', 'text/calendar;charset=utf-8', now); }}><CalendarIcon size={19}/><span>הוספה ליומן המכשיר</span><span aria-hidden="true">↓</span></button> : null}
      <Link className="tm-vehicle-link" to="/notifications"><span>דחיית הופעת ההתראה</span><ChevronStart size={18}/></Link>
      <button className="tm-vehicle-link text-danger" type="button" onClick={() => setDeleting(true)}><TrashIcon size={19}/><span>מחיקת התזכורת</span></button>
    </div>
    <p className="tm-vehicle-note">מקור: {{ owner: 'הגדרה שלי', garage: 'המלצת מוסך', manufacturer: 'הוראות יצרן' }[plan.source]}</p>
    <VehicleInfo title="על דחיית התראה וייצוא ליומן"><p>דחיית התראה אינה משנה את מועד הטיפול. ייצוא ליומן הוא צילום מצב של התאריך, ללא מעקב ק״מ או עדכון אוטומטי.</p></VehicleInfo>
    {plan.notes ? <p className="whitespace-pre-wrap"><NumericText>{plan.notes}</NumericText></p> : null}
    {error ? <p role="alert" className="tm-vehicle-error"><NumericText>{error}</NumericText></p> : null}
    <ConfirmDialog open={deleting} title="מחיקת התזכורת?" body="הטיפולים שכבר תועדו נשארים ביומן." confirmLabel="מחיקת התזכורת" onCancel={() => { if (!submitting.current) setDeleting(false); }} onConfirm={() => {
      if (submitting.current) return;
      const isCurrent = captureScope();
      if (!isCurrent()) return;
      submitting.current = true; setError('');
      void data.deleteCareRecord(v.vehicleId, 'maintenancePlans', plan, {
        onSubmitted: submission => {
          observeVehicleRecordDeletion(submission, showToast);
          if (isCurrent()) { setDeleting(false); navigate('/vehicle'); }
        },
      }).catch(cause => { if (isCurrent()) { setDeleting(false); setError(cause instanceof Error ? cause.message : 'לא ניתן למחוק'); } })
        .finally(() => { submitting.current = false; });
    }}/>
  </VehiclePage>;
}

export function IssueDetail() {
  const { scope } = useVehicleData();
  const { issueId } = useParams();
  return <IssueDetailContent key={`${scope}/${issueId}`}/>;
}

function IssueDetailContent() {
  const { issueId } = useParams();
  const v = useVehicleData();
  const { saveCareRecord } = useData();
  const { showToast } = useToast();
  const captureScope = useAccountScope(v.scope);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const errorNode = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorNode.current?.focus(); }, [error]);
  const issue = v.extra.vehicleIssues.find(row => row.id === issueId);
  if (!issue) return <VehiclePage title="תקלה" back="/vehicle?tab=issues"><p>התקלה אינה זמינה ברכב הפעיל.</p></VehiclePage>;
  const linked = issue.serviceEventIds.map(id => v.care.data.serviceEvents.find(event => event.id === id));
  const resolve = async () => {
    if (submitting.current || issue.status === 'resolved') return;
    const isCurrent = captureScope();
    if (!isCurrent()) return;
    const next: VehicleIssue = { ...issue, status: 'resolved', version: issue.version + 1,
      history: [...issue.history, { day: v.today, status: 'resolved' as const, note: issue.notes.slice(0, 500) }].slice(-10) };
    submitting.current = true; setResolving(true); setError('');
    try {
      const receipt = await saveCareRecord(v.vehicleId, 'vehicleIssues', next, issue);
      if (!isCurrent()) return;
      void receipt.settled.then(accepted => {
        if (!isCurrent()) return;
        if (accepted) showToast({ tone: 'success', title: 'סומן כתוקן' });
        else setError('סימון התיקון טרם אושר. אפשר לבדוק בשינויים שעוד לא עלו לענן.');
      });
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : 'לא ניתן לשמור את סימון התיקון.');
    } finally {
      submitting.current = false;
      if (isCurrent()) setResolving(false);
    }
  };
  return <VehiclePage title={issue.title} back="/vehicle?tab=issues">
    <p className="tm-vehicle-status"><WarningIcon size={17}/>{{ open: 'פתוחה', watching: 'במעקב', resolved: 'נפתרה' }[issue.status]} · {issue.importance === 'important' ? 'חשובה' : 'למעקב'}</p>
    <div className="tm-vehicle-detail-hero"><span className="tm-vehicle-eyebrow"><NumericText>{`זוהתה ב־${vehicleDay(issue.day)}${issue.odometer !== null ? ` · ${issue.odometer.toLocaleString('he-IL')} ק״מ` : ''}`}</NumericText></span><p className="whitespace-pre-wrap"><NumericText>{issue.symptoms || 'לא תועדו תסמינים נוספים.'}</NumericText></p></div>
    {issue.notes ? <p className="whitespace-pre-wrap"><NumericText>{issue.notes}</NumericText></p> : null}
    {issue.status !== 'resolved' || resolving ? <Button full data-testid="issue-resolve" disabled={resolving} onClick={() => void resolve()}><CheckIcon size={19}/>{resolving ? 'שומרים…' : 'תוקן'}</Button> : null}
    <Button full variant={issue.status === 'resolved' ? 'primary' : 'line'} disabled={resolving} onClick={() => v.edit({ collection: 'vehicleIssues', record: issue })}>עדכון מצב וקישור לטיפול</Button>
    {error ? <p ref={errorNode} tabIndex={-1} role="alert" className="tm-vehicle-error"><NumericText>{error}</NumericText></p> : null}
    <section className="tm-vehicle-section"><h2 className="tm-vehicle-section-title">טיפולים מקושרים</h2><div className="tm-vehicle-links">{linked.map((record, index) => record ? <button className="tm-vehicle-link" key={record.id} type="button" onClick={() => v.edit({ collection: 'serviceEvents', record })}><span><NumericText>{record.title}</NumericText><small><NumericText>{vehicleDay(record.day)}</NumericText></small></span><span><NumericText>{vehicleMoney(record.costAgorot)}</NumericText></span></button> : <p className="tm-vehicle-link tm-vehicle-note" key={index}>הטיפול המקושר הוסר או אינו זמין.</p>)}</div>{!linked.length ? <p className="tm-vehicle-note">עדיין לא קושרו טיפולים לתקלה.</p> : null}<VehicleInfo title="איך נשמרים עלות התיקון והק״מ?"><p>עלות התיקון נספרת רק בטיפול, פעם אחת. קריאת הק״מ בגילוי תקלה משמשת למעקב ואינה מדידה מאומתת לאומדן הדלק במיכל.</p></VehicleInfo></section>
    {issue.history.length ? <details className="tm-vehicle-disclosure"><summary>שינויי מצב <NumRun>{issue.history.length}</NumRun></summary>{issue.history.map((entry, index) => <p className="tm-vehicle-note" key={index}><NumericText>{`${vehicleDay(entry.day)} · ${{ open: 'פתוחה', watching: 'במעקב', resolved: 'נפתרה' }[entry.status]}${entry.note ? ` · ${entry.note}` : ''}`}</NumericText></p>)}</details> : null}
  </VehiclePage>;
}
