import { describe, expect, it } from 'vitest';
import { blank, drawDigits, lineFixture } from '../fixtures';
import {
  adaptiveThreshold, cropImage, estimateShear, estimateSkew, guessPolarity, integralImage, isValidImage,
  preprocess, toGray, warpGray, type BinaryImage, type GrayImage,
} from './preprocess';

const gray = (width: number, height: number, fill: (x: number, y: number) => number): GrayImage => {
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = fill(x, y);
  return { width, height, data };
};
const toBinary = (g: GrayImage): BinaryImage => ({ width: g.width, height: g.height, data: Uint8Array.from(g.data, v => v > 127 ? 1 : 0) });
const ink = (b: BinaryImage) => b.data.reduce((s, v) => s + v, 0);

describe('scan v2 preprocessing', () => {
  it('validates image shape', () => {
    expect(isValidImage({ width: 2, height: 2, data: new Uint8Array(16) })).toBe(true);
    expect(isValidImage({ width: 2, height: 2, data: new Uint8Array(15) })).toBe(false);
    expect(isValidImage({ width: 1, height: 2, data: new Uint8Array(8) })).toBe(false);
    expect(isValidImage({ width: 2.5, height: 2, data: new Uint8Array(20) })).toBe(false);
  });

  it('crops exactly and clamps to the image', () => {
    const image = blank(10, 8, [10, 20, 30]);
    image.data.set([200, 201, 202, 255], (3 * 10 + 4) * 4);
    const crop = cropImage(image, { x: 4, y: 3, width: 3, height: 2 });
    expect([crop.width, crop.height]).toEqual([3, 2]);
    expect([...crop.data.slice(0, 4)]).toEqual([200, 201, 202, 255]);
    const clamped = cropImage(image, { x: 8, y: -5, width: 50, height: 50 });
    expect([clamped.width, clamped.height]).toEqual([2, 8]);
    expect(image.data[(3 * 10 + 4) * 4]).toBe(200);
  });

  it('converts to grey by luma or brightest channel', () => {
    const image = { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) };
    expect(toGray(image, 'luma').data[0]).toBe(76);
    expect(toGray(image, 'max').data[0]).toBe(255);
  });

  it('builds a summed-area table', () => {
    const t = integralImage(gray(3, 2, () => 1));
    expect(t[(2) * 4 + 3]).toBe(6);
    expect(t[(1) * 4 + 2]).toBe(2);
  });

  it('thresholds against the local mean despite a lighting gradient', () => {
    // Bright stroke on a background that ramps from 20 to 200 left to right.
    const g = gray(120, 40, (x, y) => Math.round(20 + x * 1.5) + (y >= 18 && y < 22 ? 50 : 0));
    const b = adaptiveThreshold(g, { polarity: 'light-on-dark', offset: 15, radius: 8 });
    for (const x of [5, 60, 115]) { expect(b.data[20 * 120 + x]).toBe(1); expect(b.data[5 * 120 + x]).toBe(0); }
    const dark = adaptiveThreshold(gray(40, 40, (_, y) => (y >= 18 && y < 22 ? 30 : 180)), { polarity: 'dark-on-light', offset: 15, radius: 8 });
    expect(dark.data[20 * 40 + 20]).toBe(1);
    expect(dark.data[5 * 40 + 20]).toBe(0);
  });

  it('local-contrast term suppresses noise in flat regions', () => {
    const noisy = gray(60, 60, (x, y) => 100 + ((x * 7 + y * 13) % 5) + (x >= 29 && x <= 31 ? 120 : 0));
    const plain = adaptiveThreshold(noisy, { polarity: 'light-on-dark', offset: 1, radius: 6 });
    const contrast = adaptiveThreshold(noisy, { polarity: 'light-on-dark', offset: 1, contrast: .8, radius: 6 });
    expect(ink(contrast)).toBeLessThan(ink(plain));
    expect(contrast.data[30 * 60 + 30]).toBe(1);
  });

  it('estimates and removes skew', () => {
    const g = gray(200, 120, (_, y) => (y >= 58 && y < 62 ? 255 : 0));
    const tilted = warpGray(g, 6 * Math.PI / 180, 0, 0);
    const angle = estimateSkew(toBinary(tilted));
    expect(Math.abs(angle * 180 / Math.PI + 6)).toBeLessThanOrEqual(1);
    expect(estimateSkew(toBinary(g))).toBe(0);
    expect(estimateSkew({ width: 10, height: 10, data: new Uint8Array(100) })).toBe(0);
  });

  it('estimates italic shear of vertical strokes', () => {
    const g = gray(120, 80, (x, y) => [30, 60, 90].some(c => Math.abs(x - (c + .2 * (y - 40))) < 2) ? 255 : 0);
    expect(estimateShear(toBinary(g))).toBeCloseTo(-.2, 1);
    const upright = gray(120, 80, x => [30, 60, 90].some(c => Math.abs(x - c) < 2) ? 255 : 0);
    expect(estimateShear(toBinary(upright))).toBe(0);
  });

  it('guesses polarity from the minority of extreme pixels', () => {
    expect(guessPolarity(toGray(lineFixture('128', { light: true })))).toBe('light-on-dark');
    expect(guessPolarity(toGray(lineFixture('128')))).toBe('dark-on-light');
  });

  it('straightens a rotated, slanted rendering', () => {
    const image = blank(500, 200);
    drawDigits(image, '2874', 40, 40);
    const g = toGray(image);
    const slanted = warpGray(warpGray(g, 0, .15), 4 * Math.PI / 180);
    const rgba = { width: 500, height: 200, data: new Uint8ClampedArray(500 * 200 * 4) };
    slanted.data.forEach((v, i) => rgba.data.set([v, v, v, 255], i * 4));
    const result = preprocess(rgba, { polarity: 'dark-on-light', offset: 20 });
    expect(Math.abs(result.angle * 180 / Math.PI + 4)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(result.shear + .15)).toBeLessThanOrEqual(.06);
    expect(ink(result.binary)).toBeGreaterThan(1000);
  });
});
