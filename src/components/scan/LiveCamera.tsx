import { useEffect, useRef, useState } from 'react';
import { Button } from '../Button';

/** No shutter or crop UI. The camera samples whole frames until the capture
 * session decides (or reaches its bound). Every effect owns its stream,
 * including late permission results. */
export function LiveCamera({ onFrame,onClose }: { onFrame:(image:ImageData,isActive:()=>boolean,frame:number)=>Promise<boolean>;onClose:()=>void }) {
  const video=useRef<HTMLVideoElement>(null),frame=useRef(onFrame);
  useEffect(()=>{frame.current=onFrame;},[onFrame]);
  const [state,setState]=useState<'opening'|'ready'|'paused'|'error'>('opening');
  useEffect(()=>{
    let samples=0,cancelled=false,ownedStream:MediaStream|null=null,timer:ReturnType<typeof setTimeout>|undefined;
    const stop=()=>{cancelled=true;clearTimeout(timer);ownedStream?.getTracks().forEach(track=>track.stop());ownedStream=null;};
    const background=()=>{if(document.visibilityState==='hidden'){stop();setState('paused');}};
    const pagehide=()=>stop();
    document.addEventListener('visibilitychange',background);window.addEventListener('pagehide',pagehide);
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
    async function sample() {
      const input=video.current;if(cancelled||!input||!context)return;
      if(input.readyState>=2 && input.videoWidth) {
        // The whole frame at up to 1920 px: the worker reads a working copy and
        // recrops the display it finds from these full-resolution pixels.
        const ratio=Math.min(1,1920/Math.max(input.videoWidth,input.videoHeight));
        canvas.width=Math.round(input.videoWidth*ratio);canvas.height=Math.round(input.videoHeight*ratio);
        context.drawImage(input,0,0,canvas.width,canvas.height);
        try {if(await frame.current(context.getImageData(0,0,canvas.width,canvas.height),()=>!cancelled&&document.visibilityState!=='hidden',samples++)){stop();return;}}catch{/* Retry the next local frame. */}
      }
      if(!cancelled)timer=setTimeout(()=>void sample(),180);
    }
    void (async()=>{
      try {
        if(document.visibilityState==='hidden'){background();return;}
        if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
        const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1440}},audio:false});
        if(cancelled){next.getTracks().forEach(track=>track.stop());return;}
        ownedStream=next;if(!video.current)throw new Error('closed');
        video.current.srcObject=next;await video.current.play();
        if(!cancelled){setState('ready');void sample();}
      }catch{if(!cancelled){stop();setState('error');}}
    })();
    return()=>{stop();document.removeEventListener('visibilitychange',background);window.removeEventListener('pagehide',pagehide);};
  },[]);
  return <div className="scan-camera">
    <video ref={video} playsInline muted autoPlay aria-label="תצוגת מצלמה" />
    <div className="scan-camera-caption"><span className={state==='ready'?'scan-live-dot':''} aria-hidden="true"/><p role="status">{{opening:'פותחים מצלמה…',ready:'מחפשים את הספרות… הזיהוי אוטומטי',paused:'המצלמה נעצרה ברקע. סגרו ופתחו אותה כדי להמשיך.',error:'המצלמה לא זמינה. אפשר לבחור תמונה או להמשיך ידנית.'}[state]}</p></div>
    <Button size="sm" variant="ghost" onClick={onClose}>סגירת מצלמה</Button>
  </div>;
}
