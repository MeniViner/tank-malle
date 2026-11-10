/**
 * Scan v2 preprocessing. Pure functions over ImageData-shaped pixels: no DOM,
 * no canvas, no models, so the same code runs in the worker, in tests and in
 * the accuracy script.
 */
export type RGBAImage = { width: number; height: number; data: ArrayLike<number> };
/** One channel, 0..255. */
export type GrayImage = { width: number; height: number; data: Uint8ClampedArray };
/** 1 = ink (a lit or printed segment), 0 = background. */
export type BinaryImage = { width: number; height: number; data: Uint8Array };
export type Rect = { x: number; y: number; width: number; height: number };
export type Polarity = 'light-on-dark' | 'dark-on-light';

export function isValidImage(image: RGBAImage, maxPixels = 4_000_000): boolean {
  const { width, height, data } = image;
  return Number.isInteger(width) && Number.isInteger(height) && width >= 2 && height >= 2 &&
    width * height <= maxPixels && data.length === width * height * 4;
}

/** Integer crop clamped to the image. Returns a copy; the source is untouched. */
export function cropImage<T extends RGBAImage>(image: T, rect: Rect): { width: number; height: number; data: Uint8ClampedArray } {
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(rect.x)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(rect.y)));
  const x1 = Math.max(x0 + 1, Math.min(image.width, Math.ceil(rect.x + rect.width)));
  const y1 = Math.max(y0 + 1, Math.min(image.height, Math.ceil(rect.y + rect.height)));
  const width = x1 - x0, height = y1 - y0, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width * 4; x++) data[y * width * 4 + x] = image.data[((y0 + y) * image.width + x0) * 4 + x];
  }
  return { width, height, data };
}

/**
 * Greyscale. `luma` is the usual Rec.601 weighting. `max` takes the brightest
 * channel, which keeps red/amber lit segments bright (their luma is low).
 */
export function toGray(image: RGBAImage, method: 'luma' | 'max' = 'luma'): GrayImage {
  const out = new Uint8ClampedArray(image.width * image.height), d = image.data;
  for (let i = 0; i < out.length; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    out[i] = method === 'max' ? Math.max(r, g, b) : Math.round(.299 * r + .587 * g + .114 * b);
  }
  return { width: image.width, height: image.height, data: out };
}

/** Summed-area table, (w+1)*(h+1), for O(1) box means. */
export function integralImage(gray: GrayImage): Float64Array {
  const { width: w, height: h, data } = gray, stride = w + 1, table = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      table[(y + 1) * stride + x + 1] = table[y * stride + x + 1] + row;
    }
  }
  return table;
}

/**
 * Adaptive (local mean) threshold. A pixel is ink when it differs from the
 * mean of its (2r+1)² neighbourhood by more than `offset` in the ink direction.
 * Robust to the uneven lighting and glare gradients of a pump or dashboard.
 */
export function adaptiveThreshold(gray: GrayImage, { radius, offset = 8, contrast = 0, polarity }: { radius?: number; offset?: number; contrast?: number; polarity: Polarity }): BinaryImage {
  const { width: w, height: h, data } = gray, stride = w + 1;
  const r = Math.max(1, Math.round(radius ?? Math.max(4, Math.min(w, h) / 10)));
  const table = integralImage(gray), out = new Uint8Array(w * h);
  // Squared sums for the local standard deviation (Sauvola-style term).
  let squares: Float64Array | null = null;
  if (contrast > 0) {
    squares = new Float64Array(stride * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { const v = data[y * w + x]; row += v * v; squares[(y + 1) * stride + x + 1] = squares[y * stride + x + 1] + row; }
    }
  }
  for (let y = 0; y < h; y++) {
    const t = Math.max(0, y - r), b = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const l = Math.max(0, x - r), rr = Math.min(w, x + r + 1), n = (rr - l) * (b - t);
      const mean = (table[b * stride + rr] - table[t * stride + rr] - table[b * stride + l] + table[t * stride + l]) / n;
      let margin = offset;
      if (squares) {
        const sq = (squares[b * stride + rr] - squares[t * stride + rr] - squares[b * stride + l] + squares[t * stride + l]) / n;
        margin = Math.max(offset, contrast * Math.sqrt(Math.max(0, sq - mean * mean)));
      }
      const v = data[y * w + x];
      out[y * w + x] = polarity === 'light-on-dark' ? +(v > mean + margin) : +(v < mean - margin);
    }
  }
  return { width: w, height: h, data: out };
}

/** Bilinear sample with edge clamping. */
function sample(gray: GrayImage, x: number, y: number): number {
  const { width: w, height: h, data } = gray;
  const cx = Math.max(0, Math.min(w - 1, x)), cy = Math.max(0, Math.min(h - 1, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = cx - x0, fy = cy - y0;
  return (data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx) * (1 - fy) + (data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx) * fy;
}

/**
 * Rotation by `angle` radians (positive = clockwise in image coordinates)
 * followed by a horizontal shear `shear` (x += shear * (y - cy)). Same size
 * output; uncovered pixels take `fill`.
 */
export function warpGray(gray: GrayImage, angle: number, shear = 0, fill?: number): GrayImage {
  const { width: w, height: h } = gray, out = new Uint8ClampedArray(w * h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2, cos = Math.cos(angle), sin = Math.sin(angle);
  const background = fill ?? median(gray.data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Inverse map: undo the shear, then undo the rotation.
      const ux = x - cx - shear * (y - cy), uy = y - cy;
      const sx = cos * ux + sin * uy + cx, sy = -sin * ux + cos * uy + cy;
      out[y * w + x] = sx < -.5 || sy < -.5 || sx > w - .5 || sy > h - .5 ? background : sample(gray, sx, sy);
    }
  }
  return { width: w, height: h, data: out };
}

function median(values: ArrayLike<number>): number {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) histogram[values[i]]++;
  let seen = 0;
  for (let v = 0; v < 256; v++) { seen += histogram[v]; if (seen * 2 >= values.length) return v; }
  return 0;
}

/** Ink coordinates, subsampled to bound the cost of the angle searches. */
function inkPoints(binary: BinaryImage, limit = 6000): { xs: Float32Array; ys: Float32Array } {
  let count = 0;
  for (let i = 0; i < binary.data.length; i++) count += binary.data[i];
  const step = Math.max(1, Math.ceil(count / limit)), xs: number[] = [], ys: number[] = [];
  let k = 0;
  for (let i = 0; i < binary.data.length; i++) {
    if (!binary.data[i]) continue;
    if (k++ % step) continue;
    xs.push(i % binary.width); ys.push(Math.floor(i / binary.width));
  }
  return { xs: Float32Array.from(xs), ys: Float32Array.from(ys) };
}

/** Sum of squared bin counts: high when the projection is peaky. */
function peakiness(values: Float32Array, size: number, transform: (i: number) => number): number {
  const bins = new Float64Array(size + 2);
  for (let i = 0; i < values.length; i++) {
    const b = Math.round(transform(i));
    if (b >= 0 && b < bins.length) bins[b]++;
  }
  let sum = 0;
  for (const b of bins) sum += b * b;
  return sum;
}

/**
 * Skew angle (radians) that makes text rows horizontal: the rotation that
 * maximises the peakiness of the horizontal projection of ink. Search range
 * ±maxDegrees. Returns 0 for empty images.
 */
export function estimateSkew(binary: BinaryImage, maxDegrees = 12, stepDegrees = 1): number {
  const { xs, ys } = inkPoints(binary);
  if (xs.length < 20) return 0;
  const cx = binary.width / 2, cy = binary.height / 2;
  let best = 0, bestScore = -1;
  for (let deg = -maxDegrees; deg <= maxDegrees + 1e-9; deg += stepDegrees) {
    const a = deg * Math.PI / 180, sin = Math.sin(a), cos = Math.cos(a);
    // Row coordinate of each ink point after rotating the image by `a`.
    const score = peakiness(ys, binary.height + binary.width, i => (xs[i] - cx) * sin + (ys[i] - cy) * cos + cy + binary.width / 2);
    if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && Math.abs(deg) < Math.abs(best))) { bestScore = score; best = deg; }
  }
  return best * Math.PI / 180;
}

/**
 * Italic slant of seven-segment digits (most displays lean ~5-12°): the
 * horizontal shear that makes vertical strokes vertical, i.e. maximises the
 * peakiness of the column projection. Returned as the shear to APPLY.
 */
export function estimateShear(binary: BinaryImage, maxShear = .35, step = .025): number {
  const { xs, ys } = inkPoints(binary);
  if (xs.length < 20) return 0;
  const cy = binary.height / 2;
  let best = 0, bestScore = -1;
  for (let s = -maxShear; s <= maxShear + 1e-9; s += step) {
    const score = peakiness(xs, binary.width + binary.height, i => xs[i] + s * (ys[i] - cy) + binary.height / 2);
    if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && Math.abs(s) < Math.abs(best))) { bestScore = score; best = s; }
  }
  return Math.round(best / step) * step;
}

/** Which way round is the ink? Lit displays are usually light-on-dark. */
export function guessPolarity(gray: GrayImage): Polarity {
  // The minority of extreme pixels is the ink: compare the spread above and
  // below the median.
  const m = median(gray.data);
  let above = 0, below = 0;
  for (let i = 0; i < gray.data.length; i++) {
    const v = gray.data[i];
    if (v > m + 40) above++; else if (v < m - 40) below++;
  }
  return above >= below ? 'light-on-dark' : 'dark-on-light';
}

export type Preprocessed = { gray: GrayImage; binary: BinaryImage; polarity: Polarity; angle: number; shear: number };

/**
 * Greyscale → adaptive threshold → deskew (rotation, then italic shear) →
 * threshold again on the straightened grey image.
 */
export function preprocess(image: RGBAImage, { polarity, method = 'luma', offset = 8, contrast = 0, radius, deskew = true }: {
  polarity?: Polarity; method?: 'luma' | 'max'; offset?: number; contrast?: number; radius?: number; deskew?: boolean;
} = {}): Preprocessed {
  const gray0 = toGray(image, method);
  const p = polarity ?? guessPolarity(gray0);
  const first = adaptiveThreshold(gray0, { polarity: p, offset, contrast, radius });
  if (!deskew) return { gray: gray0, binary: first, polarity: p, angle: 0, shear: 0 };
  const angle = estimateSkew(first);
  const rotated = angle ? warpGray(gray0, angle) : gray0;
  const rotatedBinary = angle ? adaptiveThreshold(rotated, { polarity: p, offset, contrast, radius }) : first;
  const shear = estimateShear(rotatedBinary);
  const gray = shear ? warpGray(rotated, 0, shear) : rotated;
  const binary = shear ? adaptiveThreshold(gray, { polarity: p, offset, contrast, radius }) : rotatedBinary;
  return { gray, binary, polarity: p, angle, shear };
}
