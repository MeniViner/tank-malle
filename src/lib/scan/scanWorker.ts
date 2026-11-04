import type { RecognizerState, WorkerRequest, WorkerResponse } from './display.worker';
import type { FrameAnalysis } from './pipeline';

/**
 * One recognition worker shared by the scan steps, so the recogniser loaded
 * for the pump is still loaded for the odometer. It starts on the first frame
 * (not on mount), stops 30 s after the last reader lets go, and is replaced
 * on a timeout or failure. Each request has its own id; a reader that has
 * moved on simply never receives an answer meant for an earlier frame.
 */
let worker: Worker | null = null, state: RecognizerState = 'loading', users = 0, idle: ReturnType<typeof setTimeout> | undefined, requests = 0;
const pending = new Map<number, (analysis: FrameAnalysis | null) => void>(), listeners = new Set<(state: RecognizerState) => void>();

function stop() {
  worker?.terminate(); worker = null; state = 'loading';
  for (const done of pending.values()) done(null);
  pending.clear();
}
function start() {
  const next = new Worker(new URL('./display.worker.ts', import.meta.url), { type: 'module' });
  next.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === 'state') { state = message.recognizer; for (const listener of listeners) listener(state); return; }
    const done = pending.get(message.id); pending.delete(message.id);
    done?.(message.type === 'analysis' ? message.analysis : null);
  };
  next.onerror = () => stop();
  return worker = next;
}
export function acquireScanWorker(onState: (state: RecognizerState) => void) {
  clearTimeout(idle); users++; listeners.add(onState);
  if (worker) onState(state);
  let released = false;
  return {
    analyze(image: ImageData, frame: number, kind: WorkerRequest['kind'], wait: boolean, timeoutMs: number): Promise<FrameAnalysis | null> {
      return new Promise(resolve => {
        const target = worker ?? start(), id = ++requests;
        // A frame that takes too long replaces the worker; the next frame
        // starts a fresh one (and its recogniser loads from Cache Storage).
        const timeout = setTimeout(() => { if (pending.has(id)) stop(); }, timeoutMs);
        pending.set(id, analysis => { clearTimeout(timeout); resolve(analysis); });
        target.postMessage({ type: 'frame', id, frame, kind, width: image.width, height: image.height, data: image.data.buffer, wait } satisfies WorkerRequest, [image.data.buffer]);
      });
    },
    release() {
      if (released) return; released = true; listeners.delete(onState);
      if (--users === 0) idle = setTimeout(stop, 30_000);
    },
  };
}
