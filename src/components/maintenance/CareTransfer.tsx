import { useRef, useEffect, useState } from 'react';
import { Button } from '../Button';
import { Sheet } from '../Sheet';
import { careBackup, careCostsCsv, downloadCareFile, importPreview, readCareBackup, type CareBackup } from '../../lib/maintenance/export';
import type { CareCollection, CareData, CareRecord } from '../../lib/maintenance/model';
import type { MutationReceipt } from '../../lib/writes';

export function CareTransfer({ vehicleId,label,data,incomplete,canImport,onSave,onClose }: {
  vehicleId:string;label:string;data:CareData;incomplete:boolean;canImport:boolean;
  onSave:(name:CareCollection,record:CareRecord)=>Promise<MutationReceipt>;onClose:()=>void;
}) {
  const [backup,setBackup]=useState<CareBackup|null>(null);
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const current=useRef(true); const generation=useRef(0);
  useEffect(()=>{current.current=true;return()=>{current.current=false;};},[]);
  const preview=backup?importPreview(backup,data):null;
  async function load(file?:File) {
    if(!file)return; const token=++generation.current;setBackup(null);setConfirmed(false);setMessage('');
    if(file.size>5_000_000){setMessage('בחרו גיבוי בגודל עד 5 MB.');return;}
    try{const parsed=readCareBackup(await file.text());if(current.current && token===generation.current)setBackup(parsed);}
    catch(e){if(current.current && token===generation.current)setMessage(e instanceof Error?e.message:'לא ניתן לקרוא את הגיבוי.');}
  }
  async function restore(){
    if(!preview || !confirmed || !canImport || busy || preview.conflicts || !preview.additions.length)return;
    const token=++generation.current;setBusy(true);let written=0;const receipts:MutationReceipt[]=[];
    try{
      for(const {collection,record} of preview.additions){if(!current.current)break;const receipt=await onSave(collection,record);receipts.push(receipt);written++;}
      if(!current.current)return;
      setMessage(`${written} רשומות נשמרו במכשיר וממתינות לסנכרון.`);
      // Delivery may wait indefinitely offline. Journaling finished, so the user can close the sheet.
      void Promise.all(receipts.map(r=>r.settled)).then(outcomes=>{
        if(!current.current || token!==generation.current)return;
        setMessage(outcomes.every(Boolean)?`${written} רשומות יובאו ואושרו בשרת.`:'חלק מהרשומות טרם אושרו. הקלט נשמר בפעולות שלא סונכרנו.');
        setBackup(null);setConfirmed(false);
      });
    }catch(e){if(current.current)setMessage(`${written} רשומות נשמרו במכשיר לפני העצירה. ${e instanceof Error?e.message:'הייבוא לא הושלם.'}`);}
    finally{if(current.current)setBusy(false);}
  }
  return <Sheet open onClose={()=>{if(!busy)onClose();}} title={<h2 className="text-lg font-bold">גיבוי וייצוא תחזוקה</h2>}><div className="flex flex-col gap-4">
    <p className="text-sm text-muted">{label} בלבד. הגיבוי כולל טיפולים, תזכורות, הוצאות ועדכוני ק״מ. תדלוקים מיוצאים בנפרד מהפרופיל.</p>
    {incomplete?<p className="rounded-lg bg-warning-soft p-3 text-sm text-warning-ink">העותק במכשיר עשוי להיות חלקי או לכלול שינויים שטרם סונכרנו. הקובץ יסומן בהתאם.</p>:null}
    <Button variant="secondary" onClick={()=>{downloadCareFile(careBackup({id:vehicleId,label},data,incomplete),'tank-maleh-care.json','application/json;charset=utf-8');setMessage('הגיבוי הוכן להורדה.');}}>הורדת גיבוי JSON</Button>
    <Button variant="secondary" onClick={()=>{downloadCareFile(careCostsCsv(data),'tank-maleh-care-costs.csv','text/csv;charset=utf-8');setMessage('דוח העלויות הוכן להורדה.');}}>ייצוא עלויות CSV</Button>
    <hr className="border-line" />
    <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-line p-3 font-semibold focus-within:ring-2 focus-within:ring-accent">בחירת גיבוי לשחזור<input className="sr-only" type="file" accept="application/json,.json" aria-label="קובץ גיבוי תחזוקה" disabled={busy} onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}} /></label>
    {!canImport?<p className="text-sm text-muted">ייבוא זמין אחרי קבלת נתוני הרכב מהשרת וסיום הפעולות הממתינות.</p>:null}
    {backup && preview?<div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3 text-sm">
      <p>רכב בקובץ: <b>{backup.vehicle.label}</b></p><p>רכב יעד: <b>{label}</b></p>
      <p>{preview.additions.length} רשומות חדשות · {preview.duplicates} כבר קיימות · {preview.conflicts} עם תוכן שונה</p>
      {backup.incomplete?<p>הגיבוי סומן כחלקי; הוא אינו מבטיח היסטוריה מלאה.</p>:null}
      {preview.conflicts?<p role="alert" className="text-danger">לא יתבצע ייבוא: קיימות רשומות עם אותו מזהה ותוכן אחר. שמרו את שני הגיבויים לבדיקה.</p>:null}
      <label className="flex min-h-12 items-center gap-2"><input type="checkbox" className="size-5 flex-none" disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />בדקתי שהרשומות שייכות לרכב היעד ושברצוני להוסיף אותן</label>
      <Button loading={busy} disabled={!confirmed||!canImport||!!preview.conflicts||!preview.additions.length} onClick={()=>void restore()}>ייבוא הרשומות החדשות</Button>
    </div>:null}
    {message?<p role="status" className="text-sm">{message}</p>:null}
  </div></Sheet>;
}
