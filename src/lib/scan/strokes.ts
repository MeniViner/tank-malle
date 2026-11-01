import type { RgbaFrame } from './frame';
import type { NumericLine } from './identity';

/**
 * A seven-segment "1" is two short vertical bars with a wide gap before the
 * next digit. Text detectors often leave it outside the number's box, and
 * two recognisers then agree on a number missing its first (or last) digit.
 * This looks for a digit-height stroke of the number's own ink just beyond
 * either end. Finding one makes the reading unsure; it never adds a digit.
 * (A "1" merged into its neighbour by display bloom is not detectable this
 * way; see the documented failure cases.)
 */
export function strayStroke(frame: RgbaFrame, line: NumericLine) {
  const { width, height, data } = frame;
  const top = Math.max(0, Math.round(line.top)), bottom = Math.min(height, Math.round(line.top + line.height));
  const left = Math.max(0, Math.round(line.left)), right = Math.min(width, Math.round(line.right));
  if (bottom - top < 6 || right - left < 6) return false;
  // Rounded, so the ink test uses exactly the levels the histogram split.
  const luminance = (x: number, y: number) => { const i = (y * width + x) * 4; return Math.round(.299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2]); };
  // Ink is the minority side of the number box's Otsu split.
  const histogram = new Uint32Array(256); let total = 0;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) { histogram[luminance(x, y)]++; total++; }
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let below = 0, belowSum = 0, best = -1, threshold = 127;
  for (let i = 0; i < 255; i++) {
    below += histogram[i]; belowSum += i * histogram[i]; if (!below || below === total) continue;
    const diff = belowSum / below - (sum - belowSum) / (total - below), variance = below * (total - below) * diff * diff;
    if (variance > best) { best = variance; threshold = i; }
  }
  let bright = 0; for (let i = threshold + 1; i < 256; i++) bright += histogram[i];
  const lightInk = bright < total / 2, ink = (x: number, y: number) => lightInk ? luminance(x, y) > threshold : luminance(x, y) <= threshold;
  // The digit band: the run of inked rows through the box's middle (the box
  // itself carries detector margin, more so for small text).
  const rowInk = (y: number) => { let n = 0; for (let x = left; x < right; x++) n += +ink(x, y); return n / (right - left); };
  const middle = Math.round((top + bottom) / 2);
  let gTop = middle, gBottom = middle;
  while (gTop > top && rowInk(gTop - 1) >= .04) gTop--;
  while (gBottom < bottom && rowInk(gBottom) >= .04) gBottom++;
  const glyph = gBottom - gTop;
  if (glyph < 5) return false;
  const columnInk = (x: number, from: number, to: number) => { const a = Math.max(0, Math.round(from)), b = Math.min(height, Math.round(to)); let n = 0; for (let y = a; y < b; y++) n += +ink(x, y); return b > a ? n / (b - a) : 0; };
  const isStroke = (x: number) => columnInk(x, gTop + glyph * .08, gBottom - glyph * .08) >= .75
    // A stroke spans the digits' height but not well beyond it, which rules
    // out the display's frame edge.
    && columnInk(x, gTop - glyph * .45, gTop - glyph * .15) < .3 && columnInk(x, gBottom + glyph * .15, gBottom + glyph * .45) < .3;
  const search = (from: number, to: number) => {
    let run = 0;
    for (let x = Math.max(0, from); x <= Math.min(width, to); x++) {
      if (x < Math.min(width, to) && isStroke(x)) { run++; continue; }
      if (run >= 1 && run <= glyph * .3) return true;
      run = 0;
    }
    return false;
  };
  // A side where a label was read in the same box holds that label's letters,
  // and the recogniser saw past the number there.
  const reach = Math.round(glyph * 1.4);
  return (!line.beside?.left && search(left - reach, left - 1)) || (!line.beside?.right && search(right + 1, right + reach));
}
