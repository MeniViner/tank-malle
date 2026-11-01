import type { RgbaFrame } from './frame';

/**
 * Checks on single digits of a number the recogniser read, at the place its
 * own decoding put each character (ctcDecode's `centres`). They can make a
 * reading unsure; they never change or add a digit.
 */
export type Cell = { char: string; x: number };
type Band = { left: number; right: number; top: number; height: number };

const digitsOf = (cells: Cell[]) => cells.filter(c => /\d/.test(c.char));
/** The distance between neighbouring digits, from the first and last centres. */
const pitchOf = (digits: Cell[], band: Band) => (digits.length > 1 ? (digits[digits.length - 1].x - digits[0].x) / (digits.length - 1) : 0) || band.height * .5;
const rows = (frame: RgbaFrame, band: Band) => [Math.max(0, Math.round(band.top)), Math.min(frame.height, Math.round(band.top + band.height))] as const;
const luminance = (frame: RgbaFrame, x: number, y: number) => { const i = (y * frame.width + x) * 4; return Math.round(.299 * frame.data[i] + .587 * frame.data[i + 1] + .114 * frame.data[i + 2]); };

/**
 * The weakest digit's contrast as a share of the strongest one's (1: all
 * alike). Unlit segments that still show ("888" before a lit "84.9") are read
 * as digits the display does not show; they are much fainter than the rest.
 */
export function faintest(frame: RgbaFrame, band: Band, cells: Cell[]) {
  const digits = digitsOf(cells), found = inkOf(frame, band);
  if (digits.length < 2 || !found) return 1;
  const pitch = pitchOf(digits, band), [top, bottom] = rows(frame, band);
  // Contrast: the ink side's 2% tail (thin strokes are few pixels) against
  // the cell's median, which is background.
  const contrast = digits.map(cell => {
    const values: number[] = [];
    // A little wider than the cell: a character's position is approximate.
    for (let y = top; y < bottom; y++) for (let x = Math.max(0, Math.round(cell.x - pitch * .6)); x < Math.min(frame.width, Math.round(cell.x + pitch * .6)); x++) values.push(luminance(frame, x, y));
    if (values.length < 4) return NaN;
    values.sort((a, b) => a - b);
    const at = (p: number) => values[Math.floor((values.length - 1) * p)];
    return found.lightInk ? at(.98) - at(.5) : at(.5) - at(.02);
  }).filter(c => !Number.isNaN(c));
  const strongest = Math.max(...contrast);
  return contrast.length > 1 && strongest > 0 ? Math.round(Math.min(...contrast) / strongest * 100) / 100 : 1;
}

/** Ink (the minority side of the number box's Otsu split) and the digits'
 * own rows: the run of inked rows through the middle of the box. */
function inkOf(frame: RgbaFrame, band: Band) {
  const [top, bottom] = rows(frame, band);
  const left = Math.max(0, Math.round(band.left)), right = Math.min(frame.width, Math.round(band.right));
  if (bottom - top < 8 || right - left < 8) return null;
  const histogram = new Uint32Array(256); let total = 0, sum = 0;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) { const v = luminance(frame, x, y); histogram[v]++; total++; sum += v; }
  let below = 0, belowSum = 0, best = -1, threshold = 127;
  for (let i = 0; i < 255; i++) {
    below += histogram[i]; belowSum += i * histogram[i]; if (!below || below === total) continue;
    const diff = belowSum / below - (sum - belowSum) / (total - below), variance = below * (total - below) * diff * diff;
    if (variance > best) { best = variance; threshold = i; }
  }
  let bright = 0; for (let i = threshold + 1; i < 256; i++) bright += histogram[i];
  const lightInk = bright < total / 2, ink = (x: number, y: number) => (lightInk ? luminance(frame, x, y) > threshold : luminance(frame, x, y) <= threshold);
  const rowInk = (y: number) => { let n = 0; for (let x = left; x < right; x++) n += +ink(x, y); return n / (right - left); };
  let gTop = Math.round((top + bottom) / 2), gBottom = gTop;
  while (gTop > top && rowInk(gTop - 1) >= .04) gTop--;
  while (gBottom < bottom && rowInk(gBottom) >= .04) gBottom++;
  return gBottom - gTop < 8 ? null : { ink, lightInk, left, right, gTop, gBottom };
}

/**
 * For each "1" read: how much further its ink reaches across the cell at the
 * top of the digits than through their middle, in digit pitches. A "7" drawn
 * with a short top bar is read as "1"; a "1" has no bar (a printed one only a
 * short flag). 0 when the number has no "1".
 */
export function topBar(frame: RgbaFrame, band: Band, cells: Cell[]) {
  const digits = digitsOf(cells);
  if (digits.length < 2 || !digits.some(c => c.char === '1')) return 0;
  const found = inkOf(frame, band);
  if (!found) return 0;
  const { ink, left, right, gTop, gBottom } = found, pitch = pitchOf(digits, band), glyph = gBottom - gTop;
  /** Width of the ink across the cell in rows [from, to): columns inked in at least half of them. */
  const extent = (x0: number, x1: number, from: number, to: number) => {
    let first = -1, last = -1;
    for (let x = x0; x < x1; x++) { let n = 0; for (let y = from; y < to; y++) n += +ink(x, y); if (n >= (to - from) / 2) { if (first < 0) first = x; last = x; } }
    return first < 0 ? 0 : last - first + 1;
  };
  let bar = 0;
  for (const cell of digits) if (cell.char === '1') {
    const x0 = Math.max(left, Math.round(cell.x - pitch / 2)), x1 = Math.min(right, Math.round(cell.x + pitch / 2));
    const head = extent(x0, x1, gTop, gTop + Math.max(1, Math.round(glyph * .15))), waist = extent(x0, x1, gTop + Math.round(glyph * .4), gTop + Math.round(glyph * .6));
    bar = Math.max(bar, (head - waist) / pitch);
  }
  return Math.round(bar * 100) / 100;
}

