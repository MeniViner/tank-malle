import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { disablePush, enablePush, pushPlatform, pushStatus, type PushStatus } from '../lib/push/client';
import { nativeBuild } from '../lib/native/platform';
import { useAccountScope } from './account/useAccountScope';
import { GroupRow } from './DesignPrimitives';
import { Toggle } from './Segmented';
import { Button } from './Button';
import { Sheet } from './Sheet';

const NOTE: Record<PushStatus, string> = {
  on: 'נשלח התראה לטלפון כשטסט, ביטוח או טיפול מתקרבים, גם כשהאפליקציה סגורה. פעם ביום, בבוקר.',
  off: 'התראה לטלפון כשטסט, ביטוח או טיפול מתקרבים, גם כשהאפליקציה סגורה.',
  needsInstall: 'באייפון, התראות מגיעות רק לאפליקציה שהוספה למסך הבית: בספארי הקישו על כפתור השיתוף ואז "הוספה למסך הבית", ופתחו משם.',
  denied: 'ההתראות חסומות. אפשר להפעיל אותן בהגדרות הטלפון או הדפדפן, באתר או באפליקציה "טנק מלא".',
  unsupported: 'התראות למכשיר אינן זמינות כרגע בדפדפן או בגרסה הזו.',
  unavailable: 'לא ניתן לאמת את הרישום לשרת. בדקו את החיבור ורעננו את ההגדרות.',
};

/** Real phone notifications (Web Push), per device. The in-app list is unchanged. */
function usePushControls() {
  const { user } = useAuth();
  const [remote, setRemote] = useState(false);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const uid = user?.uid ?? null;
  const capture = useAccountScope(uid);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      const next = nativeBuild ? (async () => {
        const messaging = await import('../lib/native/remotePush');
        const configured = await messaging.remotePushConfigured().catch(() => false);
        if (live) setRemote(configured);
        if (configured) return messaging.remotePushStatus(uid);
        const reminders = await import('../lib/native/reminders');
        return reminders.nativeReminderStatus(uid);
      })() : pushStatus(uid);
      void next.then(value => { if (live) setStatus(value); }, () => { if (live) setStatus('unavailable'); });
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    navigator.serviceWorker?.addEventListener('controllerchange', refresh);
    if (!nativeBuild) void navigator.serviceWorker?.ready.then(() => { if (live) refresh(); });
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
      navigator.serviceWorker?.removeEventListener('controllerchange', refresh);
    };
  }, [uid]);
  const toggle = async (on: boolean) => {
    if (!user || busy) return;
    setBusy(true); setError('');
    const current = capture();
    try {
      let next: PushStatus;
      if (remote) {
        const { enableRemotePush, releaseRemotePush } = await import('../lib/native/remotePush');
        if (!current()) return;
        if (on) next = await enableRemotePush(user.uid, current);
        else { await releaseRemotePush(user.uid); next = 'off'; }
      } else if (nativeBuild) {
        const { enableNativeReminders, clearNativeReminders } = await import('../lib/native/reminders');
        if (!current()) return;
        if (on) next = await enableNativeReminders(user.uid, current);
        else { await clearNativeReminders(); next = 'off'; }
      } else next = on ? await enablePush(user.uid, current) : await disablePush(user.uid);
      if (current()) setStatus(next);
    }
    catch { if (current()) setError(on ? 'לא הצלחנו להפעיל התראות במכשיר הזה. נסו שוב כשיש חיבור.' : 'לא הצלחנו לכבות את ההתראות. נסו שוב כשיש חיבור.'); }
    finally { if (current()) setBusy(false); }
  };
  return { user, status, busy, error, toggle, remote };
}

export function PushNotificationsSection() {
  const { user, status, busy, error, toggle, remote } = usePushControls();
  const canToggle = status === 'on' || status === 'off';
  return <section id="device-notifications" className="flex flex-col gap-2" data-testid="push-section" data-push-status={status ?? 'loading'} data-push-platform={pushPlatform()}>
    <div className="tm-group"><GroupRow title="התראות למכשיר">
      {canToggle ? <Toggle ariaLabel="התראות לטלפון" checked={status === 'on'} disabled={busy || !user} onChange={value => void toggle(value)} />
        : <span className="text-[13px] text-ink-2">{status === 'needsInstall' ? 'דורש הוספה למסך הבית' : status === 'denied' ? 'חסום' : status === 'unsupported' ? 'לא זמין' : status === 'unavailable' ? 'בדקו חיבור' : 'בודקים…'}</span>}
    </GroupRow></div>
    <p className="helper">{nativeBuild && !remote && (status === 'on' || status === 'off')
      ? 'תזכורות מקומיות לטסט, ביטוח וטיפולים לפי הנתונים שסונכרנו למכשיר.'
      : status ? NOTE[status] : 'בודקים את ההרשאה במכשיר…'}</p>
    {status === 'denied' && remote ? <Button variant="secondary" onClick={() => {
      void import('../lib/native/remotePush').then(module => module.TankRemotePush.openSettings()).catch(() => {});
    }}>פתיחת הגדרות התראות ב־Android</Button> : null}
    {error ? <p role="alert" className="text-[14px] text-danger">{error}</p> : null}
  </section>;
}


/** Ask once per account and installation. The device prompt opens only after a tap. */
export function PushNotificationsInvite({ uid }: { uid: string }) {
  const { status, busy, error, toggle } = usePushControls();
  const [dismissed, setDismissed] = useState(false);
  const key = `tm.push.invited.v2.${uid}.${status === 'needsInstall' ? 'install-help' : 'device'}`;
  const seen = (() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } })();
  const open = !dismissed && !seen && (status === 'off' || status === 'needsInstall');
  const close = () => {
    try { localStorage.setItem(key, '1'); } catch { /* device storage is optional */ }
    setDismissed(true);
  };
  return <Sheet open={open} onClose={close} title="לקבל התראות במכשיר?">
    <div className="flex flex-col gap-3">
      <p>{status === 'needsInstall' ? NOTE.needsInstall : 'טסט, ביטוח וטיפולים מגיעים כהודעה במכשיר גם כשמסך האפליקציה סגור.'}</p>
      {status === 'off' ? <Button full loading={busy} onClick={() => void toggle(true)}>הפעלת התראות</Button> : null}
      {error ? <p role="alert">{error}</p> : null}
      <Button full variant="secondary" onClick={close}>{status === 'needsInstall' ? 'הבנתי' : 'אולי אחר כך'}</Button>
    </div>
  </Sheet>;
}
