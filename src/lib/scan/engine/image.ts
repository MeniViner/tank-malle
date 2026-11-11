/**
 * Pixel primitives for the scan engine. Deterministic code only: no trained
 * weights, no network. Everything works on 8-bit grey images.
 */
export type RGBA = { width: number; height: number; data: ArrayLike<number> };
export type Gray = { width: number; height: number; data: Uint8Array };
export type Polarity = 'light' | 'dark';

/** Luma. White-on-blue, amber-on-black and black-on-grey displays all keep contrast in it. */
export function luma(image: RGBA): Gray {
  const { width, height, data } = image, out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  return { width, height, data: out };
}

/** 2×2 box downscale. */
export function half(g: Gray): Gray {
  const width = g.width >> 1, height = g.height >> 1, out = new Uint8Array(width * height), s = g.data, w = g.width;
  for (let y = 0; y < height; y++) {
    const r = 2 * y * w;
    for (let x = 0; x < width; x++) { const p = r + 2 * x; out[y * width + x] = (s[p] + s[p + 1] + s[p + w] + s[p + w + 1] + 2) >> 2; }
  }
  return { width, height, data: out };
}

export function pyramid(g: Gray, minSide = 24, maxLevels = 7): Gray[] {
  const levels = [g];
  while (levels.length < maxLevels && Math.min(levels.at(-1)!.width, levels.at(-1)!.height) >= 2 * minSide) levels.push(half(levels.at(-1)!));
  return levels;
}

/** Summed-area table, (w+1)×(h+1), modulo 2³² (differences stay exact below 16.8 MP). */
export function integral(g: Gray): Uint32Array {
  const { width: w, height: h, data } = g, stride = w + 1, t = new Uint32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += data[y * w + x]; t[(y + 1) * stride + x + 1] = t[y * stride + x + 1] + row; }
  }
  return t;
}

/** Ink mask: pixel differs from its local mean by more than `offset` in the ink direction. */
export function localInk(g: Gray, radius: number, offset: number, polarity: Polarity, table = integral(g)): Uint8Array {
  const { width: w, height: h, data } = g, stride = w + 1, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const t = Math.max(0, y - radius), b = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const l = Math.max(0, x - radius), r = Math.min(w, x + radius + 1);
      const mean = ((table[b * stride + r] - table[t * stride + r] - table[b * stride + l] + table[t * stride + l]) >>> 0) / ((r - l) * (b - t));
      const v = data[y * w + x];
      out[y * w + x] = polarity === 'light' ? +(v > mean + offset) : +(v < mean - offset);
    }
  }
  return out;
}

export type Blob = {
  x0: number; y0: number; x1: number; y1: number; area: number; cx: number; cy: number;
  /** Full extent along the principal axis and across it, and the axis angle (radians, 0 = +x). */
  major: number; minor: number; angle: number;
};

/** 8-connected components with second moments. Blobs outside [minArea, maxArea] are dropped. */
export function blobs(mask: Uint8Array, w: number, h: number, minArea: number, maxArea: number): Blob[] {
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h), out: Blob[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let top = 0, n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, x0 = w, x1 = -1, y0 = h, y1 = -1;
    stack[top++] = i; seen[i] = 1;
    while (top) {
      const p = stack[--top], x = p % w, y = (p - x) / w;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (mask[q] && !seen[q]) { seen[q] = 1; stack[top++] = q; }
        }
      }
    }
    if (n < minArea || n > maxArea) continue;
    const cx = sx / n, cy = sy / n, vxx = sxx / n - cx * cx + 1 / 12, vyy = syy / n - cy * cy + 1 / 12, vxy = sxy / n - cx * cy;
    const tr = vxx + vyy, det = Math.sqrt(Math.max(0, (vxx - vyy) * (vxx - vyy) / 4 + vxy * vxy));
    const l1 = tr / 2 + det, l2 = Math.max(1 / 12, tr / 2 - det);
    out.push({ x0, y0, x1, y1, area: n, cx, cy, major: Math.sqrt(12 * l1), minor: Math.sqrt(12 * l2), angle: .5 * Math.atan2(2 * vxy, vxx - vyy) });
  }
  return out;
}

/** Bilinear sample, clamped at the edges. */
export function sample(g: Gray, x: number, y: number): number {
  const { width: w, height: h, data } = g;
  const cx = x < 0 ? 0 : x > w - 1 ? w - 1 : x, cy = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const xa = cx | 0, ya = cy | 0, xb = xa + 1 < w ? xa + 1 : xa, yb = ya + 1 < h ? ya + 1 : ya, fx = cx - xa, fy = cy - ya;
  return (data[ya * w + xa] * (1 - fx) + data[ya * w + xb] * fx) * (1 - fy) + (data[yb * w + xa] * (1 - fx) + data[yb * w + xb] * fx) * fy;
}
