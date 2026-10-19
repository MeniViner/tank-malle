/**
 * Experimental, model-free seven-segment reader. No OCR models or dependencies.
 * Input must be a tightly cropped, upright, single line of seven-segment digits.
 * A candidate is ALWAYS for human review, never permission to save a record.
 */
export type ReadingKind = 'total' | 'liters' | 'odometer';
export type ReadingMode = 'auto' | 'dark' | 'light' | 'blue';
export type PixelImage = { width: number; height: number; data: ArrayLike<number> };
export type ReadingResult = { status: 'candidate'; text: string; value: number; requiresConfirmation: true }
  | { status: 'unreadable'; reason: string };

const PATTERNS = new Map([
  ['1111110', '0'], ['0110000', '1'], ['1101101', '2'],
  ['1111001', '3'], ['0110011', '4'], ['1011011', '5'],
  ['1011111', '6'], ['1110000', '7'], ['1111111', '8'], ['1111011', '9'],
]);

// a b c d e f g: geometric segment positions, not learned templates.
const SAMPLES = [
  [.32, .01, .68, .07], [.80, .20, .98, .39], [.80, .61, .98, .80],
  [.32, .93, .68, .99], [.02, .61, .20, .80], [.02, .20, .20, .39],
  [.32, .47, .68, .53],
];

function otsu(gray: Uint8Array) {
  const histogram = new Uint32Array(256);
  let sum = 0;
  for (const value of gray) { histogram[value]++; sum += value; }
  let count = 0, leftSum = 0, best = -1, threshold = 127;
  for (let i = 0; i < 255; i++) {
    count += histogram[i];
    if (!count) continue;
    if (count === gray.length) break;
    leftSum += i * histogram[i];
    const diff = leftSum / count - (sum - leftSum) / (gray.length - count);
    const variance = count * (gray.length - count) * diff * diff;
    if (variance > best) { best = variance; threshold = i; }
  }
  return threshold;
}

function runs(values: Uint32Array) {
  const result = [];
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    if (i < values.length && values[i]) { if (start < 0) start = i; }
    else if (start >= 0) { result.push([start, i - 1]); start = -1; }
  }
  return result;
}

function readMask(mask: Uint8Array, width: number, height: number) {
  let top = height, bottom = -1, count = 0;
  const columns = new Uint32Array(width);
  const rows = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      columns[x]++; rows[y]++; count++;
    }
  }
  const h = bottom - top + 1;
  if (h < 18 || count < 30 || count > width * height * .65) return null;
  // Refuse large blank bands between rows; the caller must select ONE row.
  const bands = runs(rows);
  for (let i = 1; i < bands.length; i++) {
    if (bands[i][0] - bands[i - 1][1] > h * .27) return null;
  }
  const groups = runs(columns);
  if (!groups.length || groups.length > 11) return null;
  let text = '';
  for (const [left, right] of groups) {
    const w = right - left + 1;
    let minY = height, maxY = -1, area = 0;
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        if (mask[y * width + x]) { minY = Math.min(minY, y); maxY = y; area++; }
      }
    }
    const localHeight = maxY - minY + 1;
    if (localHeight < h * .23 && w < h * .24 && minY > top + h * .72 && area >= 3) {
      text += '.';
      continue;
    }
    if (localHeight < h * .75 || localHeight > h * 1.05 || w > h * .9) return null;
    if (w / h < .23) {
      // A one is a slender pair of vertical strokes, not a decimal/noise speck.
      if (w / h < .06 || area / (w * localHeight) < .55) return null;
      text += '1';
      continue;
    }
    const occupancy = ([x0, y0, x1, y1]: number[]) => {
      let filled = 0, pixels = 0;
      for (let y = top + Math.floor(y0 * h); y < top + Math.ceil(y1 * h); y++) {
        for (let x = left + Math.floor(x0 * w); x < left + Math.ceil(x1 * w); x++) {
          filled += mask[y * width + x]; pixels++;
        }
      }
      return filled / pixels;
    };
    const levels = SAMPLES.map(occupancy);
    // Unclear segments are rejected, not changed to the nearest valid digit.
    if (levels.some(value => value > .20 && value < .55)) return null;
    const digit = PATTERNS.get(levels.map(value => value >= .55 ? '1' : '0').join(''));
    if (digit === undefined) return null;
    text += digit;
  }
  return text;
}

export function validateReading(text: string, kind: ReadingKind) {
  if (!['total', 'liters', 'odometer'].includes(kind)) return null;
  const pattern = kind === 'odometer' ? /^\d{1,7}$/ : /^\d{1,6}\.\d{1,3}$/;
  // Never supply a missing decimal point from an expected fuel price.
  if (!pattern.test(text)) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || (kind === 'odometer' ? number < 0 : number <= 0)) return null;
  return { text, value: number };
}

export function recognizeLine(image: PixelImage, { kind = 'total', mode = 'auto' }: { kind?: ReadingKind; mode?: ReadingMode } = {}): ReadingResult {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 ||
      width * height > 1_500_000 || data.length !== width * height * 4) {
    return { status: 'unreadable', reason: 'invalid-image' };
  }
  const gray = new Uint8Array(width * height);
  let min = 255, max = 0;
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(.299 * data[i * 4] + .587 * data[i * 4 + 1] + .114 * data[i * 4 + 2]);
    min = Math.min(min, gray[i]); max = Math.max(max, gray[i]);
  }
  if (max - min < 24) return { status: 'unreadable', reason: 'low-contrast' };
  const center = otsu(gray);
  const thresholds = [...new Set([center, Math.min(max - 1, center + 12), Math.min(max - 1, center + 28)])];
  const candidates = new Map<string, number>();
  const modes = mode === 'auto' ? ['dark', 'light', 'blue'] : [mode];
  for (const polarity of modes) {
    for (const threshold of thresholds) {
      const mask = new Uint8Array(gray.length);
      for (let i = 0; i < gray.length; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        mask[i] = polarity === 'blue'
          ? +(b > 65 && b - r > 25 && b >= g * .85 && gray[i] > threshold)
          : polarity === 'dark' ? +(gray[i] <= threshold) : +(gray[i] > threshold);
      }
      const text = readMask(mask, width, height);
      const valid = text === null ? null : validateReading(text, kind);
      if (valid) candidates.set(valid.text, (candidates.get(valid.text) ?? 0) + 1);
    }
  }
  if (candidates.size > 1) return { status: 'unreadable', reason: 'ambiguous' };
  if (!candidates.size) return { status: 'unreadable', reason: 'unsupported-or-unclear' };
  const [text, agreements] = [...candidates][0];
  if (agreements < 2) return { status: 'unreadable', reason: 'unstable' };
  return { status: 'candidate', text, value: Number(text), requiresConfirmation: true };
}
