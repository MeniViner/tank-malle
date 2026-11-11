import { recognizeDisplay, type DisplayKind, type ScanContext } from './engine';
self.onmessage = (event: MessageEvent<{ width: number; height: number; data: Uint8ClampedArray; kind: DisplayKind; context?: ScanContext }>) => {
  try { self.postMessage(recognizeDisplay(event.data, event.data.kind, event.data.context ?? {})); }
  catch { self.postMessage({ status: 'unreadable' }); }
};
