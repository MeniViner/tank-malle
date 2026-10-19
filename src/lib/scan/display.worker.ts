import { recognizeDisplay, type DisplayKind } from './automaticDisplay';
self.onmessage = (event: MessageEvent<{width:number;height:number;data:Uint8ClampedArray;kind:DisplayKind}>) => {
  try { self.postMessage(recognizeDisplay(event.data,event.data.kind)); }
  catch { self.postMessage({status:'unreadable'}); }
};
