/**
 * Reads one upright strip (see `rectify`) as a row of seven-segment digits.
 * The "model" is the seven-segment alphabet itself: each digit cell is sampled
 * at its seven stroke positions and matched against the ten legal patterns.
 */
import { blobs, localInk, type Gray, type Polarity } from './image';

// a b c d e f g
const PATTERNS: [string, string][] = [
  ['0', '1111110'], ['1', '0110000'], ['2', '1101101'], ['3', '1111001'], ['4', '0110011'],
  ['5', '1011011'], ['6', '1011111'], ['7', '1110000'], ['8', '1111111'], ['9', '1111011'],
  // Common variants: 6 and 9 without the tail, 7 with a left stroke.
  ['6', '0011111'], ['9', '1110011'], ['7', '1110010'],
];
/** Sampling windows inside a cell [x0, y0, x1, y1]; the middle of each stroke only. */
const WINDOWS: { r: [number, number, number, number]; horizontal: boolean }[] = [
  // Vertical strokes are sampled between the bars (rows), bars between the uprights (columns),
  // so a thick neighbouring stroke cannot leak into the window.
  { r: [.32, 0, .68, .18], horizontal: true }, { r: [.62, .24, 1, .38], horizontal: false }, { r: [.62, .62, 1, .76], horizontal: false },
  { r: [.32, .82, .68, 1], horizontal: true }, { r: [0, .62, .38, .76], horizontal: false }, { r: [0, .24, .38, .38], horizontal: false },
  { r: [.32, .41, .68, .59], horizontal: true },
];

export type Cell = { x0: number; x1: number; options: { digit: string; p: number }[]; fit: number; segments: number[] };
export type StripRead = {
  cells: Cell[];
  /** Decimal points: index of the cell each one follows. */
  dots: number[];
  top: number; bottom: number; shear: number;
  /** Rise per pixel of the row inside the strip that was levelled out. */
  slope: number;
  /** The cleaned, straightened ink mask the cells were sampled from (for diagnosis). */
  mask?: Uint8Array;
};

/**
 * Ink mask of the strip: each pixel against the mean of a window about as tall
 * as the strip, so a brightness gradient across the display does not matter.
 * The margin scales with the strip's own contrast.
 */
export function binarise(strip: Gray, polarity: Polarity): Uint8Array {
  const { height: h, data } = strip, hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  let seen = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen >= data.length * .03) { lo = v; break; } }
  seen = 0; for (let v = 255; v >= 0; v--) { seen += hist[v]; if (seen >= data.length * .03) { hi = v; break; } }
  return localInk(strip, Math.round(h * .45), Math.max(5, (hi - lo) * .1), polarity);
}

function shearMask(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  if (!k) return mask;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const dx = Math.round(k * (y - h / 2));
    for (let x = 0; x < w; x++) { const sx = x - dx; if (sx >= 0 && sx < w && mask[y * w + sx]) out[y * w + x] = 1; }
  }
  return out;
}

function coverage(mask: Uint8Array, w: number, h: number, x0: number, x1: number, y0: number, y1: number, horizontal: boolean): number {
  const xa = Math.max(0, Math.floor(x0)), xb = Math.min(w, Math.ceil(x1)), ya = Math.max(0, Math.floor(y0)), yb = Math.min(h, Math.ceil(y1));
  if (xb <= xa || yb <= ya) return 0;
  let hit = 0;
  if (horizontal) { for (let x = xa; x < xb; x++) for (let y = ya; y < yb; y++) if (mask[y * w + x]) { hit++; break; } return hit / (xb - xa); }
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) if (mask[y * w + x]) { hit++; break; }
  return hit / (yb - ya);
}

/** Generous zone of each stroke a..g inside a cell [x0, y0, x1, y1]: where its ink may lie. */
const ZONES: [number, number, number, number][] = [[.05, 0, .95, .24], [.6, 0, 1, .56], [.6, .44, 1, 1], [.05, .76, .95, 1], [0, .44, .4, 1], [0, 0, .4, .56], [.05, .38, .95, .62]];

/** Share of a cell's ink that lies on the strokes of `pattern`. Letters and symbols put ink elsewhere. */
function explained(mask: Uint8Array, w: number, h: number, x0: number, cw: number, top: number, bandH: number, pattern: string): number {
  let ink = 0, on = 0;
  const xa = Math.max(0, Math.round(x0)), xb = Math.min(w, Math.round(x0 + cw)), ya = Math.max(0, top), yb = Math.min(h, top + bandH);
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
    if (!mask[y * w + x]) continue; ink++;
    const u = (x + .5 - x0) / cw, v = (y + .5 - top) / bandH;
    for (let k = 0; k < 7; k++) if (pattern[k] === '1' && u >= ZONES[k][0] && u <= ZONES[k][2] && v >= ZONES[k][1] && v <= ZONES[k][3]) { on++; break; }
  }
  return ink ? on / ink : 0;
}
const PATTERN_OF = (digit: string, segments: number[]) => {
  let best = '', score = -1;
  for (const [d, pattern] of PATTERNS) { if (d !== digit) continue; let sc = 0; for (let k = 0; k < 7; k++) sc += pattern[k] === '1' ? segments[k] : 1 - segments[k]; if (sc > score) { score = sc; best = pattern; } }
  return best;
};

/** The middles of the two loops are never lit on a seven-segment digit. */
const HOLES: [number, number, number, number][] = [[.36, .23, .64, .37], [.36, .63, .64, .77]];

function density(mask: Uint8Array, w: number, h: number, x0: number, x1: number, y0: number, y1: number): number {
  const xa = Math.max(0, Math.floor(x0)), xb = Math.min(w, Math.ceil(x1)), ya = Math.max(0, Math.floor(y0)), yb = Math.min(h, Math.ceil(y1));
  if (xb <= xa || yb <= ya) return 0;
  let hit = 0; for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) hit += mask[y * w + x];
  return hit / ((xb - xa) * (yb - ya));
}

export function matchSegments(segments: number[], holes: number[] = [0, 0]): { options: { digit: string; p: number }[]; fit: number } {
  const on = segments.map(c => Math.min(.98, Math.max(.02, 1 / (1 + Math.exp(-9 * (c - .45))))));
  const holePenalty = holes.reduce((s, c) => s + Math.log(Math.min(.98, Math.max(.02, 1 - 1 / (1 + Math.exp(-12 * (c - .3)))))), 0);
  const best = new Map<string, number>();
  for (const [digit, pattern] of PATTERNS) {
    let l = 0; for (let s = 0; s < 7; s++) l += Math.log(pattern[s] === '1' ? on[s] : 1 - on[s]);
    if (!best.has(digit) || l > best.get(digit)!) best.set(digit, l);
  }
  const entries = [...best].sort((a, b) => b[1] - a[1]), max = entries[0][1];
  const weights = entries.map(([, l]) => Math.exp((l - max) / 1.6)), total = weights.reduce((s, x) => s + x, 0);
  return { options: entries.slice(0, 3).map(([digit], i) => ({ digit, p: weights[i] / total })), fit: Math.exp((max + holePenalty) / 9) };
}

function blobsWithPixels(mask: Uint8Array, w: number, h: number): { y0: number; y1: number; pixels: number[] }[] {
  const seen = new Uint8Array(w * h), out: { y0: number; y1: number; pixels: number[] }[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    const pixels = [i]; seen[i] = 1; let y0 = h, y1 = -1;
    for (let k = 0; k < pixels.length; k++) {
      const p = pixels[k], x = p % w, y = (p - x) / w; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx; if (mask[q] && !seen[q]) { seen[q] = 1; pixels.push(q); }
      }
    }
    out.push({ y0, y1, pixels });
  }
  return out;
}

/** Share of the strip's height the digits are expected to fill (see `rectify`). */
export const DIGIT_SHARE = 1 / 1.7;

export function readStrip(strip: Gray, polarity: Polarity): StripRead | null {
  const { width: w, height: h } = strip, raw0 = binarise(strip, polarity), prior = h * DIGIT_SHARE;
  const median = (v: number[]) => v.sort((p, q) => p - q)[v.length >> 1];
  // Digit marks: blobs about as tall as the row that proposed this strip, not cut by the strip's edge.
  const marksAt = (mask: Uint8Array, join: number) => {
    let source = mask;
    if (join) { source = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) for (let d = -join; d <= join; d++) { const yy = y + d; if (yy >= 0 && yy < h) source[yy * w + x] = 1; } }
    return blobs(source, w, h, 6, w * h).filter(m => m.y0 > 0 && m.y1 < h - 1).map(m => ({ ...m, y0: m.y0 + join, y1: m.y1 - join }))
      .filter(m => m.y1 - m.y0 + 1 >= prior * .65 && m.y1 - m.y0 + 1 <= prior * 1.4 && m.x1 - m.x0 + 1 < prior * 4);
  };
  // Whole digits where the strokes touch; where the display leaves gaps between segments, join them vertically first
  // (joining always would also glue a label above the number onto the digits below it).
  const digitMarks = (mask: Uint8Array) => { const plain = marksAt(mask, 0); if (plain.length >= 3) return plain; const joined = marksAt(mask, 2); return joined.length > plain.length ? joined : plain; };
  // Leftover tilt: the line through the marks' feet (median of pairwise slopes, so a stray glyph cannot pull it).
  let raw = raw0, marks = digitMarks(raw0);
  if (!marks.length) return null;
  const slopes: number[] = [];
  for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) {
    const dx = (marks[j].x0 + marks[j].x1) / 2 - (marks[i].x0 + marks[i].x1) / 2;
    if (Math.abs(dx) > prior * .8) slopes.push((marks[j].y1 - marks[i].y1) / dx);
  }
  const slope = slopes.length ? median(slopes) : 0;
  if (Math.abs(slope) >= .015 && Math.abs(slope) < .3) {
    const xm = (w - 1) / 2; raw = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) { const dy = Math.round(slope * (x - xm)); for (let y = 0; y < h; y++) { const sy = y + dy; if (sy >= 0 && sy < h && raw0[sy * w + x]) raw[y * w + x] = 1; } }
    marks = digitMarks(raw); if (!marks.length) return null;
  }
  // Keep the marks that share the commonest foot line (the row), nearest the middle.
  const feet = marks.map(m => m.y1), foot = feet.slice().sort((p, q) => Math.abs(p - (h / 2 + prior / 2)) - Math.abs(q - (h / 2 + prior / 2)))
    .map(f => ({ f, n: feet.filter(v => Math.abs(v - f) <= prior * .12).length })).sort((p, q) => q.n - p.n)[0].f;
  marks = marks.filter(m => Math.abs(m.y1 - foot) <= prior * .12);
  if ((globalThis as { SCAN_DEBUG?: boolean }).SCAN_DEBUG) console.log('marks', prior.toFixed(1), slope.toFixed(3), foot, marks.map(m => `${m.x0}-${m.x1}:${m.y0}-${m.y1}`).join(' '));
  const top = Math.max(0, median(marks.map(m => m.y0))), bottom = Math.min(h - 1, median(marks.map(m => m.y1))), bandH = bottom - top + 1;
  if (bandH < h * .25) return null;
  // Marks that mostly lie outside the band (a label above the number, a unit below it) are not digits.
  const kept = new Uint8Array(raw);
  for (const m of blobsWithPixels(raw, w, h)) {
    const mh = m.y1 - m.y0 + 1, inside = Math.min(m.y1, bottom) - Math.max(m.y0, top) + 1, centre = (m.y0 + m.y1) / 2;
    const point = mh < bandH * .3 && m.y0 > top + bandH * .6 && m.y1 <= bottom + bandH * .15;
    if (!point && (inside < mh * .6 || centre < top || centre > bottom)) for (const p of m.pixels) kept[p] = 0;
  }
  // Italic slant: the shear that makes the band's column profile sharpest.
  let shear = 0, bestSharp = -1;
  for (let k = -.3; k <= .3001; k += .05) {
    const m = shearMask(kept, w, h, k); let sharp = 0;
    for (let x = 0; x < w; x++) { let c = 0; for (let y = top; y <= bottom; y++) c += m[y * w + x]; sharp += c * c; }
    if (sharp > bestSharp * 1.02) { bestSharp = sharp; shear = k; }
  }
  const mask = shearMask(kept, w, h, shear);
  // Column runs inside the band.
  type Run = { x0: number; x1: number; y0: number; y1: number };
  const runs: Run[] = [], column = new Uint16Array(w); let current: Run | null = null;
  for (let x = 0; x <= w; x++) {
    let y0 = -1, y1 = -1, ink = 0;
    if (x < w) { for (let y = top; y <= bottom; y++) if (mask[y * w + x]) { if (y0 < 0) y0 = y; y1 = y; ink++; } column[x] = ink; }
    if (ink) { if (current) { current.x1 = x; current.y0 = Math.min(current.y0, y0); current.y1 = Math.max(current.y1, y1); } else current = { x0: x, x1: x, y0, y1 }; }
    else if (current) { runs.push(current); current = null; }
  }
  const tall = runs.filter(r => r.y1 - r.y0 + 1 >= bandH * .7);
  if (!tall.length) return null;
  const wide = tall.map(r => r.x1 - r.x0 + 1).filter(x => x >= bandH * .33 && x <= bandH * .85).sort((a, b) => a - b);
  const digitW = wide.length ? wide[wide.length >> 1] : bandH * .52;
  // Anchors: right edges of runs that are one digit (or a lone "1"). Segment displays keep one pitch.
  const anchors = tall.filter(r => r.x1 - r.x0 + 1 <= digitW * 1.25).map(r => r.x1 + 1);
  if (!anchors.length) return null;
  const steps: number[] = [];
  for (let i = 1; i < anchors.length; i++) { const d = anchors[i] - anchors[i - 1]; if (d >= digitW * .95 && d <= digitW * 1.55) steps.push(d); }
  const pitch = steps.length ? median(steps) : digitW * 1.18;
  // Ink right edges (ink → gap) to snap the grid to as it is tracked along the row.
  const edges: number[] = []; for (let x = 0; x < w; x++) if (column[x] && (x + 1 >= w || !column[x + 1])) edges.push(x + 1);
  const snap = (x: number) => { let best = x, d = pitch * .16; for (const e of edges) if (Math.abs(e - x) < d) { d = Math.abs(e - x); best = e; } return best; };
  const rights: number[] = [anchors[anchors.length >> 1]];
  for (let x = snap(rights[0] + pitch); x <= w + digitW * .3 && rights.length < 40; x = snap(x + pitch)) rights.push(x);
  for (let x = snap(rights[0] - pitch); x - digitW >= -digitW * .3 && rights.length < 40; x = snap(x - pitch)) rights.unshift(x);
  // Ink in a column range just above / below the band: a frame or a rule runs past the digits.
  const beyond = (x0: number, x1: number, above: boolean) => {
    const ya = above ? Math.round(top - bandH * .3) : Math.round(bottom + bandH * .12), yb = above ? Math.round(top - bandH * .12) : Math.round(bottom + bandH * .3);
    let hit = 0, n = 0;
    for (let x = Math.max(0, Math.round(x0)); x <= Math.min(w - 1, Math.round(x1)); x++) { n++; for (let y = Math.max(0, ya); y <= Math.min(h - 1, yb); y++) if (raw[y * w + x]) { hit++; break; } }
    return n > 0 && hit / n > .5;
  };
  const cells: Cell[] = rights.map(x1 => {
    const x0 = x1 - digitW;
    let ink = 0, inkL = 0, inkR = 0, n = 0;
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(w, Math.round(x1)); x++) { n++; ink += column[x]; if (x < x0 + digitW * .5) inkL += column[x]; else inkR += column[x]; }
    if (!n || ink < bandH * 1.2) return { x0, x1, segments: [0, 0, 0, 0, 0, 0, 0], options: [{ digit: ' ', p: 1 }], fit: 0 };
    const segments = WINDOWS.map(win => coverage(mask, w, h, x0 + win.r[0] * digitW, x0 + win.r[2] * digitW, top + win.r[1] * bandH, top + win.r[3] * bandH, win.horizontal));
    const holes = HOLES.map(r => density(mask, w, h, x0 + r[0] * digitW, x0 + r[2] * digitW, top + r[1] * bandH, top + r[3] * bandH));
    const cell = { x0, x1, segments, ...matchSegments(segments, holes) };
    const share = explained(mask, w, h, x0, digitW, top, bandH, PATTERN_OF(cell.options[0].digit, segments));
    cell.fit *= share >= .92 ? 1 : Math.max(.2, 1 - (.92 - share) * 3);
    // A lone upright stroke at the right of its cell is a "1" unless it runs past the band both ways.
    if (cell.options[0].digit === '1' && inkL < inkR * .15 && beyond(x1 - digitW * .35, x1, true) && beyond(x1 - digitW * .35, x1, false)) cell.fit = 0;
    return cell;
  });
  const dots: number[] = [];
  for (const r of runs) {
    const rh = r.y1 - r.y0 + 1, rw = r.x1 - r.x0 + 1;
    if (rh > bandH * .3 || rw > bandH * .3 || r.y0 < top + bandH * .7) continue;
    const cx = (r.x0 + r.x1) / 2, after = cells.findIndex(c => cx > c.x1 - pitch * .08 && cx < c.x1 + (pitch - digitW) + pitch * .12);
    if (after >= 0 && after < cells.length - 1 && !dots.includes(after)) dots.push(after);
  }
  return { cells, dots, top, bottom, shear, slope: raw === raw0 ? 0 : slope, mask };
}
