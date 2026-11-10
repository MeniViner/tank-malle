import type { ScanContext } from './constraints';
import type { ScanKind } from './guide';
import type { Rect } from './preprocess';
import { scanV2, type ScanV2Result } from './pipeline';

export type ScanV2WorkerRequest = { width: number; height: number; data: Uint8ClampedArray; kind: ScanKind; crop?: Rect; context: ScanContext };

self.onmessage = (event: MessageEvent<ScanV2WorkerRequest>) => {
  const { kind, crop, context } = event.data;
  let result: ScanV2Result;
  try { result = scanV2(event.data, kind, context, { crop }); }
  catch { result = { kind, status: 'nothing-found', crop: null, fields: {}, meta: { polarity: null, angle: 0, shear: 0, lines: 0 } }; }
  self.postMessage(result, result.crop ? { transfer: [result.crop.data.buffer] } : undefined);
};
