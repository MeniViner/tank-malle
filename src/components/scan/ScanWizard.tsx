import { useRef, useState, useEffect } from 'react';
import { Sheet, ConfirmDialog } from '../Sheet';
import { Button } from '../Button';
import { Field } from '../Field';
import { PhotoReader } from './PhotoReader';
import { reviewedScan, type ScanDraft } from '../../lib/scan/draft';
import type { ReadingKind } from '../../lib/scan/sevenSegment';

export function ScanWizard({ initial, onClose, onApply }: { initial: ScanDraft; onClose: () => void; onApply: (draft: ScanDraft) => void }) {
  const instructions = useRef<HTMLParagraphElement>(null);
  const [discard,setDiscard] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(()=>{instructions.current?.focus();},[step]);
  const [draft, setDraft] = useState(initial);
  const authored = useRef(new Set<ReadingKind>(Object.entries(initial).filter(([,v]) => v !== '').map(([k]) => k as ReadingKind)));
  const [suggestions, setSuggestions] = useState<Partial<Record<ReadingKind, string>>>({});
  const [odoConfirmed, setOdoConfirmed] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [error, setError] = useState('');
  const reviewed = reviewedScan(draft);
  const replaces = Object.entries(initial).some(([k,v]) => v !== '' && v !== draft[k as ReadingKind]);
  function read(field: ReadingKind, text: string | null) {
    if (field === 'odometer') setOdoConfirmed(false);
    setSuggestions(prev => ({ ...prev, [field]: text ?? undefined }));
    if (!authored.current.has(field)) setDraft(prev => ({ ...prev, [field]: text ?? '' }));
    setReplaceConfirmed(false);
  }
  function input(field: ReadingKind, text: string) {
    authored.current.add(field); setDraft(prev => ({ ...prev, [field]: text })); setReplaceConfirmed(false);
    if (field === 'odometer') setOdoConfirmed(false);
  }
  const close = () => {
    if (Object.keys(draft).some(key=>draft[key as ReadingKind]!==initial[key as ReadingKind])) setDiscard(true);
    else onClose();
  };
  return <><Sheet open onClose={close} title={<h2 className="text-lg font-bold">תדלוק בשני צילומים</h2>}>
    <div className="flex flex-col gap-4">
      <ol className="flex gap-2 text-sm" aria-label="שלבי הוספת תדלוק">{['משאבה','קילומטראז׳','בדיקה'].map((label,i) => <li key={label} aria-current={step === i ? 'step' : undefined} className={`flex-1 rounded-lg p-2 text-center ${step === i ? 'bg-accent text-accent-contrast' : 'bg-surface-2 text-muted'}`}>{i+1}. {label}</li>)}</ol>
      <p ref={instructions} tabIndex={-1} className="text-sm text-muted outline-none">{step === 0 ? 'צלמו את הסכום והליטרים בצג, או הקלידו אותם כאן. אחרי הנחה, הזינו את הסכום ששולם בפועל.' : step === 1 ? 'כשהרכב עומד, צלמו את מד המרחק המצטבר בק״מ (ODO).' : 'בדקו את שלושת המספרים. הם יועברו לטופס להשלמת פרטי התדלוק.'}</p>
      {step < 2 ? <PhotoReader key={step} kind={step === 0 ? 'pump' : 'odometer'} onRead={read} /> : null}
      {(step === 0 ? ['total','liters'] as const : step === 1 ? ['odometer'] as const : ['total','liters','odometer'] as const).map(field => <div key={field}>
        <Field label={{ total: 'סכום ששולם', liters: 'ליטרים בצג', odometer: 'מד מרחק מצטבר' }[field]} inputMode={field === 'odometer' ? 'numeric' : 'decimal'} value={draft[field]} suffix={field === 'total' ? '₪' : field === 'liters' ? 'ל׳' : 'ק״מ'} onChange={e => input(field, e.target.value)} />
        {suggestions[field] && draft[field] !== suggestions[field] ? <Button size="sm" variant="ghost" onClick={() => input(field, suggestions[field]!)}>שימוש בקריאה {suggestions[field]}</Button> : null}
      </div>)}
      {step >= 1 ? <label className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" className="size-5 flex-none accent-[var(--accent)]" checked={odoConfirmed} onChange={e => setOdoConfirmed(e.target.checked)} />בדקתי: זה ODO בק״מ, ולא Trip, מיילים או טווח נסיעה</label> : null}
      {step === 2 ? <>
        <p className="rounded-xl bg-surface-2 p-3 text-sm">מחיר מחושב לליטר: <b dir="ltr">{reviewed ? `₪${reviewed.receipt.pricePerLiter}` : '—'}</b>. בטופס יעודכנו הסכום, הליטרים והקילומטראז׳, והמחיר יחושב מהם.</p>
        {replaces ? <label className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" className="size-5 flex-none" checked={replaceConfirmed} onChange={e => setReplaceConfirmed(e.target.checked)} />להחליף את הערכים הקודמים בטופס בערכים שבדקתי כאן</label> : null}
      </> : null}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div className="flex gap-2">
        {step > 0 ? <Button variant="secondary" onClick={() => { setStep(step-1); setError(''); }}>חזרה</Button> : null}
        <Button full onClick={() => {
          setError('');
          if (step === 0) { setStep(1); return; }
          if (!reviewed) { setError('יש להזין סכום וליטרים חיוביים וקילומטראז׳ שלם. אפשר לחזור ולתקן.'); return; }
          if (!odoConfirmed) { setError('יש לאשר שהקריאה היא מד המרחק המצטבר בק״מ.'); return; }
          if (step === 1) { setStep(2); return; }
          if (replaces && !replaceConfirmed) { setError('יש לאשר את החלפת הערכים הקיימים בטופס.'); return; }
          onApply(draft);
        }}>{step === 0 ? 'המשך לקילומטראז׳' : step === 1 ? 'בדיקת הנתונים' : 'העברה לטופס התדלוק'}</Button>
      </div>
      <Button variant="ghost" onClick={close}>חזרה לטופס הידני</Button>
      <p className="text-xs text-muted">הצילום אינו נשמר או נשלח. הזיהוי מתאים לצגים עם ספרות בנויות מקווים; אפשר לתקן כל מספר ידנית.</p>
    </div>
  </Sheet><ConfirmDialog open={discard} title="לצאת מהצילום?" body="המספרים ששיניתם כאן עדיין לא הועברו לטופס. אפשר להמשיך לבדיקה או לצאת בלי להעביר אותם." confirmLabel="יציאה ללא העברת הנתונים" cancelLabel="המשך בדיקה" onCancel={()=>setDiscard(false)} onConfirm={onClose} /></>;
}
