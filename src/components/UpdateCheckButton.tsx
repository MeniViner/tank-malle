import { useState } from 'react';
import { checkAppUpdate, type UpdateCheck } from '../lib/appUpdates';

const RESULT: Record<UpdateCheck, string> = {
  available: 'גרסה חדשה זמינה — לחצו על רענון בהודעה.',
  current: 'לא נמצא עדכון חדש.',
  offline: 'חזרו לחיבור לאינטרנט כדי לבדוק עדכון.',
  unavailable: 'בדיקת עדכון אינה זמינה כרגע. נסו לפתוח שוב את האפליקציה.',
  error: 'לא ניתן לבדוק עדכון כרגע. אפשר לנסות שוב.',
};
export function UpdateCheckButton() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheck | null>(null);
  return <div className="flex flex-col items-center">
    <button type="button" disabled={checking} aria-busy={checking || undefined}
      className="min-h-10 px-3 text-[13px] font-semibold text-accent underline underline-offset-4 disabled:opacity-50"
      onClick={async () => { setChecking(true); setResult(null); setResult(await checkAppUpdate()); setChecking(false); }}>
      {checking ? 'בודקים עדכון…' : 'בדיקת עדכון'}
    </button>
    <p role="status" className="px-3 text-center text-[13px] text-muted">{result ? RESULT[result] : ''}</p>
  </div>;
}
