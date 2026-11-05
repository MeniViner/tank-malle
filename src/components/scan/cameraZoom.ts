/** Local camera controls only: no image uploads, recognition, or models. */
export interface CameraZoomState {
  mode: 'camera' | 'digital';
  min: number;
  max: number;
  step: number;
  value: number;
  busy: boolean;
}
type ZoomTrack = Pick<MediaStreamTrack, 'getCapabilities' | 'getSettings' | 'getConstraints' | 'applyConstraints'>;
const digitalZoom = (): CameraZoomState => ({ mode: 'digital', min: 1, max: 4, step: .1, value: 1, busy: false });

function initialZoom(track: ZoomTrack): CameraZoomState {
  try {
    const range = (track.getCapabilities() as MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } }).zoom;
    const value = track.getSettings().zoom;
    if (range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.min > 0 && range.max > range.min
      && typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max) {
      const max = Math.max(value, Math.min(range.max, 8));
      const step = range.step && Number.isFinite(range.step) && range.step > 0 ? range.step : .1;
      if (max > range.min) return { mode: 'camera', min: range.min, max, step, value, busy: false };
    }
  } catch { /* Older browsers can expose methods that still throw. */ }
  return digitalZoom();
}

export function boundedZoom(value: number, state: Pick<CameraZoomState, 'min' | 'max' | 'step'>): number {
  const finite = Number.isFinite(value) ? value : state.min;
  const snapped = state.min + Math.round((finite - state.min) / state.step) * state.step;
  return Number(Math.min(state.max, Math.max(state.min, snapped)).toFixed(6));
}

/** Serializes hardware changes and coalesces a fast drag into the latest value.
 * The scanner must pause while busy; an ignored/rejected hardware constraint
 * switches to a labelled digital crop of the actual current video stream. */
export function createCameraZoom(track: ZoomTrack, changed: (state: CameraZoomState) => void) {
  let state = initialZoom(track), disposed = false, applying = false, applied = state.value;
  const publish = (next: CameraZoomState) => { state = next; if (!disposed) changed(next); };
  async function flush() {
    if (applying || disposed) return;
    applying = true;
    try {
      while (!disposed && state.mode === 'camera' && (state.busy || state.value !== applied)) {
        const target = state.value;
        // Preserve capture dimensions/facing mode and any other active constraints.
        const zoomConstraint: MediaTrackConstraintSet & { zoom: number } = { zoom: target };
        const constraints = { ...track.getConstraints() } as MediaTrackConstraints & { zoom?: ConstrainDouble };
        delete constraints.zoom;
        const advanced = (constraints.advanced ?? []).map(previous => {
          const next = { ...previous } as MediaTrackConstraintSet & { zoom?: ConstrainDouble };
          delete next.zoom;
          return next;
        }).filter(previous => Object.keys(previous).length > 0);
        await track.applyConstraints({ ...constraints, advanced: [...advanced, zoomConstraint] });
        if (disposed) return;
        const actual = track.getSettings().zoom;
        // Some browsers silently ignore advanced constraints. Never report that as zoom.
        if (typeof actual !== 'number' || !Number.isFinite(actual) || Math.abs(actual - target) > Math.max(.001, state.step / 2)) {
          throw new Error('zoom-not-applied');
        }
        applied = target;
        if (state.value === target) publish({ ...state, busy: false });
      }
    } catch {
      if (!disposed) publish(digitalZoom());
    } finally { applying = false; }
  }
  return {
    getState: () => state,
    request(value: number) {
      if (disposed) return;
      const next = boundedZoom(value, state);
      if (next === state.value) return;
      publish({ ...state, value: next, busy: state.mode === 'camera' });
      if (state.mode === 'camera') void flush();
    },
    dispose() { disposed = true; },
  };
}

/** Matches a centered CSS scale exactly, keeping the full video aspect ratio.
 * Output is downsampled only after cropping, never from an unzoomed frame. */
export function cameraFrameCrop(width: number, height: number, zoom: number, maximum: number) {
  const factor = Number.isFinite(zoom) ? Math.min(4, Math.max(1, zoom)) : 1;
  const sw = width / factor, sh = height / factor;
  const ratio = Math.min(1, maximum / Math.max(sw, sh));
  return { sx: (width - sw) / 2, sy: (height - sh) / 2, sw, sh, width: Math.max(1, Math.round(sw * ratio)), height: Math.max(1, Math.round(sh * ratio)) };
}
