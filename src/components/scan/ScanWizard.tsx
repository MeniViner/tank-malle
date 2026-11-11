import { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { Sheet } from '../Sheet';
import { Button } from '../Button';
import { CheckIcon } from '../icons';
import { PhotoReader } from './PhotoReader';
import { acceptScanReading, type AcceptedScanDraft, type ScanDraft, type ScanField } from '../../lib/scan/draft';
import type { Accept, DisplayReading, ScanContext } from '../../lib/scan/engine';
import { loadScanAccept, recordScanSample, type ScanAttempt } from '../../lib/scan/samples';
import { useAuth } from '../../context/AuthContext';
import { Money, NumRun } from '../Fmt';

type ScanWizardProps = {
  initial:ScanDraft;protectedFields:readonly ScanField[];onClose:()=>void;
  onApply:(draft:ScanDraft,acceptedFields:readonly ScanField[])=>void;
  /** Last odometer and tank capacity: what the reader may use to choose between rows. */
  context?:ScanContext;
  /** Told the id of every attempt's sample, so the form can attach what was finally saved. */
  onSample?:(id:string)=>void;
};

export function ScanWizard({ initial,protectedFields,onClose,onApply,context,onSample }: ScanWizardProps) {
  const { user }=useAuth();
  const attempts=useRef({session:crypto.randomUUID(),pump:0,odometer:0});
  const [accept,setAccept]=useState<Partial<Accept>|null>(null);
  useEffect(()=>{let live=true;void loadScanAccept().then(value=>{if(live)setAccept(value);});return()=>{live=false;};},[]);
  function attempt(entry:ScanAttempt) {
    if(!user)return;
    const id=recordScanSample({uid:user.uid,session:attempts.current.session,attempt:++attempts.current[entry.kind]},entry);
    if(id)onSample?.(id);
  }
  const heading=useRef<HTMLParagraphElement>(null);
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
  return <Sheet open onClose={close} title={<h2 className="text-lg font-bold">תדלוק בשני צילומים</h2>}>
    <div className="flex flex-col gap-5">
      <ol className="scan-steps" aria-label="שלבי הוספת תדלוק">{['משאבה','קילומטראז׳'].map((name,i)=><li key={name} aria-current={step===i?'step':undefined}><span>{i<step?<CheckIcon size={16}/>:i+1}</span>{name}</li>)}</ol>
      {pump?<div className="scan-success" role="status"><CheckIcon size={20}/><span><b>המשאבה נקראה</b><span><Money value={Number(pump.total)}/> · <span className="tm-number-with-unit"><NumRun>{pump.liters}</NumRun><span className="unit">ליטר</span></span></span></span></div>:null}
      <p ref={heading} tabIndex={-1} className="text-sm leading-relaxed text-muted outline-none">{step===0?'פותחים מצלמה, מכוונים לצג — ואנחנו קוראים את הספרות. פעלו לפי הנחיות התחנה לשימוש בטלפון.':'עוד צילום אחד, והנתונים יעברו לטופס לבדיקה. אפשר גם לסגור ולהשלים בטופס; מה שכבר נקרא יישאר.'}</p>
      <PhotoReader key={step} kind={step===0?'pump':'odometer'} autoOpen={live} onRead={read} context={context} onAttempt={attempt} accept={accept}/>
      {step===0?<Button variant="ghost" onClick={()=>setStep(1)}>דילוג לקילומטראז׳</Button>:<Button variant="ghost" onClick={()=>{setStep(0);setLive(false);}}>צילום המשאבה מחדש</Button>}
      <p className="text-center text-xs leading-relaxed text-muted">קטעים מהצילום נשמרים לשיפור הזיהוי. לפני השמירה בדקו את הסכום ששולם ואת קריאת ODO בק״מ.</p>
    </div>
  </Sheet>;
}
