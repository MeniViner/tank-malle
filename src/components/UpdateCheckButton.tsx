import { useState } from 'react';
import { checkAppUpdate, type UpdateCheck, type UpdateCheckResult } from '../lib/appUpdates';
import { APP_VERSION, BUILD_COMMIT, BUILD_DIRTY } from '../lib/version';
import { Num } from './Num';

const RESULT: Record<UpdateCheck, string> = {
  available: 'גרסה חדשה זמינה — לחצו על רענון בהודעה.',
  current: 'לא נמצא עדכון חדש.',
  offline: 'חזרו לחיבור לאינטרנט כדי לבדוק עדכון.',
  error: 'לא ניתן לבדוק עדכון כרגע. אפשר לנסות שוב.',
};
export function UpdateCheckButton() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  return <div className="flex flex-col items-center">
    <button type="button" disabled={checking} aria-busy={checking || undefined}
      className="min-h-10 px-3 text-[13px] font-semibold text-ink underline underline-offset-4 disabled:opacity-50"
      onClick={async () => {
        setChecking(true); setResult(null);
        try { setResult(await checkAppUpdate({ version: APP_VERSION, commit: BUILD_COMMIT, dirty: BUILD_DIRTY })); }
        finally { setChecking(false); }
      }}>
      {checking ? 'בודקים עדכון…' : 'בדיקת עדכון'}
    </button>
    <p role="status" className="px-3 text-center text-[13px] text-muted">{result ? RESULT[result.status] : ''}</p>
    {result?.release ? <p className="px-3 text-center text-[12px] text-muted">בשרת: גרסה <Num>{result.release.version}</Num> · בילד <Num>{result.release.commit.slice(0, 10)}</Num></p> : null}
  </div>;
}
