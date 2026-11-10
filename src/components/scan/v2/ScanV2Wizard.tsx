import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sheet } from '../../Sheet';
import { Button } from '../../Button';
import { CheckIcon } from '../../icons';
import { acceptScanReading, type AcceptedScanDraft, type ScanDraft, type ScanField } from '../../../lib/scan/draft';
import type { ScanContext } from '../../../lib/scan/v2/constraints';
import type { ScanV2Result } from '../../../lib/scan/v2/pipeline';
import { ScanV2Reader } from './ScanV2Reader';
import { ScanVerify } from './ScanVerify';
import './scanV2.css';

/**
 * Scan v2 (flag `scanV2`): the same two-photo flow, with a viewfinder crop
 * and a verification screen after each photo. Confirmed values go to the
 * ordinary fill-up form, which remains the only place a record is saved.
 */
export function ScanV2Wizard({ initial, protectedFields, context, onClose, onApply }: {
  initial: ScanDraft; protectedFields: readonly ScanField[]; context: ScanContext;
  onClose: () => void; onApply: (draft: ScanDraft, acceptedFields: readonly ScanField[]) => void;
}) {
  const heading = useRef<HTMLParagraphElement>(null);
  const session = useRef<AcceptedScanDraft>({ draft: { ...initial }, acceptedFields: [] });
  const closed = useRef(false);
  const [step, setStep] = useState<0 | 1>(0), [live, setLive] = useState(false);
  const [review, setReview] = useState<ScanV2Result | null>(null), [pumpDone, setPumpDone] = useState(false), [attempt, setAttempt] = useState(0);
  useLayoutEffect(() => { closed.current = false; return () => { closed.current = true; }; }, []);
  useEffect(() => { heading.current?.focus(); }, [step, review]);
  function close() {
    if (closed.current) return;
    closed.current = true;
    const { draft, acceptedFields } = session.current;
    if (acceptedFields.length) onApply(draft, acceptedFields); else onClose();
  }
  function confirmed(values: Partial<Record<'total' | 'liters' | 'odometer', string>>) {
    if (closed.current) return;
    if (step === 0) {
      if (values.total !== undefined && values.liters !== undefined) session.current = acceptScanReading(session.current, { total: values.total, liters: values.liters }, protectedFields);
      setPumpDone(true); setReview(null); setStep(1);
    } else {
      if (values.odometer !== undefined) session.current = acceptScanReading(session.current, { odometer: values.odometer }, protectedFields);
      close();
    }
  }
  return <Sheet open onClose={close} title={<h2 className="text-lg font-bold">תדלוק בשני צילומים</h2>}>
    <div className="flex flex-col gap-5">
      <ol className="scan-steps" aria-label="שלבי הוספת תדלוק">{['משאבה', 'קילומטראז׳'].map((name, i) => <li key={name} aria-current={step === i ? 'step' : undefined}><span>{i < step ? <CheckIcon size={16} /> : i + 1}</span>{name}</li>)}</ol>
      <p ref={heading} tabIndex={-1} className="text-sm leading-relaxed text-muted outline-none">
        {review ? 'בדקו שהספרות תואמות לצילום. אפשר לתקן כל מספר או לבחור אפשרות אחרת.'
          : step === 0 ? 'מכוונים את המסגרת לצג המשאבה — ואנחנו קוראים את הספרות. פעלו לפי הנחיות התחנה לשימוש בטלפון.'
            : 'עוד צילום אחד. אפשר גם לסגור ולהשלים בטופס; מה שכבר אושר יישאר.'}
      </p>
      {review ? <ScanVerify key={`${step}-${attempt}`} result={review} protectedFields={protectedFields}
        onConfirm={confirmed} onRetake={() => { setReview(null); setAttempt(a => a + 1); }} />
        : <ScanV2Reader key={`${step}-${attempt}`} kind={step === 0 ? 'pump' : 'odometer'} context={context} autoOpen={live}
          onResult={(result, fromCamera) => { if (!closed.current) { setLive(fromCamera); setReview(result); } }} />}
      {!review ? step === 0 ? <Button variant="ghost" onClick={() => setStep(1)}>דילוג לקילומטראז׳</Button>
        : <Button variant="ghost" onClick={() => { setStep(0); setLive(false); }}>{pumpDone ? 'צילום המשאבה מחדש' : 'חזרה למשאבה'}</Button> : null}
      <p className="text-center text-xs leading-relaxed text-muted">התמונות לא נשמרות. לפני השמירה בדקו את הסכום ששולם ואת קריאת ODO בק״מ.</p>
    </div>
  </Sheet>;
}
