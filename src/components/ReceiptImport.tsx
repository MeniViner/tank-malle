import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet } from './Sheet';
import { Field } from './Field';
import { Button } from './Button';
import { parseReceiptText, receiptHash, possibleReceiptDuplicates, type TextReceipt, type ReceiptImport as ImportIdentity } from '../lib/import/receiptText';
import { extractReceiptPdf } from '../lib/import/receiptPdf';
import { reviewedScan } from '../lib/scan/draft';
import { localDay, validDay } from '../lib/maintenance/model';
import type { Fillup } from '../lib/types';

export function ReceiptImport({ fillups, hasAuthored, onClose, onApply }: {
  fillups:Fillup[]; hasAuthored:boolean; onClose:()=>void;
  onApply:(candidate:TextReceipt, identity:ImportIdentity)=>void;
}) {
  const [text,setText]=useState(''), [candidate,setCandidate]=useState<TextReceipt|null>(null);
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const [confirmed,setConfirmed]=useState(false), [replace,setReplace]=useState(false), [duplicate,setDuplicate]=useState(false), [identityConfirmed,setIdentityConfirmed]=useState(false);
  const [identityCheck,setIdentityCheck]=useState<{key:string;exact:boolean}|null>(null);
  const generation=useRef(0), controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>{generation.current++;controller.current?.abort();},[]);
  function invalidate() { generation.current++;controller.current?.abort();setCandidate(null);setBusy(false);setError('');setConfirmed(false);setReplace(false);setDuplicate(false);setIdentityConfirmed(false); }
  function edit(patch:Partial<TextReceipt>) { generation.current++;setBusy(false);setCandidate(prev=>prev?{...prev,...patch}:null);setConfirmed(false);setReplace(false);setDuplicate(false);setIdentityConfirmed(false);setError(''); }
  async function file(file?:File) {
    if(!file)return;invalidate();setText('');setBusy(true);const token=generation.current;
    controller.current=new AbortController();
    try { const value=await extractReceiptPdf(file,controller.current.signal);if(token!==generation.current)return;setText(value);setCandidate(parseReceiptText(value)); }
    catch(e){if(token===generation.current)setError(e instanceof Error?e.message:'לא ניתן לקרוא את הקובץ. אפשר להדביק טקסט.');}
    finally{if(token===generation.current)setBusy(false);}
  }
  const matches=candidate ? possibleReceiptDuplicates(fillups,candidate) : [];
  const identityKey=JSON.stringify([text,candidate?.identity,identityConfirmed,fillups.map(row=>[row.importRowHash,row.importBatchId])]);
  useEffect(()=>{
    if(!candidate)return;
    let active=true;
    void receiptHash(text,candidate.identity,identityConfirmed).then(identity=>{
      if(active)setIdentityCheck({key:identityKey,exact:fillups.some(row=>row.importRowHash===identity.hash || row.importBatchId===identity.textHash)});
    }).catch(()=>{if(active)setIdentityCheck(null);});
    return()=>{active=false;};
  },[identityKey,candidate,fillups,text,identityConfirmed]);
  const exactDuplicate=identityCheck?.key===identityKey && identityCheck.exact;
  const identityChecked=identityCheck?.key===identityKey;
  async function apply() {
    if(!candidate || busy)return;setError('');
    if(candidate.credit){setError('מסמך זיכוי אינו תדלוק. רשמו החזר במסך הרכב שלי.');return;}
    if(!reviewedScan({total:candidate.total,liters:candidate.liters,odometer:'1'}) || !validDay(candidate.day) || candidate.day>localDay() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(candidate.time)) {
      setError('בדקו סכום דלק, ליטרים, תאריך ושעה מהקבלה.');return;
    }
    const token=generation.current;setBusy(true);
    try {
      const identity=await receiptHash(text,candidate.identity,identityConfirmed);
      if(token!==generation.current)return;
      if(fillups.some(row=>row.importRowHash===identity.hash || row.importBatchId===identity.textHash)) {setError('המסמך הזה כבר יובא לרכב הזה, גם אם הרשומה נערכה מאז. אפשר לערוך אותו בהיסטוריה.');return;}
      if(!confirmed || (hasAuthored&&!replace) || (matches.length&&!duplicate)){setError('יש לבדוק ולאשר את הנתונים ואת ההתאמות האפשריות.');return;}
      onApply(candidate,identity);
    } catch {if(token===generation.current)setError('לא ניתן להכין את המסמך. נסו שוב.');}
    finally {if(token===generation.current)setBusy(false);}
  }
  return <Sheet open onClose={onClose} title={<h2 className="text-lg font-bold">ייבוא קבלה</h2>}><div className="flex flex-col gap-4">
    <p className="text-sm text-muted">PDF עם טקסט או טקסט שהעתקתם. חילוץ כללי וניסיוני; בדקו מול הקבלה. המסמך עצמו נשאר במכשיר ואינו נשמר.</p>
    <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-accent p-3 font-semibold text-accent">בחירת PDF<input className="sr-only" aria-label="קובץ קבלה PDF" type="file" accept="application/pdf,.pdf" onChange={e=>{void file(e.target.files?.[0]);e.target.value='';}} /></label>
    <label className="flex flex-col gap-2 text-sm">טקסט הקבלה<textarea dir="auto" maxLength={100000} value={text} className="min-h-28 rounded-xl border border-line bg-surface p-3 text-base" onChange={e=>{invalidate();setText(e.target.value);}} /></label>
    <Button variant="secondary" disabled={!text.trim()||busy} onClick={()=>{invalidate();try{setCandidate(parseReceiptText(text));}catch(e){setError((e as Error).message);}}}>חילוץ נתונים מהטקסט</Button>
    <Link to="/settings/import" onClick={onClose} className="min-h-11 py-2 text-sm text-accent">לייבוא CSV / XLSX הקיים</Link>
    {busy ? <p role="status">קוראים במכשיר…</p>:null}
    {candidate ? <>
      <details className="rounded-xl bg-surface-2 p-3 text-sm"><summary className="min-h-11 cursor-pointer">פירוט השורות שזוהו</summary>{candidate.sections.map((line,i)=><p key={i} className="my-2 break-words"><b>{{fuel:'דלק',shop:'חנות',discount:'הנחה',fee:'עמלה',credit:'זיכוי',other:'לא מסווג'}[line.kind]}: </b><bdi>{line.text}</bdi></p>)}</details>
      {candidate.credit ? <p role="alert" className="text-danger">זהו מסמך זיכוי. אין להוסיף ממנו ליטרים. אפשר לרשום החזר ב״הרכב שלי״.</p> : <>
        <Field label="עלות הדלק ששולמה" value={candidate.total} inputMode="decimal" suffix="₪" onChange={e=>edit({total:e.target.value})} />
        <Field label="ליטרים בקבלה" value={candidate.liters} inputMode="decimal" onChange={e=>edit({liters:e.target.value})} />
        <div className="grid grid-cols-2 gap-2"><Field label="תאריך הקבלה" type="date" max={localDay()} value={candidate.day} onChange={e=>edit({day:e.target.value})}/><Field label="שעת התדלוק" type="time" value={candidate.time} onChange={e=>edit({time:e.target.value})}/></div>
        <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2">מזהי מסמך למניעת כפילות</summary><div className="flex flex-col gap-3">{(['issuer','series','branch','number'] as const).map((key,i)=><Field key={key} label={['מזהה מנפיק','סדרת מסמך','סניף','מספר מסמך'][i]} maxLength={120} value={candidate.identity[key]} onChange={e=>edit({identity:{...candidate.identity,[key]:e.target.value}})} />)}<label className="flex min-h-12 items-center gap-2"><input type="checkbox" checked={identityConfirmed} onChange={e=>{generation.current++;setBusy(false);setDuplicate(false);setIdentityConfirmed(e.target.checked);}}/>בדקתי את כל ארבעת המזהים מול המסמך</label></div></details>
        <p className="text-xs text-muted">בלי ארבעה מזהים מאושרים נבדקת חזרה של אותו טקסט בלבד. התאמות בסכום ובתאריך מחייבות בדיקה.</p>
        {exactDuplicate ? <p role="alert" className="text-sm text-danger">המסמך הזה כבר יובא לרכב הזה. אפשר לערוך אותו בהיסטוריה.</p> : identityChecked && matches.length ? <label className="flex min-h-12 items-center gap-2 text-sm text-warning-ink"><input type="checkbox" checked={duplicate} onChange={e=>setDuplicate(e.target.checked)}/>{matches.length} תדלוקים דומים ברכב הזה. בדקתי שזה תדלוק נוסף ונפרד.</label>:null}
        {hasAuthored ? <label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/>להחליף את הסכום, הליטרים והתאריך שכבר הזנתי בטופס</label>:null}
        <label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>בדקתי: אלה ליטרים ועלות דלק ששולמה, אחרי הנחות וללא מוצרי חנות ועמלות</label>
        <Button disabled={busy || exactDuplicate} onClick={()=>void apply()}>העברה לבדיקה בטופס</Button>
      </>}
    </>:null}
    {error ? <p role="alert" className="text-sm text-danger">{error}</p>:null}
    <Button variant="ghost" onClick={onClose}>חזרה לטופס</Button>
  </div></Sheet>;
}
