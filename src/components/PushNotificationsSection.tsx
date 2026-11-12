import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { disablePush, enablePush, pushPlatform, pushStatus, type PushStatus } from '../lib/push/client';
import { GroupRow } from './DesignPrimitives';
import { Toggle } from './Segmented';

const NOTE: Record<PushStatus, string> = {
  on: 'נשלח התראה לטלפון כשטסט, ביטוח או טיפול מתקרבים, גם כשהאפליקציה סגורה. פעם ביום, בבוקר.',
  off: 'התראה לטלפון כשטסט, ביטוח או טיפול מתקרבים, גם כשהאפליקציה סגורה.',
  needsInstall: 'באייפון, התראות מגיעות רק לאפליקציה שהוספה למסך הבית: בספארי הקישו על כפתור השיתוף ואז "הוספה למסך הבית", ופתחו משם.',
  denied: 'ההתראות חסומות. אפשר להפעיל אותן בהגדרות הטלפון או הדפדפן, באתר או באפליקציה "טנק מלא".',
  unsupported: 'הדפדפן הזה לא תומך בהתראות לטלפון. ההתראות יופיעו כאן באפליקציה.',
};

/** Real phone notifications (Web Push), per device. The in-app list is unchanged. */
export function PushNotificationsSection() {
  const { user } = useAuth();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const uid = user?.uid ?? null;
  useEffect(() => { let live = true; void pushStatus(uid).then(next => { if (live) setStatus(next); }, () => { if (live) setStatus('unsupported'); }); return () => { live = false; }; }, [uid]);
  if (status === null) return null;
  const toggle = async (on: boolean) => {
    if (!user || busy) return;
    setBusy(true); setError('');
    try { setStatus(on ? await enablePush(user.uid) : await disablePush(user.uid)); }
    catch { setError(on ? 'לא הצלחנו להפעיל התראות במכשיר הזה. נסו שוב כשיש חיבור.' : 'לא הצלחנו לכבות את ההתראות. נסו שוב כשיש חיבור.'); }
    finally { setBusy(false); }
  };
  const canToggle = status === 'on' || status === 'off';
  return <section className="flex flex-col gap-2" data-testid="push-section" data-push-status={status} data-push-platform={pushPlatform()}>
    <div className="tm-group"><GroupRow title="התראות לטלפון">
      {canToggle ? <Toggle ariaLabel="התראות לטלפון" checked={status === 'on'} disabled={busy || !user} onChange={value => void toggle(value)} />
        : <span className="text-[13px] text-ink-2">{status === 'needsInstall' ? 'דורש הוספה למסך הבית' : status === 'denied' ? 'חסום' : 'לא נתמך'}</span>}
    </GroupRow></div>
    <p className="helper">{NOTE[status]}</p>
    {error ? <p role="alert" className="text-[14px] text-danger">{error}</p> : null}
  </section>;
}
