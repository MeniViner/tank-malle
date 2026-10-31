import type { PixelImage } from './sevenSegment';

/**
 * Plain-JS area resampling, used identically by the app's worker and by the
 * Node benchmark, so a measured result is the result of the shipped code.
 */
export type Rect = { x: number; y: number; w: number; h: number };
export type RgbaFrame = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };

export function resample(source: RgbaFrame, rect: Rect, outWidth: number, outHeight: number): PixelImage & { data: Uint8ClampedArray } {
  const { width, data } = source, out = new Uint8ClampedArray(outWidth * outHeight * 4);
  const sx = rect.w / outWidth, sy = rect.h / outHeight;
  if (sx < 1 && sy < 1) {
    // Enlarging: bilinear, so a recrop does not add blocky stair-steps.
    for (let oy = 0; oy < outHeight; oy++) {
      const fy = Math.min(source.height - 1, Math.max(0, rect.y + (oy + .5) * sy - .5)), y0 = Math.floor(fy), y1 = Math.min(source.height - 1, y0 + 1), ty = fy - y0;
      for (let ox = 0; ox < outWidth; ox++) {
        const fx = Math.min(width - 1, Math.max(0, rect.x + (ox + .5) * sx - .5)), x0 = Math.floor(fx), x1 = Math.min(width - 1, x0 + 1), tx = fx - x0, o = (oy * outWidth + ox) * 4;
        for (let c = 0; c < 3; c++) {
          const top = data[(y0 * width + x0) * 4 + c] * (1 - tx) + data[(y0 * width + x1) * 4 + c] * tx, bottom = data[(y1 * width + x0) * 4 + c] * (1 - tx) + data[(y1 * width + x1) * 4 + c] * tx;
          out[o + c] = top * (1 - ty) + bottom * ty;
        }
        out[o + 3] = 255;
      }
    }
    return { width: outWidth, height: outHeight, data: out };
  }
  for (let oy = 0; oy < outHeight; oy++) {
    const y0 = rect.y + oy * sy, y1 = y0 + sy;
    for (let ox = 0; ox < outWidth; ox++) {
      const x0 = rect.x + ox * sx, x1 = x0 + sx;
      let r = 0, g = 0, b = 0, weight = 0;
      // Box filter over the covered source pixels.
      for (let y = Math.floor(y0); y < Math.max(Math.floor(y0) + 1, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0) || 1, yy = Math.min(source.height - 1, Math.max(0, y));
        for (let x = Math.floor(x0); x < Math.max(Math.floor(x0) + 1, Math.ceil(x1)); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0) || 1, xx = Math.min(width - 1, Math.max(0, x)), i = (yy * width + xx) * 4, w = wx * wy;
          r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; weight += w;
        }
      }
      const o = (oy * outWidth + ox) * 4;
      out[o] = r / weight; out[o + 1] = g / weight; out[o + 2] = b / weight; out[o + 3] = 255;
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}
/** The whole frame (or a region) with its longest side at most `maximum`. */
export function scaled(source: RgbaFrame, maximum: number, rect: Rect = { x: 0, y: 0, w: source.width, h: source.height }) {
  const ratio = Math.min(1, maximum / Math.max(rect.w, rect.h));
  return { image: resample(source, rect, Math.max(1, Math.round(rect.w * ratio)), Math.max(1, Math.round(rect.h * ratio))), ratio };
}
/** A region enlarged or reduced to a target scale, bounded in pixels. */
export function crop(source: RgbaFrame, rect: Rect, scale: number, maxPixels = 1_500_000) {
  const clipped = clip(rect, source);
  const bounded = Math.min(scale, Math.sqrt(maxPixels / Math.max(1, clipped.w * clipped.h)));
  return { image: resample(source, clipped, Math.max(1, Math.round(clipped.w * bounded)), Math.max(1, Math.round(clipped.h * bounded))), rect: clipped, scale: bounded };
}
export function clip(rect: Rect, frame: { width: number; height: number }): Rect {
  const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
  return { x, y, w: Math.max(1, Math.min(frame.width, Math.ceil(rect.x + rect.w)) - x), h: Math.max(1, Math.min(frame.height, Math.ceil(rect.y + rect.h)) - y) };
}
