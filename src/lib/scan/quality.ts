import type { PixelImage } from './sevenSegment';

/**
 * Cheap per-frame measurements on a downscaled copy. They order frames and
 * produce hints; they never change a recognised digit. Only frames that are
 * unusable by any measure (black, blown out, or smeared) are skipped.
 */
export type FrameQuality = { mean: number; clipped: number; dark: number; sharpness: number; usable: boolean; hint: QualityHint | null };
export type QualityHint = 'too-dark' | 'glare' | 'blurred';

export function assessQuality(image: PixelImage, maximum = 320): FrameQuality {
  const { width, height, data } = image, step = Math.max(1, Math.ceil(Math.max(width, height) / maximum));
  const w = Math.floor(width / step), h = Math.floor(height / step), gray = new Float32Array(w * h);
  let sum = 0, clipped = 0, dark = 0, lit = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * step * width + x * step) * 4, value = .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
    gray[y * w + x] = value; sum += value; if (value >= 250) clipped++; if (value <= 12) dark++;
    if (Math.max(data[i], data[i + 1], data[i + 2]) >= 90) lit++;
  }
  const n = Math.max(1, w * h);
  // Mean absolute Laplacian over the central region where a display is aimed.
  let edge = 0, count = 0;
  for (let y = Math.floor(h * .15); y < Math.ceil(h * .85) - 1; y++) for (let x = Math.max(1, Math.floor(w * .1)); x < Math.ceil(w * .9) - 1; x++) {
    const i = y * w + x;
    edge += Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]); count++;
  }
  const mean = sum / n, sharpness = count ? edge / count : 0;
  // A backlit display at night is a small bright patch in a black frame: the
  // frame is only too dark when nothing in it is lit.
  const hint: QualityHint | null = mean < 14 && lit / n < .003 ? 'too-dark' : clipped / n > .45 ? 'glare' : sharpness < .6 ? 'blurred' : null;
  return { mean, clipped: clipped / n, dark: dark / n, sharpness, usable: hint === null, hint };
}
