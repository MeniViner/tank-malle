import { useRef, useState, useEffect, useId, useLayoutEffect } from 'react';
import { Sheet } from '../Sheet';
import { Button } from '../Button';
import { CheckIcon, InfoIcon } from '../icons';
import { PhotoReader, type PhotoReaderControls } from './PhotoReader';
import { acceptScanReading, type AcceptedScanDraft, type ScanDraft, type ScanField } from '../../lib/scan/draft';
import type { Accept, DisplayReading, ScanContext } from '../../lib/scan/engine';
import { loadScanAccept, type ScanAttempt } from '../../lib/scan/samples';
import { Money, NumRun } from '../Fmt';

type ScanWizardProps = {
  initial:ScanDraft;protectedFields:readonly ScanField[];onClose:()=>void;
  onApply:(draft:ScanDraft,acceptedFields:readonly ScanField[])=>void;
  /** Last odometer and tank capacity: what the reader may use to choose between rows. */
  context?:ScanContext;
  /**
   * Records attempts after opt-in. `labelable` is false when the display's numbers were
   * already typed by hand: the reading is not applied, so the saved numbers say nothing about it.
   */
  onAttempt?:(attempt:ScanAttempt,labelable:boolean)=>void;
};

const FIELDS:Record<ScanAttempt['kind'],readonly ScanField[]>={pump:['total','liters'],odometer:['odometer']};

export function ScanWizard({ initial,protectedFields,onClose,onApply,context,onAttempt }: ScanWizardProps) {
  const [accept,setAccept]=useState<Partial<Accept>|null>(null);
  // Sharing is on by default and explained behind a small icon; the switch inside it is for those who want it off.
  const [shareSamples, setShareSamples] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const sampleDisclosure = useId();
  useEffect(()=>{let live=true;void loadScanAccept().then(value=>{if(live)setAccept(value);});return()=>{live=false;};},[]);
  function attempt(entry:ScanAttempt) {
    onAttempt?.(entry,!FIELDS[entry.kind].some(field=>protectedFields.includes(field)));
  }
  const heading=useRef<HTMLParagraphElement>(null);
  const reader=useRef<PhotoReaderControls>(null);
  const session=useRef<AcceptedScanDraft>({draft:{...initial},acceptedFields:[]});
  const closed=useRef(false);
  const [step,setStep]=useState(0),[live,setLive]=useState(false);
  const [pump,setPump]=useState<{total:string;liters:string}|null>(null);
  useLayoutEffect(()=>{closed.current=false;return()=>{closed.current=true;};},[]);
  useEffect(()=>{heading.current?.focus();},[step]);
  function close() {
    if(closed.current)return;
    closed.current=true;
    const {draft,acceptedFields}=session.current;
    if(acceptedFields.length)onApply(draft,acceptedFields);else onClose();
  }
  function read(values:DisplayReading,fromCamera:boolean) {
    if(closed.current)return;
    // Preserve human-authored values. The ordinary fill-up form is the single
    // place to review/correct numbers and explicitly save a record.
    session.current=acceptScanReading(session.current,values,protectedFields);
    if('total' in values){setPump(values);setLive(fromCamera);setStep(1);}else close();
  }
  function backToPump() { setStep(0); setLive(false); }
  function back() {
    if (reader.current?.closeCamera()) return;
    if (step === 1) backToPump();
    else close();
  }
  return <Sheet open onClose={close} onBack={back} title={<h2 className="text-lg font-bold">תדלוק בשני צילומים</h2>}>
    <div className="flex flex-col gap-5">
      <ol className="scan-steps" aria-label="שלבי הוספת תדלוק">{['משאבה','קילומטראז׳'].map((name,i)=><li key={name} aria-current={step===i?'step':undefined}><span>{i<step?<CheckIcon size={16}/>:i+1}</span>{name}</li>)}</ol>
      {pump?<div className="scan-success" role="status"><CheckIcon size={20}/><span><b>המשאבה נקראה</b><span><Money value={Number(pump.total)}/> · <span className="tm-number-with-unit"><NumRun>{pump.liters}</NumRun><span className="unit">ליטר</span></span></span></span></div>:null}
      <p ref={heading} tabIndex={-1} className="text-sm leading-relaxed text-muted outline-none">{step===0?'פותחים מצלמה, מכוונים לצג — ואנחנו קוראים את הספרות. פעלו לפי הנחיות התחנה לשימוש בטלפון.':'עוד צילום אחד, והנתונים יעברו לטופס לבדיקה. אפשר גם לסגור ולהשלים בטופס; מה שכבר נקרא יישאר.'}</p>
      <PhotoReader key={step} kind={step===0?'pump':'odometer'} autoOpen={live} onRead={read} context={context} onAttempt={onAttempt && shareSamples ? attempt : undefined} accept={accept} controlsRef={reader}/>
      {step===0?<Button variant="ghost" onClick={()=>setStep(1)}>דילוג לקילומטראז׳</Button>:<Button variant="ghost" onClick={backToPump}>צילום המשאבה מחדש</Button>}
      <div className="flex items-start justify-center gap-1">
        <p className="text-center text-xs leading-relaxed text-muted">לפני השמירה בדקו את הסכום ששולם ואת קריאת ODO בק״מ.</p>
        {onAttempt ? <button type="button" aria-label="על שיתוף דוגמאות לשיפור הזיהוי" aria-expanded={infoOpen} aria-controls={sampleDisclosure}
          className="-my-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted" onClick={() => setInfoOpen(open => !open)}><InfoIcon size={16} /></button> : null}
      </div>
      {onAttempt && infoOpen ? <p id={sampleDisclosure} role="note" className="text-xs leading-relaxed text-muted">
        {shareSamples
          ? 'לשיפור הזיהוי, חיתוכי ספרות (או תמונה מוקטנת כשהזיהוי נכשל), תוצאות הזיהוי והמספרים ששמרתם נשלחים ל־Firebase של Google ומקושרים לחשבון. התמונה המלאה לא נשמרת. '
          : 'השיתוף כבוי עד לסגירת המסך הזה. '}
        <button type="button" className="font-semibold text-ink underline" onClick={() => setShareSamples(on => !on)}>{shareSamples ? 'לא לשתף' : 'לשתף שוב'}</button>
      </p> : null}
    </div>
  </Sheet>;
}
