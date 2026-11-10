import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useVehicleData } from '../context/VehicleDataContext';
import { useToast } from '../context/ToastContext';
import { useVehicleNotifications, type VehicleNotification } from '../hooks/useVehicleNotifications';
import { Sheet } from '../components/Sheet';
import { CivilDateField } from '../components/CivilDateField';
import { Button } from '../components/Button';
import { NumericText } from '../components/Fmt';
import { vehicleDay } from '../lib/vehicle/format';
import { parseCivilDay } from '../lib/civilDate';
import { snoozePresets } from '../lib/vehicle/snooze';
import { createNotificationUndo, restoredNotification } from '../lib/vehicle/notificationUndo';
import { ArchiveIcon, TrashIcon, RestoreIcon, BellIcon, ChevronStart, PumpIcon, WarningIcon, CloudOffIcon } from '../components/icons';
import type { NotificationState } from '../lib/vehicle/model';
import '../notification-design.css';

type ScopedAction = { scope: object };
type SelectedNote = ScopedAction & { note: VehicleNotification };

export function Notifications() {
  const v = useVehicleData(), data = useData(), notes = useVehicleNotifications();
  const { showToast } = useToast(), navigate = useNavigate();
  const viewScope = data.tankInputScope;
  const [selected, setSelected] = useState<SelectedNote | null>(null);
  const [until, setUntil] = useState('');
  const [errorState, setErrorState] = useState<(ScopedAction & { message: string }) | null>(null);
  const [working, setWorking] = useState<ScopedAction | null>(null);
  const [priceInfo, setPriceInfo] = useState<object | null>(null);
  const mounted = useRef(false), action = useRef<ScopedAction | null>(null);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = working?.scope === viewScope;
  const error = errorState?.scope === viewScope ? errorState.message : '';
  const snooze = selected?.scope === viewScope ? selected.note : null;
  const live = notes.rows.filter(n => !n.state?.archived), archived = notes.rows.filter(n => n.state?.archived);
  const unread = live.filter(n => !n.state?.read && !n.snoozed);
  const read = live.filter(n => n.state?.read && !n.snoozed), deferred = live.filter(n => n.snoozed);
  const unreadReady = unread.every(note => v.notificationBase(note).kind !== 'unavailable');
  const setError = (message: string) => setErrorState({ scope: viewScope, message });

  function begin(): ScopedAction | null {
    // Ref protection also covers two clicks before React paints the disabled state.
    if (action.current?.scope === viewScope) return null;
    const token = { scope: viewScope };
    action.current = token; setWorking(token); setError('');
    return token;
  }
  function finish(token: ScopedAction) {
    if (action.current === token) action.current = null;
    if (mounted.current) setWorking(current => current === token ? null : current);
  }
  function baseFor(note: VehicleNotification, before?: NotificationState): NotificationState {
    return before ?? { id: note.id, schemaVersion: 1, version: 0, occurrence: note.occurrence,
      read: false, archived: false, snoozeUntilDay: null };
  }

  async function update(note: VehicleNotification, patch: Partial<NotificationState>, undo = true) {
    const baseline = v.notificationBase(note);
    if (baseline.kind === 'unavailable') return;
    const current = data.captureVehicleAction();
    if (!current()) return;
    const token = begin(); if (!token) return;
    const before = baseline.kind === 'existing' ? baseline.before : undefined;
    const base = baseFor(note, before), next = { ...base, ...patch, version: base.version + 1 };
    const chosen = selected;
    try {
      const receipt = await data.saveCareRecord(v.vehicleId, 'notificationStates', next, before);
      if (!current()) return;
      if (mounted.current) setSelected(value => value === chosen ? null : value);
      void receipt.settled.then(ok => {
        if (!current()) return;
        if (!ok) {
          if (mounted.current) setError('העדכון טרם אושר. בדקו שינויים שעוד לא עלו לענן.');
          showToast({ tone: 'error', title: 'העדכון לא סונכרן — הקלט נשמר בתור הפעולות' });
          return;
        }
        if (!undo) return;
        const restore = createNotificationUndo(current, async () => {
          const restored = await data.saveCareRecord(v.vehicleId, 'notificationStates', restoredNotification(base, next), next);
          if (!current()) return;
          void restored.settled.then(done => {
            if (!current()) return;
            showToast(done ? { tone: 'success', title: 'הפעולה בוטלה' }
              : { tone: 'error', title: 'הביטול לא אושר — בדקו את תור הפעולות' });
          });
        });
        showToast({ tone: 'success', duration: 5_000,
          title: patch.deleted ? 'ההתראה נמחקה' : patch.archived ? 'ההתראה הועברה לארכיון'
            : patch.snoozeUntilDay ? 'הופעת ההתראה נדחתה' : 'ההתראה עודכנה',
          onUndo: async () => {
            try { await restore(); }
            catch {
              if (!current()) return;
              showToast({ tone: 'error', title: 'לא ניתן לבטל; ייתכן שההתראה השתנתה בינתיים.' });
            }
          },
        });
      });
    } catch (caught) {
      if (current() && mounted.current) setError(caught instanceof Error ? caught.message : 'לא ניתן לשמור את ההתראה.');
    } finally { finish(token); }
  }

  async function markRead() {
    if (!unread.length || !unreadReady) return;
    const current = data.captureVehicleAction(); if (!current()) return;
    const token = begin(); if (!token) return;
    try {
      const receipts = [];
      for (const note of unread) {
        if (!current()) return;
        const baseline = v.notificationBase(note); if (baseline.kind === 'unavailable') return;
        const before = baseline.kind === 'existing' ? baseline.before : undefined, base = baseFor(note, before);
        receipts.push(await data.saveCareRecord(v.vehicleId, 'notificationStates',
          { ...base, read: true, version: base.version + 1 }, before));
      }
      if (!current()) return;
      void Promise.all(receipts.map(r => r.settled)).then(results => {
        if (!current()) return;
        if (results.some(ok => !ok)) {
          if (mounted.current) setError('חלק מהסימונים טרם אושרו. בדקו שינויים שעוד לא עלו לענן.');
          showToast({ tone: 'error', title: 'חלק מסימוני הקריאה ממתינים לבדיקה' });
        } else showToast({ tone: 'success', title: 'כל ההתראות סומנו כנקראו' });
      });
    } catch (caught) {
      if (current() && mounted.current) setError(caught instanceof Error ? caught.message : 'לא ניתן לסמן את ההתראות.');
    } finally { finish(token); }
  }

  function group(rows: VehicleNotification[], title: string) {
    if (!rows.length) return null;
    return <section aria-label={title} className={`notes-section ${title === 'בארכיון' ? 'notes-archived' : ''}`}>
      <div className="notes-group-head"><h2>{title}</h2><span className="notes-count"><bdi dir="ltr">{rows.length}</bdi></span>
        {title === 'בארכיון' ? <small>נשמר עד שתמחקו</small> : null}</div>
      <div className="notes-group">{rows.map(n => {
        const pending = data.outbox.some(op => op.path === `users/${v.uid}/vehicles/${v.vehicleId}/notificationStates/${n.id}` && op.status === 'pending');
        const ready = v.notificationBase(n).kind !== 'unavailable';
        const Icon = n.kind === 'price' ? PumpIcon : n.kind === 'sync' ? CloudOffIcon : n.urgent ? WarningIcon : BellIcon;
        const openPrice = () => { setPriceInfo(viewScope); if (ready && !n.state?.read && !pending) void update(n, { read: true }, false); };
        return <article key={n.id} className="notes-row" data-urgent={n.urgent} data-notification-ready={ready}>
          <Icon size={20} className="notes-glyph" /><div className="notes-main">
            <Link to={n.to} onClick={event => {
              if (n.kind === 'price') { event.preventDefault(); openPrice(); }
              else if (ready && !n.state?.read && !pending) void update(n, { read: true }, false);
            }}><h3>{ready && !n.state?.read ? <span className="notes-unread" aria-hidden="true" /> : null}<NumericText>{n.title}</NumericText></h3>
              <p><NumericText>{n.detail}</NumericText></p></Link>
            {!ready ? <small role="status">{v.extraErrors.includes('notificationStates') ? 'מצב ההתראה אינו זמין כרגע' : 'ממתינים למצב ההתראה'}</small> : null}
            {n.snoozed ? <small><NumericText>{`תופיע שוב ב־${vehicleDay(n.state!.snoozeUntilDay!)}. מועד התזכורת לא השתנה.`}</NumericText></small> : null}
            {!n.state?.archived && (n.kind === 'reminder' || n.kind === 'document') ? <div className="notes-actions">
              {n.kind === 'reminder' ? <button type="button" className="notes-text-action" onClick={() => {
                const row = v.reminders.find(r => r.occurrence === n.occurrence); if (row) v.edit({ collection: 'serviceEvents', completePlan: row.plan });
              }}>רישום טיפול</button> : null}
              <button type="button" className="notes-text-action" disabled={busy || pending || !ready} onClick={() => {
                setSelected({ scope: viewScope, note: n }); setUntil(''); setError('');
              }}>דחיית הופעה</button></div> : null}
            {!n.state?.archived && n.kind === 'price' ? <button type="button" className="notes-text-action" onClick={openPrice}>מה זה משנה</button> : null}
            {n.state?.archived ? <button type="button" className="notes-text-action" disabled={busy || pending || !ready}
              onClick={() => void update(n, { archived: false })}><RestoreIcon size={16} />החזרה לפעילות</button> : null}
          </div><button type="button" className="notes-mini" disabled={busy || pending || !ready}
            aria-label={`${n.state?.archived ? 'מחיקת התראה' : 'העברה לארכיון'} · ${n.title}`}
            onClick={() => void update(n, n.state?.archived ? { deleted: true, read: true } : { archived: true, read: true })}>
            {n.state?.archived ? <TrashIcon size={18} /> : <ArchiveIcon size={18} />}</button>
        </article>;
      })}</div>
    </section>;
  }

  return <main className="notes-page notes-plate pb-safe pt-safe">
    <header className="notes-header"><button type="button" aria-label="חזרה לבית" onClick={() => navigate('/')}>
      <ChevronStart size={22} className="rotate-180" /></button><div><span className="notes-eyebrow">עדכונים ותזכורות לרכב</span><h1>התראות</h1></div></header>
    <div className="notes-content">
      {unread.length ? <button type="button" className="notes-mark-read" disabled={busy || !unreadReady}
        onClick={() => void markRead()}>סימון כנקרא <bdi dir="ltr">({unread.length})</bdi></button> : null}
      {group(unread, 'חדש')}{group(read, 'נקרא')}{group(deferred, 'להמשך')}
      {!live.length ? <div className="v-empty"><BellIcon size={28} /><h2>{v.incomplete ? 'מעדכנים את ההתראות' : 'אין התראות'}</h2>
        <p>{v.incomplete ? 'הנתונים חלקיים או ממתינים לשרת.' : 'נודיע כשתזכורת תגיע, כשמחיר הדלק יתעדכן או כשמשהו ימתין לסנכרון.'}</p></div> : null}
      {group(archived, 'בארכיון')}
      {error && !snooze ? <p role="alert" className="notes-error"><NumericText>{error}</NumericText></p> : null}
      {archived.length ? <p className="helper">מחיקה מסירה את ההתראה הזו בלבד. היא אינה מוחקת טיפול, משנה תזכורת או מבטלת פעולת סנכרון.</p> : null}
    </div>
    <Sheet open={!!snooze} onClose={() => { if (!busy) setSelected(null); }} title="מתי להציג שוב?">
      <div className="v3-snooze-presets" role="group" aria-label="דחייה מהירה" data-testid="snooze-presets">
        {snoozePresets(v.today).map(preset => <button key={preset.key} type="button" data-testid={'snooze-' + preset.key}
          disabled={busy || !snooze || v.notificationBase(snooze).kind === 'unavailable'}
          onClick={() => { if (snooze) { setError(''); void update(snooze, { snoozeUntilDay: preset.day }); } }}>
          <span><b>{preset.label}</b><small><NumericText>{vehicleDay(preset.day)}</NumericText></small></span>
        </button>)}
      </div>
      <form className="vehicle-form" onSubmit={event => {
        event.preventDefault(); if (!snooze) return;
        const day = parseCivilDay(until); if (!day || day <= v.today) { setError('בחרו יום עתידי.'); return; }
        void update(snooze, { snoozeUntilDay: day });
      }}><CivilDateField label="יום הופעה מחדש" required draftText={until} onDraftTextChange={setUntil} />
        <p className="helper">דחיית ההופעה אינה משנה את המועד שנשמר ברכב.</p>
        {error ? <p role="alert" className="notes-error"><NumericText>{error}</NumericText></p> : null}
        <Button type="submit" disabled={busy || !snooze || v.notificationBase(snooze).kind === 'unavailable'} full>דחיית הופעת ההתראה</Button>
      </form>
    </Sheet>
    <Sheet open={priceInfo === viewScope} onClose={() => setPriceInfo(null)} title="מה שינוי המחיר אומר?">
      <p className="text-[16px] leading-relaxed">המחיר השמור משמש כברירת מחדל לתדלוקים חדשים ולקו ההשוואה בגרף. הוא אינו משנה את המחירים ששילמתם או את ההיסטוריה שכבר שמרתם.</p>
      <Link className="tm-text-action mt-4" to="/settings">למחיר ולהנחה האישית</Link>
    </Sheet>
  </main>;
}
