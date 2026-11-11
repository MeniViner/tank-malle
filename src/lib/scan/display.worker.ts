import { recognizeDisplay, type DisplayKind, type DisplayOptions, type ScanContext } from './engine';
self.onmessage = (event: MessageEvent<{ width: number; height: number; data: Uint8ClampedArray; kind: DisplayKind; context?: ScanContext; options?: DisplayOptions }>) => {
  try { self.postMessage(recognizeDisplay(event.data, event.data.kind, event.data.context ?? {}, event.data.options ?? {})); }
  catch { self.postMessage({ status: 'unreadable' }); }
};
