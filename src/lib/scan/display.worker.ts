import type { DisplayKind } from './automaticDisplay';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { SCAN_DETECTION, SCAN_MODEL_CACHE, SCAN_MODEL_FILES, SCAN_RUNTIME, scanModelPath, type ScanModelFile } from './models';
import { analyzeFrame, type TextReader } from './pipeline';

/**
 * Frames arrive as pixels and leave as recognition attempts; nothing else
 * leaves the device. The local text recogniser loads on the first frame. If it
 * cannot (offline before its first download, no WebAssembly SIMD, a failed
 * integrity check) the segment reader keeps working alone and says so.
 * `wait`: a still photo waits for the recogniser; live frames never do.
 */
export type WorkerRequest = { type: 'frame'; id: number; frame: number; kind: DisplayKind; width: number; height: number; data: ArrayBuffer; wait: boolean };
export type RecognizerState = 'loading' | 'ready' | 'unavailable';
export type WorkerResponse =
  | { type: 'state'; recognizer: RecognizerState }
  | { type: 'analysis'; id: number; recognizer: RecognizerState; analysis: Awaited<ReturnType<typeof analyzeFrame>> }
  | { type: 'error'; id: number };

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
async function verifiedBytes(file: ScanModelFile & { url: string }) {
  const { url } = file, store = 'caches' in self ? await caches.open(SCAN_MODEL_CACHE) : null;
  let response = await store?.match(url);
  const fromCache = !!response;
  response ??= await fetch(url);
  if (!response.ok) throw new Error(`${file.name}: ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== file.sha256) {
    if (fromCache) await store?.delete(url);
    throw new Error(`${file.name}: integrity`);
  }
  // Store exactly the verified bytes (WebKit does not store a tee'd stream).
  if (!fromCache) await store?.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => undefined);
  return new Uint8Array(bytes);
}
async function loadReader(): Promise<TextReader> {
  if ('caches' in self) for (const key of await caches.keys()) if (key.startsWith('tank-maleh-scan-') && key !== SCAN_MODEL_CACHE) await caches.delete(key);
  const [wasm, det, rec, verify] = await Promise.all([{ ...SCAN_RUNTIME, url: ortWasm }, ...SCAN_MODEL_FILES.map(file => ({ ...file, url: scanModelPath(file.name) }))].map(verifiedBytes));
  const [ort, { createPpocrReader }, english, tiny] = await Promise.all([
    import('onnxruntime-web/wasm'), import('./ppocr'), import('./dictionaries/en-ppocr-v5'), import('./dictionaries/ppocr-v6-tiny'),
  ]);
  // One thread: the app is not cross-origin isolated (Firebase sign-in
  // popups need that), and a single thread needs no SharedArrayBuffer.
  ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; ort.env.wasm.wasmBinary = wasm;
  const session = (bytes: Uint8Array) => ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return createPpocrReader(
    { name: 'ppocr', det: await session(det), rec: await session(rec), dictionary: english.default, db: SCAN_DETECTION, verifier: { rec: await session(verify), dictionary: tiny.default } },
    { tensor: (data, dims) => new ort.Tensor('float32', data, dims) },
  );
}

let reader: TextReader | null = null, state: RecognizerState = 'loading';
const settle = (next: RecognizerState) => { state = next; self.postMessage({ type: 'state', recognizer: next } satisfies WorkerResponse); };
self.postMessage({ type: 'state', recognizer: state } satisfies WorkerResponse);
const ready = loadReader().then(loaded => { reader = loaded; settle('ready'); }, () => settle('unavailable'));

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, frame, kind, width, height, data, wait } = event.data;
  try {
    if (wait && state === 'loading') await ready;
    const analysis = await analyzeFrame({ width, height, data: new Uint8ClampedArray(data) }, kind, frame, { textReader: reader });
    self.postMessage({ type: 'analysis', id, recognizer: state, analysis } satisfies WorkerResponse);
  } catch {
    self.postMessage({ type: 'error', id } satisfies WorkerResponse);
  }
};
