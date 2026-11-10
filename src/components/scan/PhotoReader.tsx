import { LiveCamera } from './LiveCamera';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { PumpIcon, GaugeIcon, UploadIcon } from '../icons';
import { MAX_PIXELS, type DisplayKind, type DisplayReading, type DisplayResult, type ScanContext } from '../../lib/scan/engine';

/** Files and video pixels live only in memory; the worker returns numbers. */
/** `context` (last odometer, tank size) helps the reader choose between rows; it is optional. */
export function PhotoReader({ kind,autoOpen=false,onRead,context }: { kind:DisplayKind;autoOpen?:boolean;onRead:(values:DisplayReading,live:boolean)=>void;context?:ScanContext }) {
  const [cameraOpen,setCameraOpen]=useState(autoOpen),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const generation=useRef(0),worker=useRef<Worker|null>(null),pending=useRef<((result:DisplayResult)=>void)|null>(null),lastFrame=useRef('');
  function cancel(){worker.current?.terminate();worker.current=null;pending.current?.({status:'unreadable'});pending.current=null;}
  useLayoutEffect(()=>()=>{generation.current++;cancel();},[]);
  function scan(image:ImageData,limit=8000):Promise<DisplayResult> {
    return new Promise(resolve=>{
      if(!worker.current)worker.current=new Worker(new URL('../../lib/scan/display.worker.ts',import.meta.url),{type:'module'});
      const timeout=setTimeout(()=>cancel(),limit);
      pending.current=result=>{clearTimeout(timeout);resolve(result);};
      worker.current.onmessage=(event:MessageEvent<DisplayResult>)=>{pending.current?.(event.data);pending.current=null;};
      worker.current.onerror=()=>cancel();
      worker.current.postMessage({width:image.width,height:image.height,data:image.data,kind,context},[image.data.buffer]);
    });
  }
  async function frame(image:ImageData,isActive:()=>boolean) {
    const token=generation.current,result=await scan(image);
    if(token!==generation.current||!isActive()){lastFrame.current='';return false;}
    const signature=result.status==='read'?JSON.stringify(result.values):'';
    if(signature && signature===lastFrame.current && result.status==='read'){onRead(result.values,true);return true;}
    lastFrame.current=signature;return false;
  }
  async function load(file?:File) {
    if(!file)return;
    const token=++generation.current;cancel();setCameraOpen(false);setBusy(false);setMessage('');lastFrame.current='';
    if(file.size>20_000_000 || !(/^image\/(jpeg|png|webp|heic|heif|avif)$/.test(file.type)||(!file.type&&/\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name)))){setMessage('בחרו תמונה בגודל עד 20 MB.');return;}
    setBusy(true);const url=URL.createObjectURL(file);
    try {
      const image=new Image();
      // WebKit can delay decode() for detached images by about a second.
      // The load event makes dimensions available; drawImage decodes pixels.
      await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('image'));image.src=url;});
      if(token!==generation.current)return;
      if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>60_000_000)throw new Error('size');
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw new Error('canvas');
      // The whole photo at full size: a display is often a small part of it,
      // and shrinking the photo first would erase its digits.
      const ratio=Math.min(1,Math.sqrt(MAX_PIXELS/(image.naturalWidth*image.naturalHeight)));
      canvas.width=Math.floor(image.naturalWidth*ratio);canvas.height=Math.floor(image.naturalHeight*ratio);
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const result=await scan(ctx.getImageData(0,0,canvas.width,canvas.height),45000);
      canvas.width=canvas.height=0;
      if(token!==generation.current)return;
      if(result.status==='read'){onRead(result.values,false);return;}
      setMessage('הספרות עדיין לא ברורות מספיק. נסו צילום קרוב יותר בלי סנוור, או סגרו את הצילום והשלימו בטופס.');
    }catch{if(token===generation.current)setMessage('התמונה לא נפתחה. נסו JPEG, או סגרו את הצילום והשלימו בטופס.');}
    finally{URL.revokeObjectURL(url);if(token===generation.current)setBusy(false);}
  }
  const Icon=kind==='pump'?PumpIcon:GaugeIcon;
  return <div className="flex flex-col gap-4">
    {cameraOpen?<LiveCamera onFrame={frame} onClose={()=>{generation.current++;cancel();setCameraOpen(false);lastFrame.current='';}}/>:
      <div className="scan-start"><span className="scan-start-icon"><Icon size={38}/></span><h3>{kind==='pump'?'מצלמים את המשאבה':'עוברים למד הקילומטרים'}</h3><p>{kind==='pump'?'הסכום והליטרים ייקראו יחד, אוטומטית.':'כוונו אל מד המרחק המצטבר כשהרכב עומד.'}</p><Button full onClick={()=>{setMessage('');setCameraOpen(true);}}>פתיחת מצלמה</Button></div>}
    <label className="scan-photo-choice"><UploadIcon size={18}/>{busy?'קוראים את התמונה…':'בחירת תמונה מהמכשיר'}<input className="sr-only" type="file" accept="image/*" aria-label={kind==='pump'?'תמונת משאבה':'תמונת קילומטראז׳'} onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/></label>
    {message?<p role="status" className="text-sm leading-relaxed text-muted">{message}</p>:null}
    {busy?<p role="status" className="sr-only">מזהים את הספרות במכשיר…</p>:null}
  </div>;
}
