import { useRef, useState, useEffect } from 'react';
import { Sheet, ConfirmDialog } from '../Sheet';
import { Button } from '../Button';
import { CheckIcon } from '../icons';
import { PhotoReader } from './PhotoReader';
import type { ScanDraft } from '../../lib/scan/draft';
import type { DisplayReading } from '../../lib/scan/automaticDisplay';

export function ScanWizard({ initial,onClose,onApply }: { initial:ScanDraft;onClose:()=>void;onApply:(draft:ScanDraft,scanned:boolean)=>void }) {
  const heading=useRef<HTMLParagraphElement>(null);
  const [discard,setDiscard]=useState(false),[step,setStep]=useState(0),[live,setLive]=useState(false),[draft,setDraft]=useState(initial);
  const [pump,setPump]=useState<{total:string;liters:string}|null>(null);
  useEffect(()=>{heading.current?.focus();},[step]);
  function read(values:DisplayReading,fromCamera:boolean) {
    // Preserve human-authored values. The ordinary fill-up form is the single
    // place to review/correct numbers and explicitly save a record.
    const next={...draft};
    for(const [key,value] of Object.entries(values))if(!initial[key as keyof ScanDraft])next[key as keyof ScanDraft]=value;
    setDraft(next);
    if('total' in values){setPump(values);setLive(fromCamera);setStep(1);}else onApply(next,true);
  }
  const close=()=>{if(JSON.stringify(draft)!==JSON.stringify(initial))setDiscard(true);else onClose();};
  return <><Sheet open onClose={close} title={<h2 className="text-lg font-bold">תדלוק בשני צילומים</h2>}>
    <div className="flex flex-col gap-5">
      <ol className="scan-steps" aria-label="שלבי הוספת תדלוק">{['משאבה','קילומטראז׳'].map((name,i)=><li key={name} aria-current={step===i?'step':undefined}><span>{i<step?<CheckIcon size={16}/>:i+1}</span>{name}</li>)}</ol>
      {pump?<div className="scan-success" role="status"><CheckIcon size={20}/><span><b>המשאבה נקראה</b><span><bdi>₪{pump.total}</bdi> · <bdi>{pump.liters}</bdi> ליטר</span></span></div>:null}
      <p ref={heading} tabIndex={-1} className="text-sm leading-relaxed text-muted outline-none">{step===0?'פותחים מצלמה, מכוונים לצג — ואנחנו קוראים את הספרות. פעלו לפי הנחיות התחנה לשימוש בטלפון.':'עוד צילום אחד, והנתונים יעברו לטופס לבדיקה.'}</p>
      <PhotoReader key={step} kind={step===0?'pump':'odometer'} autoOpen={live} onRead={read}/>
      {step===0?<Button variant="ghost" onClick={()=>setStep(1)}>דילוג לקילומטראז׳</Button>:<Button variant="ghost" onClick={()=>onApply(draft,!!pump)}>השלמה בטופס הידני</Button>}
      {step===1?<Button variant="ghost" onClick={()=>{setStep(0);setLive(false);}}>צילום המשאבה מחדש</Button>:<Button variant="ghost" onClick={()=>onApply(draft,!!pump)}>מעבר להזנה ידנית</Button>}
      <p className="text-center text-xs leading-relaxed text-muted">התמונות נשארות במכשיר ואינן נשמרות. לפני השמירה בדקו את הסכום ששולם ואת קריאת ODO בק״מ.</p>
    </div>
  </Sheet><ConfirmDialog open={discard} title="לצאת מהצילום?" body="קריאת המשאבה עדיין לא הועברה לטופס." confirmLabel="יציאה ללא העברת הנתונים" cancelLabel="המשך צילום" onCancel={()=>setDiscard(false)} onConfirm={onClose}/></>;
}
