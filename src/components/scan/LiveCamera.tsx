import { useEffect, useRef, useState } from 'react';
import { Button } from '../Button';

/** User-opened live camera. Stop tracks on close, step change, background and late permission results. */
export function LiveCamera({ onImage,onClose }: { onImage:(file:File)=>void;onClose:()=>void }) {
  const video=useRef<HTMLVideoElement>(null);
  const alive=useRef(true); const [state,setState]=useState<'opening'|'ready'|'paused'|'error'|'capturing'>('opening');
  useEffect(()=>{
    let cancelled=false;let ownedStream:MediaStream|null=null;alive.current=true;
    // Each effect owns its stream: a late rejection from a retired camera must not stop its replacement.
    const stop=()=>{ownedStream?.getTracks().forEach(track=>track.stop());ownedStream=null;};
    const background=()=>{if(document.visibilityState==='hidden'){cancelled=true;stop();setState('paused');}};
    const pagehide=()=>{cancelled=true;stop();};
    document.addEventListener('visibilitychange',background);window.addEventListener('pagehide',pagehide);
    void (async()=>{
      try {
        if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
        const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}},audio:false});
        if(cancelled){next.getTracks().forEach(track=>track.stop());return;}
        ownedStream=next;
        if(!video.current)throw new Error('closed');
        video.current.srcObject=next; await video.current.play();
        if(!cancelled)setState('ready');
      }catch{stop();if(!cancelled)setState('error');}
    })();
    return()=>{cancelled=true;alive.current=false;stop();document.removeEventListener('visibilitychange',background);window.removeEventListener('pagehide',pagehide);};
  },[]);
  function capture(){
    const input=video.current;if(!input?.videoWidth || state!=='ready')return;
    setState('capturing');
    const ratio=Math.min(1,1280/Math.max(input.videoWidth,input.videoHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.round(input.videoWidth*ratio);canvas.height=Math.round(input.videoHeight*ratio);
    canvas.getContext('2d')?.drawImage(input,0,0,canvas.width,canvas.height);
    canvas.toBlob(blob=>{if(!alive.current)return;if(blob)onImage(new File([blob],'camera.jpg',{type:'image/jpeg'}));else setState('error');},'image/jpeg',.95);
  }
  return <div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3">
    <video ref={video} playsInline muted autoPlay className="max-h-64 w-full rounded-lg bg-black object-contain" aria-label="תצוגת מצלמה" />
    <p role="status" className="text-sm text-muted">{{opening:'פותחים מצלמה…',ready:'מקמו את הצג בתוך התמונה, בלי השתקפות.',paused:'המצלמה נעצרה כשעברתם לאפליקציה אחרת. אפשר לסגור ולפתוח מחדש.',error:'המצלמה לא זמינה או שההרשאה לא ניתנה. אפשר לבחור צילום למטה או להקליד ידנית.',capturing:'שומרים את הצילום בזיכרון…'}[state]}</p>
    <Button disabled={state!=='ready'} onClick={capture}>צילום</Button><Button size="sm" variant="ghost" onClick={onClose}>סגירת מצלמה</Button>
  </div>;
}
