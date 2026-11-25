import { describe, expect, it } from 'vitest';
import { blank, rect } from '../fixtures';
import { displayCloudCrop } from './cloudCrop';
import { luma } from './image';
import type { EngineResult } from './read';

describe('locating an illuminated odometer after a local miss', () => {
  it('keeps the angled display in the crop and leaves the unrelated surround out', () => {
    const photo = blank(440, 330, [12, 12, 12]);
    for (let i = 0; i < 8; i++) rect(photo, 90 + i * 6, 200 + i * 2, 5, 11, [0, 90, 255]);
    rect(photo, 0, 180, 22, 130, [255, 80, 0]);
    const result: EngineResult = { kind: 'odometer', odometer: [], pump: [], words: [], ms: 0, levels: [luma(photo)] };
    const crop = displayCloudCrop(photo, result);
    expect(crop).toBeDefined();
    const bright = crop!.data.filter(v => v > 55).length / crop!.data.length;
    expect(bright).toBeGreaterThan(.05);
    expect(bright).toBeLessThan(.5);
    expect(crop!.data.some(v => v > 110)).toBe(false);
  });

  it('does not create a region from a blank dashboard', () => {
    const photo = blank(260, 160, [30, 30, 30]);
    const result: EngineResult = { kind: 'odometer', odometer: [], pump: [], words: [], ms: 0, levels: [luma(photo)] };
    expect(displayCloudCrop(photo, result)).toBeUndefined();
  });
});
