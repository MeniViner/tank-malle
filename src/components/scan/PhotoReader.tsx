import { LiveCamera } from './LiveCamera';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { PumpIcon, GaugeIcon, UploadIcon } from '../icons';
import type { DisplayKind, DisplayReading } from '../../lib/scan/automaticDisplay';
import { CaptureSession, type SessionDecision } from '../../lib/scan/session';
import type { RecognizerState } from '../../lib/scan/display.worker';
import { acquireScanWorker } from '../../lib/scan/scanWorker';
import type { QualityHint } from '../../lib/scan/quality';

const HINTS: Record<QualityHint, string> = { 'too-dark': 'חשוך מדי. הדליקו את לוח המחוונים או קרבו את הטלפון לתצוגה.', glare: 'יש סנוור על התצוגה. הטו מעט את הטלפון.', blurred: 'התמונה מטושטשת. החזיקו את הטלפון יציב.' };
/** Why an automatic reading was not filled in, in the person's terms. */
function abstention(decision: Extract<SessionDecision, { status: 'abstained' }>, kind: DisplayKind) {
  if (decision.reasons['trip-meter']) return 'נראה שזה מד טיול (TRIP), לא מד המרחק המצטבר (ODO). עברו לתצוגת ODO, או המשיכו ידנית.';
  if (decision.reasons['unit-miles']) return 'המד נראה במיילים. הטופס שומר קילומטרים, אז המשיכו ידנית.';
  if (decision.reasons['foreign-currency']) return 'המשאבה מציגה מטבע אחר. הטופס שומר שקלים, אז המשיכו ידנית.';
  if (decision.reasons['recognizer-loading']) return 'הקורא המקומי עדיין נטען (החיבור איטי). נסו שוב בעוד רגע, או המשיכו ידנית.';
  if (decision.reason === 'conflict') return 'התקבלו קריאות סותרות, ולכן לא מילאנו דבר. נסו שוב קרוב יותר או המשיכו ידנית.';
  if (decision.reasons['identity-ambiguous']) return kind === 'pump' ? 'לא ברור איזה מספר הוא הסכום ואיזה הליטרים. כללו בתמונה את הכיתוב שליד המספרים, או המשיכו ידנית.' : 'לא ברור איזה מספר הוא מד המרחק המצטבר. כללו בתמונה את הכיתוב ODO/ק״מ, או המשיכו ידנית.';
  return 'הספרות עדיין לא ברורות מספיק. נסו שוב קרוב יותר בלי סנוור, או המשיכו ידנית.';
}

/** Files and video pixels live only in memory; the worker returns attempts,
 * and a capture session decides whether anything is filled in. */
export function PhotoReader({ kind,autoOpen=false,onRead }: { kind:DisplayKind;autoOpen?:boolean;onRead:(values:DisplayReading,live:boolean)=>void }) {
  const [cameraOpen,setCameraOpen]=useState(autoOpen),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[hint,setHint]=useState('');
  const [recognizer,setRecognizer]=useState<RecognizerState>('loading');
  const generation=useRef(0),session=useRef<CaptureSession|null>(null),recognizerState=useRef<RecognizerState>('loading');
  const worker=useRef<ReturnType<typeof acquireScanWorker>|null>(null);
  useEffect(()=>{
    const handle=acquireScanWorker(next=>{
      // The scanning bound starts once recognition can start.
      if(next!=='loading')session.current?.recognizerSettled();
      recognizerState.current=next;setRecognizer(next);
    });
    worker.current=handle;
    return()=>{handle.release();worker.current=null;};
  },[]);
  // Any answer still in flight belongs to a reader that is gone.
  useLayoutEffect(()=>()=>{generation.current++;},[]);
  const analyze=(image:ImageData,frame:number,wait:boolean,timeoutMs:number)=>worker.current?worker.current.analyze(image,frame,kind,wait,timeoutMs):Promise.resolve(null);
  function settle(decision:SessionDecision,live:boolean) {
    if(decision.status==='accepted'){onRead(decision.values,live);return true;}
    if(decision.status==='abstained'){setHint('');setMessage(abstention(decision,kind));setCameraOpen(false);return true;}
    return false;
  }
  async function frame(image:ImageData,isActive:()=>boolean,index:number) {
    const token=generation.current;
    // On first use the recogniser may still be downloading: frames are read
    // meanwhile (the segment reader can already succeed), but the session's
    // time bound waits for the recogniser, up to its own loading bound.
    session.current??=new CaptureSession(kind,{loading:recognizerState.current==='loading'});
    // Generous: a weak phone may need several seconds per frame, and a timeout
    // replaces the worker (reloading the recogniser).
    const analysis=await analyze(image,index,false,45000);
    if(token!==generation.current||!isActive()||!analysis||!session.current)return false;
    session.current.frame(index,analysis.quality.hint);
    for(const attempt of analysis.attempts)session.current.attempt(attempt);
    setHint(analysis.quality.hint?HINTS[analysis.quality.hint]:'');
    return settle(session.current.decide(),true);
  }
  function openCamera(){generation.current++;session.current=null;setMessage('');setHint('');setCameraOpen(true);}
  async function load(file?:File) {
    if(!file)return;
    const token=++generation.current;session.current=null;setCameraOpen(false);setBusy(false);setMessage('');setHint('');
    if(file.size>20_000_000 || !(/^image\/(jpeg|png|webp|heic|heif|avif)$/.test(file.type)||(!file.type&&/\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name)))){setMessage('בחרו תמונה בגודל עד 20 MB.');return;}
    setBusy(true);const url=URL.createObjectURL(file);
    try {
      const image=new Image();
      // WebKit can delay decode() for detached images by about a second.
      // The load event makes dimensions available; drawImage decodes pixels.
      await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('image'));image.src=url;});
      if(token!==generation.current)return;
      if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>60_000_000)throw new Error('size');
      // The whole photo at up to 2560 px; the worker finds and recrops the display.
      const ratio=Math.min(1,2560/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
      canvas.width=Math.round(image.naturalWidth*ratio);canvas.height=Math.round(image.naturalHeight*ratio);
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('canvas');
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const analysis=await analyze(ctx.getImageData(0,0,canvas.width,canvas.height),0,true,120000);
      if(token!==generation.current)return;
      if(!analysis){setMessage('הקריאה במכשיר נכשלה. נסו שוב או המשיכו ידנית.');return;}
      const still=new CaptureSession(kind,{still:true});still.frame(0,analysis.quality.hint);
      for(const attempt of analysis.attempts)still.attempt(attempt);
      // A still photo is a session of one frame: always decided here.
      const decision=still.decide();
      if(decision.status==='accepted')onRead(decision.values,false);
      else if(decision.status==='abstained')setMessage(`${analysis.quality.hint?HINTS[analysis.quality.hint]+' ':''}${abstention(decision,kind)}`);
    }catch{if(token===generation.current)setMessage('התמונה לא נפתחה. נסו JPEG או המשיכו ידנית.');}
    finally{URL.revokeObjectURL(url);if(token===generation.current)setBusy(false);}
  }
  const Icon=kind==='pump'?PumpIcon:GaugeIcon;
  return <div className="flex flex-col gap-4">
    {cameraOpen?<LiveCamera onFrame={frame} onClose={()=>{generation.current++;session.current=null;setCameraOpen(false);setHint('');}}/>:
      <div className="scan-start"><span className="scan-start-icon"><Icon size={38}/></span><h3>{kind==='pump'?'מצלמים את המשאבה':'עוברים למד הקילומטרים'}</h3><p>{kind==='pump'?'הסכום והליטרים ייקראו יחד, אוטומטית.':'כוונו אל מד המרחק המצטבר (ODO) כשהרכב עומד.'}</p><Button full onClick={openCamera}>{message?'ניסיון נוסף במצלמה':'פתיחת מצלמה'}</Button></div>}
    <label className="scan-photo-choice"><UploadIcon size={18}/>{busy?'קוראים את התמונה…':'בחירת תמונה מהמכשיר'}<input className="sr-only" type="file" accept="image/*" aria-label={kind==='pump'?'תמונת משאבה':'תמונת קילומטראז׳'} onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/></label>
    {(cameraOpen||busy)&&recognizer==='loading'?<p role="status" className="text-sm leading-relaxed text-muted">מכינים את הקורא המקומי. בפעם הראשונה הוא נטען למכשיר ונשמר בו.</p>:null}
    {(cameraOpen||busy)&&recognizer==='unavailable'?<p role="status" className="text-sm leading-relaxed text-muted">הקורא המלא לא זמין כרגע במכשיר (למשל בלי חיבור בפעם הראשונה). נמשיך בקורא הבסיסי, ואפשר להזין ידנית.</p>:null}
    {cameraOpen&&hint?<p role="status" className="text-sm leading-relaxed text-muted">{hint}</p>:null}
    {message?<p role="status" className="text-sm leading-relaxed text-muted">{message}</p>:null}
    {busy?<p role="status" className="sr-only">מזהים את הספרות במכשיר…</p>:null}
  </div>;
}
