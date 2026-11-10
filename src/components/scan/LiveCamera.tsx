import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../Button';
import { cameraFrameCrop, createCameraZoom } from './cameraZoom';
import type { CameraZoomState } from './cameraZoom';
import type { Rect } from '../../lib/scan/v2/preprocess';
import './LiveCamera.css';

/** The camera samples until two consecutive frames agree. Every effect owns
 * its stream, including late permission results and late zoom/read callbacks. */
/** `guide` (scan v2 only) draws the viewfinder box, as fractions of the visible frame; the frame passed to `onFrame` is unchanged. */
export function LiveCamera({ onFrame,onClose,guide }: { onFrame:(image:ImageData,isActive:()=>boolean)=>Promise<boolean>;onClose:()=>void;guide?:Rect }) {
  const video=useRef<HTMLVideoElement>(null),frame=useRef(onFrame);
  const zoomControl=useRef<ReturnType<typeof createCameraZoom>|null>(null),zoomId=useId();
  const [zoom,setZoom]=useState<CameraZoomState|null>(null),[aspect,setAspect]=useState(4/3);
  useEffect(()=>{frame.current=onFrame;},[onFrame]);
  const [state,setState]=useState<'opening'|'ready'|'paused'|'error'>('opening');
  useEffect(()=>{
    let samples=0,cancelled=false,ownedStream:MediaStream|null=null,timer:ReturnType<typeof setTimeout>|undefined;
    let zoomGeneration=0,settleUntil=0;
    const stop=()=>{cancelled=true;clearTimeout(timer);zoomControl.current?.dispose();zoomControl.current=null;ownedStream?.getTracks().forEach(track=>track.stop());ownedStream=null;};
    const background=()=>{if(document.visibilityState==='hidden'){stop();setState('paused');}};
    const pagehide=()=>stop();
    document.addEventListener('visibilitychange',background);window.addEventListener('pagehide',pagehide);
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
    async function sample() {
      const input=video.current;if(cancelled||!input||!context)return;
      const currentZoom=zoomControl.current?.getState();
      if(input.readyState>=2 && input.videoWidth && !currentZoom?.busy && performance.now()>=settleUntil) {
        // Two frames at each scale preserve the agreement check at either size.
        const maximum=Math.floor(samples++/2)%2===0?960:1280;
        const crop=cameraFrameCrop(input.videoWidth,input.videoHeight,currentZoom?.mode==='digital'?currentZoom.value:1,maximum);
        canvas.width=crop.width;canvas.height=crop.height;
        context.drawImage(input,crop.sx,crop.sy,crop.sw,crop.sh,0,0,crop.width,crop.height);
        const generation=zoomGeneration;
        const isActive=()=>!cancelled&&generation===zoomGeneration&&document.visibilityState!=='hidden';
        try {if(await frame.current(context.getImageData(0,0,canvas.width,canvas.height),isActive)&&isActive()){stop();return;}}catch{/* Retry the next local frame. */}
      }
      if(!cancelled)timer=setTimeout(()=>void sample(),180);
    }
    void (async()=>{
      try {
        if(document.visibilityState==='hidden'){background();return;}
        if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
        const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}},audio:false});
        if(cancelled){next.getTracks().forEach(track=>track.stop());return;}
        ownedStream=next;if(!video.current)throw new Error('closed');
        video.current.srcObject=next;await video.current.play();
        if(!cancelled){
          const track=next.getVideoTracks()[0];if(!track)throw new Error('no-video');
          zoomControl.current=createCameraZoom(track,nextZoom=>{
            if(cancelled)return;
            zoomGeneration++;settleUntil=performance.now()+180;setZoom(nextZoom);
          });
          setZoom(zoomControl.current.getState());
          if(video.current.videoWidth&&video.current.videoHeight)setAspect(video.current.videoWidth/video.current.videoHeight);
          setState('ready');void sample();
        }
      }catch{if(!cancelled){stop();setState('error');}}
    })();
    return()=>{stop();document.removeEventListener('visibilitychange',background);window.removeEventListener('pagehide',pagehide);};
  },[]);
  const digital=zoom?.mode==='digital'?zoom.value:1;
  const factor=(value:number)=>Number(value.toFixed(2)).toString();
  return <div className="scan-camera">
    <div className="scan-camera-preview" style={{aspectRatio:aspect,maxWidth:`calc(44dvh * ${aspect})`}}>
      <video ref={video} playsInline muted autoPlay aria-label="תצוגת מצלמה" style={{transform:`scale(${digital})`}} onResize={event=>{const input=event.currentTarget;if(input.videoWidth&&input.videoHeight)setAspect(input.videoWidth/input.videoHeight);}}/>
      {guide?<div className="scan-camera-guide" aria-hidden="true" style={{left:`${guide.x*100}%`,top:`${guide.y*100}%`,width:`${guide.width*100}%`,height:`${guide.height*100}%`}}/>:null}
    </div>
    {state==='ready'&&zoom?<div className="scan-camera-zoom">
      <label className="scan-camera-zoom-label" htmlFor={zoomId}>{zoom.mode==='digital'?'זום דיגיטלי':'זום'}</label>
      <div className="scan-camera-zoom-rail" dir="ltr">
        <span className="scan-camera-zoom-bound" aria-hidden="true">{factor(zoom.min)}×</span>
        <input id={zoomId} type="range" dir="ltr" min={zoom.min} max={zoom.max} step={zoom.step} value={zoom.value} aria-valuetext={`פי ${factor(zoom.value)}${zoom.busy?' — מעדכנים זום':''}`} onChange={event=>zoomControl.current?.request(event.currentTarget.valueAsNumber)}/>
        <span className="scan-camera-zoom-bound" aria-hidden="true">{factor(zoom.max)}×</span>
      </div>
      <output htmlFor={zoomId} dir="ltr" aria-live="off">{factor(zoom.value)}×</output>
    </div>:null}
    <div className="scan-camera-caption"><span className={state==='ready'?'scan-live-dot':''} aria-hidden="true"/><p role="status">{{opening:'פותחים מצלמה…',ready:'מחפשים את הספרות… הזיהוי אוטומטי',paused:'המצלמה נעצרה ברקע. סגרו ופתחו אותה כדי להמשיך.',error:'המצלמה לא זמינה. אפשר לבחור תמונה או להמשיך ידנית.'}[state]}</p></div>
    <Button size="sm" variant="ghost" onClick={onClose}>סגירת מצלמה</Button>
  </div>;
}
