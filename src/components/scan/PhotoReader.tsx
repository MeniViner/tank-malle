import { recordScanTiming } from '../../lib/scan/scanTiming';
import { LiveCamera } from './LiveCamera';
import { useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { Button } from '../Button';
import { PumpIcon, GaugeIcon, UploadIcon } from '../icons';
import { MAX_PIXELS, type FoundRegion, type Accept, type DisplayKind, type DisplayReading, type DisplayResult, type ScanContext } from '../../lib/scan/engine';
import type { ScanAttempt } from '../../lib/scan/samples';
import { nativeBuild } from '../../lib/native/platform';
import { readPhotoMetadata, type PhotoMetadata } from '../../lib/scan/photoMetadata';

/**
 * The photo itself is read in a worker and dropped. With `onAttempt`, each attempt (a camera
 * session, a chosen file) is reported with the rows the engine cut out, for `lib/scan/samples`.
 * `context` (last odometer, tank size) helps the reader choose between rows; it is optional.
 */
export type PhotoReaderControls = { closeCamera: () => boolean };

export function PhotoReader({ cloudEnabled,kind,autoOpen=false,onRead,onPhotoMetadata,context,onAttempt,accept,controlsRef }: { cloudEnabled:boolean;kind:DisplayKind;autoOpen?:boolean;onRead:(values:DisplayReading,live:boolean)=>void;
  /** Where and when a chosen photo was taken (EXIF), read on the device; not called for camera frames. */
  onPhotoMetadata?:(metadata:PhotoMetadata,kind:DisplayKind,live?:boolean)=>void;context?:ScanContext;onAttempt?:(attempt:ScanAttempt)=>void;accept?:Partial<Accept>|null;controlsRef?:Ref<PhotoReaderControls> }) {
  const [cameraOpen,setCameraOpen]=useState(autoOpen),[busy,setBusy]=useState(false),[preview,setPreview]=useState<string|null>(null),[aspect,setAspect]=useState<number|null>(null),[found,setFound]=useState<FoundRegion[]|null>(null),[message,setMessage]=useState('');
  const generation=useRef(0),worker=useRef<Worker|null>(null),pending=useRef<((result:DisplayResult)=>void)|null>(null),lastFrame=useRef('');
  const journal=(context?.lastOdometer??0)>0,report=useRef(onAttempt),finish=useRef(()=>{});
  const cloudRequest = useRef<AbortController | null>(null);
  const [readingCloud, setReadingCloud] = useState(false);
  const sharingRevision = useRef(0);
  useLayoutEffect(() => {
    if (Boolean(report.current) !== Boolean(onAttempt)) sharingRevision.current++;
    report.current = onAttempt;
    finish.current = () => endCamera();
  });
  // One camera session is one attempt: its frames are counted and the most confident one is kept.
  const camera=useRef<{start:number;frames:number;best:DisplayResult|null;cloudTried:boolean;cloudReading?:DisplayReading|null;sharingRevision:number}|null>(null);
  function endCamera(read:DisplayResult|null=null){
    const session=camera.current;camera.current=null;
    if(!session||!session.frames||session.sharingRevision!==sharingRevision.current)return;
    const result:DisplayResult|null=read??(session.best?{status:'unreadable',sample:session.best.sample}:null);
    recordScanTiming(session.start, 'camera', kind, result?.status === 'read' || !!session.cloudReading, session.cloudReading !== undefined);
    report.current?.({kind,source:'camera',result,cloudReading:session.cloudReading,frames:session.frames,seconds:(Date.now()-session.start)/1000,journal});
  }
  function cancel(){cloudRequest.current?.abort();worker.current?.terminate();worker.current=null;pending.current?.({status:'unreadable'});pending.current=null;}
  function closeCamera() {
    if (!cameraOpen) return false;
    generation.current++;
    cancel();
    endCamera();
    setCameraOpen(false);
    lastFrame.current = '';
    return true;
  }
  useImperativeHandle(controlsRef, () => ({ closeCamera }));
  useLayoutEffect(()=>()=>{generation.current++;cancel();finish.current();},[]);
  function scan(image:ImageData,sample:boolean,limit=8000):Promise<DisplayResult> {
    return new Promise(resolve=>{
      if(!worker.current)worker.current=new Worker(new URL('../../lib/scan/display.worker.ts',import.meta.url),{type:'module'});
      const timeout=setTimeout(()=>cancel(),limit);
      pending.current=result=>{clearTimeout(timeout);resolve(result);};
      worker.current.onmessage=(event:MessageEvent<DisplayResult>)=>{pending.current?.(event.data);pending.current=null;};
      worker.current.onerror=()=>cancel();
      worker.current.postMessage({width:image.width,height:image.height,data:image.data,kind,context,options:{sample,accept,cloudCrop:cloudEnabled}},[image.data.buffer]);
    });
  }
  async function fallback(result: DisplayResult, active: () => boolean, onGenerate: () => void) {
    const crop = result.cloudCrop;
    if (!cloudEnabled || !crop || !navigator.onLine || !active()) return undefined;
    const controller = new AbortController();
    cloudRequest.current = controller;
    setReadingCloud(true);
    const abort = () => controller.abort();
    const visibility = () => { if (document.hidden) abort(); };
    window.addEventListener('pagehide', abort);
    document.addEventListener('visibilitychange', visibility);
    const timeout = setTimeout(abort, 15000);
    const aborted = new Promise<undefined>(resolve => controller.signal.addEventListener('abort', () => resolve(undefined), { once: true }));
    try {
      const request = async () => {
        const { cloudScan } = await import('../../lib/scan/cloudScan');
        if (!active() || controller.signal.aborted) return undefined;
        return cloudScan(kind, crop, context ?? {}, controller.signal, onGenerate);
      };
      return await Promise.race([request(), aborted]);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
      window.removeEventListener('pagehide', abort);
      document.removeEventListener('visibilitychange', visibility);
      if (cloudRequest.current === controller) {
        cloudRequest.current = null;
        setReadingCloud(false);
      }
    }
  }
  async function frame(image:ImageData,isActive:()=>boolean) {
    camera.current??={start:Date.now(),frames:0,best:null,cloudTried:false,sharingRevision:sharingRevision.current};
    const sample = Boolean(report.current) && camera.current.sharingRevision === sharingRevision.current;
    const token=generation.current,result=await scan(image,sample);
    if(token!==generation.current||!isActive()){lastFrame.current='';return false;}
    const session=camera.current;
    if(session){session.frames++;if(result.sample&&(result.sample.confidence??-1)>=(session.best?.sample?.confidence??-1))session.best=result;}
    const signature=result.status==='read'?JSON.stringify(result.values):'';
    if(signature && signature===lastFrame.current && result.status==='read'){endCamera(result);onPhotoMetadata?.({takenAt:null,position:null},kind,true);onRead(result.values,true);return true;}
    lastFrame.current=signature;
    if (session && !session.cloudTried && session.frames >= 3 && result.status === 'unreadable' && result.cloudCrop) {
      session.cloudTried = true;
      const active = () => token === generation.current && isActive();
      const reading = await fallback(result, active, () => { session.cloudReading = null; });
      if (!active()) return false;
      if (reading) session.cloudReading = reading;
      if (reading) {
        endCamera(result);
        onPhotoMetadata?.({takenAt:null,position:null},kind,true);
        onRead(reading,true);
        return true;
      }
    }
    return false;
  }
  async function load(file?:File) {
    if(!file)return;
    const fileStarted = Date.now();
    const sharingAtStart = sharingRevision.current;
    const token=++generation.current;cancel();endCamera();setCameraOpen(false);setBusy(false);setMessage('');setFound(null);setAspect(null);lastFrame.current='';
    if(file.size>20_000_000 || !(/^image\/(jpeg|png|webp|heic|heif|avif)$/.test(file.type)||(!file.type&&/\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name)))){setMessage('בחרו תמונה בגודל עד 20 MB.');return;}
    if(onPhotoMetadata)void readPhotoMetadata(file).then(metadata=>{if(token===generation.current)onPhotoMetadata(metadata,kind);});
    setBusy(true);const url=URL.createObjectURL(file);setPreview(url);
    try {
      const image=new Image();
      // WebKit can delay decode() for detached images by about a second.
      // The load event makes dimensions available; drawImage decodes pixels.
      await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('image'));image.src=url;});
      if(token!==generation.current)return;
      if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>60_000_000)throw new Error('size');
      setAspect(image.naturalWidth/image.naturalHeight);
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw new Error('canvas');
      // The whole photo at full size: a display is often a small part of it,
      // and shrinking the photo first would erase its digits.
      const ratio=Math.min(1,Math.sqrt(MAX_PIXELS/(image.naturalWidth*image.naturalHeight)));
      canvas.width=Math.floor(image.naturalWidth*ratio);canvas.height=Math.floor(image.naturalHeight*ratio);
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const sample = Boolean(report.current) && sharingAtStart === sharingRevision.current;
      const started=Date.now(),result=await scan(ctx.getImageData(0,0,canvas.width,canvas.height),sample,45000);
      canvas.width=canvas.height=0;
      if(token!==generation.current)return;
      const active = () => token === generation.current && document.visibilityState !== 'hidden';
      let generated = false;
      const suggestion = result.status === 'unreadable' ? await fallback(result, active, () => { generated = true; }) : undefined;
      const cloudReading = generated ? (suggestion ?? null) : undefined;
      if (token !== generation.current) return;
      recordScanTiming(fileStarted, 'file', kind, result.status === 'read' || !!cloudReading, cloudReading !== undefined);
      if (sharingAtStart === sharingRevision.current) {
        report.current?.({kind,source:'file',result,cloudReading,frames:1,seconds:(Date.now()-started)/1000,journal});
      }
      if(result.status==='read'){
        // A beat to show where the numbers were found before moving on.
        if(result.regions?.length){setFound(result.regions);await new Promise(resolve=>setTimeout(resolve,1100));if(token!==generation.current)return;}
        onRead(result.values,false);return;
      }
      if (cloudReading && active()) { onRead(cloudReading,false); return; }
      setMessage('הספרות עדיין לא ברורות מספיק. נסו צילום קרוב יותר בלי סנוור, או סגרו את הצילום והשלימו בטופס.');
    }catch{if(token===generation.current)setMessage('התמונה לא נפתחה. נסו JPEG, או סגרו את הצילום והשלימו בטופס.');}
    finally{if(token===generation.current){setBusy(false);setPreview(null);setFound(null);}URL.revokeObjectURL(url);}
  }
  async function takeSystemPhoto() {
    const token = ++generation.current;
    cancel();
    endCamera();
    setCameraOpen(false);
    setBusy(true);
    setMessage('');
    lastFrame.current = '';
    try {
      const { captureScanPhoto } = await import('../../lib/native/camera');
      const photo = await captureScanPhoto();
      if (token === generation.current && photo) await load(photo);
    } catch {
      if (token === generation.current) setMessage('המצלמה לא זמינה. אפשר לבחור תמונה או להמשיך ידנית.');
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  const Icon=kind==='pump'?PumpIcon:GaugeIcon;
  return <div className="flex flex-col gap-4">
    {busy&&preview?<div className="scan-reading" data-testid="scan-reading" data-found={found?'true':undefined} aria-hidden="true">
      <div className="scan-reading-photo" style={aspect?{'--ar':aspect} as CSSProperties:undefined}><img src={preview} alt=""/>
        {found?found.map((region,i)=><span key={i} className="scan-found-box" data-testid="scan-found-box" style={{left:`${region.cx*100}%`,top:`${region.cy*100}%`,width:`${region.width*100}%`,height:`${region.height*100}%`,transform:`translate(-50%,-50%) rotate(${region.angle}deg)`,animationDelay:`${i*.12}s`}}/>):null}
      </div>
      {found?null:<><span className="scan-reading-grid"/><span className="scan-reading-beam"/></>}<span className="scan-reading-corners"/>
      <span className="scan-reading-label">{found?<>נמצא!</>:<><span className="scan-reading-dots"><i/><i/><i/></span>קוראים את הספרות</>}</span></div>:
     cameraOpen?<LiveCamera onFrame={frame} onClose={closeCamera}/>:
      <div className="scan-start"><span className="scan-start-icon"><Icon size={38}/></span><h3>{kind==='pump'?'מצלמים את המשאבה':'עוברים למד הקילומטרים'}</h3><p>{kind==='pump'?'הסכום והליטרים ייקראו יחד, אוטומטית.':'כוונו אל מד המרחק המצטבר כשהרכב עומד.'}</p><Button full onClick={()=>{setMessage('');setCameraOpen(true);}}>פתיחת מצלמה</Button></div>}
    {nativeBuild ? <Button variant="secondary" disabled={busy} onClick={() => void takeSystemPhoto()}>צילום דרך מצלמת המכשיר</Button> : null}
    <label className="scan-photo-choice"><UploadIcon size={18}/>{busy?'קוראים את התמונה…':'בחירת תמונה מהמכשיר'}<input className="sr-only" type="file" accept="image/*" aria-label={kind==='pump'?'תמונת משאבה':'תמונת קילומטראז׳'} onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/></label>
    {readingCloud && <p role="status" className="text-sm text-muted">קוראים את חיתוך הצג בעזרת Gemini…</p>}
    {message?<p role="status" className="text-sm leading-relaxed text-muted">{message}</p>:null}
    {busy&&!readingCloud?<p role="status" className="sr-only">מזהים את הספרות במכשיר…</p>:null}
  </div>;
}
