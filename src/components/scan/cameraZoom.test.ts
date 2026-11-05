import { describe, expect, it, vi } from 'vitest';
import { boundedZoom, cameraFrameCrop, createCameraZoom } from './cameraZoom';

type Track = Parameters<typeof createCameraZoom>[0];
function camera({ available = true, ignore = false } = {}) {
  let actual = 1;
  const applyConstraints = vi.fn(async (constraints: MediaTrackConstraints) => {
    if (!ignore) actual = (constraints.advanced!.at(-1) as MediaTrackConstraintSet & { zoom: number }).zoom;
  });
  const track: Track = {
    getCapabilities: () => available ? { zoom: { min: 1, max: 6, step: .1 } } as MediaTrackCapabilities : {},
    getSettings: () => ({ zoom: actual }),
    getConstraints: () => ({ width: { ideal: 1280 }, facingMode: { ideal: 'environment' } }),
    applyConstraints,
  };
  return { track, applyConstraints };
}
const complete = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('camera zoom', () => {
  it('uses track capabilities and preserves existing capture constraints', async () => {
    const { track, applyConstraints } = camera(), changed = vi.fn();
    const zoom = createCameraZoom(track, changed);
    expect(zoom.getState()).toMatchObject({ mode: 'camera', min: 1, max: 6, value: 1 });
    zoom.request(2.34);
    expect(zoom.getState()).toMatchObject({ value: 2.3, busy: true });
    await complete();
    expect(applyConstraints).toHaveBeenCalledWith({ width: { ideal: 1280 }, facingMode: { ideal: 'environment' }, advanced: [{ zoom: 2.3 }] });
    expect(zoom.getState()).toMatchObject({ value: 2.3, busy: false });
  });


  it('replaces previous zoom constraints so a second drag can change hardware zoom', async () => {
    const { track } = camera();
    let actual = 1;
    let constraints = { width: { ideal: 1280 }, zoom: 1, advanced: [{ zoom: 1, torch: true } as MediaTrackConstraintSet & { zoom: number; torch: boolean }] } as MediaTrackConstraints & { zoom?: number };
    track.getConstraints = () => constraints;
    track.getSettings = () => ({ zoom: actual });
    track.applyConstraints = async (next = {}) => {
      expect(next).not.toHaveProperty('zoom');
      expect(next.advanced?.[0]).toEqual({ torch: true });
      expect(next.advanced).toHaveLength(2);
      actual = (next.advanced!.at(-1) as MediaTrackConstraintSet & { zoom: number }).zoom;
      constraints = next;
    };
    const zoom = createCameraZoom(track, vi.fn());
    zoom.request(2); await complete();
    zoom.request(3); await complete();
    expect(zoom.getState()).toMatchObject({ mode: 'camera', value: 3, busy: false });
    expect(actual).toBe(3);
  });

  it('coalesces quick drags without concurrent hardware calls', async () => {
    const { track } = camera();
    let release: (() => void) | undefined, actual = 1;
    track.getSettings = () => ({ zoom: actual });
    const apply = vi.fn((constraints: MediaTrackConstraints) => new Promise<void>(resolve => {
      release = () => { actual = (constraints.advanced!.at(-1) as MediaTrackConstraintSet & { zoom: number }).zoom; resolve(); };
    }));
    track.applyConstraints = apply;
    const zoom = createCameraZoom(track, vi.fn());
    zoom.request(2); zoom.request(3); zoom.request(4);
    expect(apply).toHaveBeenCalledTimes(1);
    release!(); await complete();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1][0].advanced).toEqual([{ zoom: 4 }]);
    expect(zoom.getState().busy).toBe(true);
    release!(); await complete();
    expect(zoom.getState()).toMatchObject({ value: 4, busy: false });
  });

  it('uses digital zoom when capabilities are absent, fixed, or throw', () => {
    const { track, applyConstraints } = camera({ available: false });
    for (const getCapabilities of [() => ({}), () => ({ zoom: { min: 1, max: 1 } } as MediaTrackCapabilities), () => { throw new Error('unsupported'); }]) {
      const zoom = createCameraZoom({ ...track, getCapabilities }, vi.fn());
      zoom.request(3);
      expect(zoom.getState()).toMatchObject({ mode: 'digital', value: 3, min: 1, max: 4, busy: false });
    }
    expect(applyConstraints).not.toHaveBeenCalled();
  });

  it('falls back honestly when the browser ignores or rejects native zoom', async () => {
    for (const rejects of [false, true]) {
      const { track } = camera({ ignore: true });
      if (rejects) track.applyConstraints = async () => { throw new Error('not-allowed'); };
      const zoom = createCameraZoom(track, vi.fn());
      zoom.request(2); await complete();
      expect(zoom.getState()).toMatchObject({ mode: 'digital', value: 1, busy: false });
      zoom.request(2);
      expect(zoom.getState()).toMatchObject({ mode: 'digital', value: 2, busy: false });
    }
  });

  it('never publishes a late apply result or applies more changes after disposal', async () => {
    const { track } = camera();
    let release: (() => void) | undefined;
    track.applyConstraints = () => new Promise<void>(resolve => { release = resolve; });
    const changed = vi.fn(), zoom = createCameraZoom(track, changed);
    zoom.request(2);
    expect(changed).toHaveBeenCalledTimes(1);
    zoom.dispose(); zoom.request(3); release!(); await complete();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('clamps and quantizes out-of-range and malformed input', () => {
    const bounds = { min: 1, max: 4, step: .1 };
    expect(boundedZoom(99, bounds)).toBe(4);
    expect(boundedZoom(-2, bounds)).toBe(1);
    expect(boundedZoom(NaN, bounds)).toBe(1);
    expect(boundedZoom(2.26, bounds)).toBe(2.3);
  });
});

describe('digital camera capture matches the centered preview', () => {
  it('keeps every pixel at 1×, then center-crops before downsampling at 2×', () => {
    expect(cameraFrameCrop(1920, 1080, 1, 960)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080, width: 960, height: 540 });
    expect(cameraFrameCrop(1920, 1080, 2, 960)).toEqual({ sx: 480, sy: 270, sw: 960, sh: 540, width: 960, height: 540 });
  });

  it('matches portrait and fractional zoom without stretching or upscaling', () => {
    const crop = cameraFrameCrop(1080, 1920, 2.5, 1280);
    expect(crop).toEqual({ sx: 324, sy: 576, sw: 432, sh: 768, width: 432, height: 768 });
    expect(crop.sw / crop.sh).toBe(1080 / 1920);
    expect(cameraFrameCrop(640, 480, NaN, 960)).toEqual({ sx: 0, sy: 0, sw: 640, sh: 480, width: 640, height: 480 });
  });
});
