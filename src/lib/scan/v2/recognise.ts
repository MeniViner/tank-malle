/**
 * Scan v2 recogniser: a seven-segment-aware, segment-sampling decoder over
 * binarised digit cells. No trained weights and no runtime dependencies; the
 * "model" is the electrical seven-segment alphabet.
 *
 * Unlike the v1 reader it never refuses an unclear segment outright. Every
 * cell yields a probability over 0-9 and the top three survive, so the
 * constraint step and the person on the verification screen can choose.
 */
import type { BinaryImage, Rect } from './preprocess';

export type DigitOption = { digit: string; p: number };
export type DigitCell = {
  box: Rect;
  /** Top-3 digits, most probable first. Probabilities sum to ≤ 1. */
  options: DigitOption[];
  /** 0..1: how well the best pattern explains the sampled segments. */
  fit: number;
  /** Raw segment coverage a..g, kept for the on-device correction log. */
  segments: number[];
};
export type Separator = { kind: 'dot' | 'colon'; after: number };
export type Line = { box: Rect; height: number; cells: DigitCell[]; separators: Separator[] };

// a b c d e f g
export const PATTERNS: Record<string, string> = {
  '0': '1111110', '1': '0110000', '2': '1101101', '3': '1111001', '4': '0110011',
  '5': '1011011', '6': '1011111', '7': '1110000', '8': '1111111', '9': '1111011',
};
/** Common display variants: 6 and 9 without their tail, 7 with a left stroke. */
const VARIANTS: [string, string][] = [['6', '0011111'], ['9', '1110011'], ['7', '1110010']];
const ALL_PATTERNS: [string, string][] = [...Object.entries(PATTERNS), ...VARIANTS];

/** Normalised sampling windows inside a cell [x0, y0, x1, y1]; `h` = horizontal stroke. */
const WINDOWS: { rect: [number, number, number, number]; horizontal: boolean }[] = [
  // Each window covers the middle of its stroke only, away from the corners
  // where neighbouring strokes meet, so a lit neighbour cannot leak in.
  { rect: [.3, 0, .7, .2], horizontal: true },     // a
  { rect: [.62, .2, 1, .4], horizontal: false },   // b
  { rect: [.62, .6, 1, .8], horizontal: false },   // c
  { rect: [.3, .8, .7, 1], horizontal: true },     // d
  { rect: [0, .6, .38, .8], horizontal: false },   // e
  { rect: [0, .2, .38, .4], horizontal: false },   // f
  { rect: [.3, .4, .7, .6], horizontal: true },    // g
];

export type RecogniseOptions = {
  /** Logistic steepness mapping coverage to segment-on belief. */
  steepness?: number;
  /** Coverage at which a segment is equally likely on or off. */
  midpoint?: number;
  /** Softmax temperature over digit log-likelihoods. */
  temperature?: number;
};
const DEFAULTS: Required<RecogniseOptions> = { steepness: 9, midpoint: .45, temperature: 1.6 };

/**
 * Stroke coverage of one window: for a horizontal stroke, the share of
 * columns that contain ink; for a vertical one, the share of rows. Robust to
 * stroke thickness, which varies between displays and with blur.
 */
function coverage(binary: BinaryImage, box: Rect, rect: [number, number, number, number], horizontal: boolean): number {
  const x0 = Math.max(0, Math.floor(box.x + rect[0] * box.width)), x1 = Math.min(binary.width, Math.ceil(box.x + rect[2] * box.width));
  const y0 = Math.max(0, Math.floor(box.y + rect[1] * box.height)), y1 = Math.min(binary.height, Math.ceil(box.y + rect[3] * box.height));
  if (x1 <= x0 || y1 <= y0) return 0;
  let hit = 0;
  if (horizontal) {
    for (let x = x0; x < x1; x++) { for (let y = y0; y < y1; y++) if (binary.data[y * binary.width + x]) { hit++; break; } }
    return hit / (x1 - x0);
  }
  for (let y = y0; y < y1; y++) { for (let x = x0; x < x1; x++) if (binary.data[y * binary.width + x]) { hit++; break; } }
  return hit / (y1 - y0);
}

export function sampleSegments(binary: BinaryImage, box: Rect): number[] {
  return WINDOWS.map(w => coverage(binary, box, w.rect, w.horizontal));
}

/** Probability over digits from segment coverages. Pure; exported for tests. */
export function decodeSegments(segments: number[], options: RecogniseOptions = {}): { options: DigitOption[]; fit: number } {
  const { steepness, midpoint, temperature } = { ...DEFAULTS, ...options };
  const on = segments.map(c => Math.min(.98, Math.max(.02, 1 / (1 + Math.exp(-steepness * (c - midpoint))))));
  const best = new Map<string, number>();
  for (const [digit, pattern] of ALL_PATTERNS) {
    let logL = 0;
    for (let s = 0; s < 7; s++) logL += Math.log(pattern[s] === '1' ? on[s] : 1 - on[s]);
    if (!best.has(digit) || logL > best.get(digit)!) best.set(digit, logL);
  }
  const entries = [...best].sort((a, b) => b[1] - a[1]);
  const max = entries[0][1];
  const weights = entries.map(([, l]) => Math.exp((l - max) / temperature));
  const total = weights.reduce((s, w) => s + w, 0);
  // Fit: geometric-mean per-segment agreement of the best pattern.
  const fit = Math.exp(max / 7);
  return { options: entries.slice(0, 3).map(([digit], i) => ({ digit, p: weights[i] / total })), fit };
}

type Box = Rect & { area: number };

/** 4-connected components with bounding boxes. */
export function components(binary: BinaryImage, minArea = 3): Box[] {
  const { width: w, height: h, data } = binary, seen = new Uint8Array(w * h), queue = new Int32Array(w * h), out: Box[] = [];
  for (let i = 0; i < data.length; i++) {
    if (!data[i] || seen[i]) continue;
    let head = 0, tail = 1, x0 = w, x1 = -1, y0 = h, y1 = -1;
    queue[0] = i; seen[i] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % w, y = (p - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && data[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; queue[tail++] = p - 1; }
      if (x < w - 1 && data[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; queue[tail++] = p + 1; }
      if (y > 0 && data[p - w] && !seen[p - w]) { seen[p - w] = 1; queue[tail++] = p - w; }
      if (y < h - 1 && data[p + w] && !seen[p + w]) { seen[p + w] = 1; queue[tail++] = p + w; }
    }
    if (tail >= minArea) out.push({ x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, area: tail });
  }
  return out;
}

/** Separable box dilation: joins the gaps between segments of one digit. */
export function dilate(binary: BinaryImage, rx: number, ry: number): BinaryImage {
  const { width: w, height: h, data } = binary, tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w + rx; x++) {
      if (x < w && data[y * w + x]) run = 2 * rx + 1; else if (run) run--;
      const target = x - rx;
      if (target >= 0 && target < w && run) tmp[y * w + target] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h + ry; y++) {
      if (y < h && tmp[y * w + x]) run = 2 * ry + 1; else if (run) run--;
      const target = y - ry;
      if (target >= 0 && target < h && run) out[target * w + x] = 1;
    }
  }
  return { width: w, height: h, data: out };
}

const overlapX = (a: Rect, b: Rect) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y, area: a.area + b.area };
};

/**
 * Two blobs are one digit when they are stacked, close, and neither is
 * already a whole digit: two halves of a seven-segment digit (each about as
 * tall as wide), two strokes of a "1", or a fragment beside a larger piece.
 * Whole digits in neighbouring rows (taller than wide) never merge.
 */
function canMerge(a: Rect, b: Rect): boolean {
  if (overlapX(a, b) < Math.min(a.width, b.width) * .5) return false;
  const tallest = Math.max(a.height, b.height);
  const gap = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height);
  const span = Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y);
  if (gap > tallest * .35 || span > tallest * 2.4) return false;
  const similar = Math.max(a.width, b.width) <= Math.min(a.width, b.width) * 1.7 && Math.max(a.height, b.height) <= Math.min(a.height, b.height) * 1.7;
  const halves = similar && a.height <= a.width * 1.3 && b.height <= b.width * 1.3;
  const strokes = a.height >= a.width * 2.5 && b.height >= b.width * 2.5 && span <= tallest * 2.3;
  const [small, large] = a.height < b.height ? [a, b] : [b, a];
  const fragment = small.height < large.height * .45 && small.width <= large.width * 1.2 && large.width <= large.height && span <= large.height * 1.35;
  return halves || strokes || fragment;
}

export type LineOptions = RecogniseOptions & {
  /** Vertical dilation as a share of the crop's height (joins top and bottom halves). */
  joinY?: number;
  /** Smallest digit height in pixels. */
  minHeight?: number;
};

/**
 * Finds rows of digit-like cells and decodes each cell. Text, icons and
 * clocks also come out as rows; the field rules downstream decide which rows
 * can be which number.
 */
export function readLines(binary: BinaryImage, options: LineOptions = {}): Line[] {
  const minHeight = options.minHeight ?? 10;
  const joinY = Math.max(1, Math.round(binary.height * (options.joinY ?? .004)));
  const grouped = dilate(binary, 1, joinY);
  let boxes = components(grouped, 6).map(b => ({ ...b, y: b.y + joinY, height: Math.max(1, b.height - 2 * joinY), x: b.x + 1, width: Math.max(1, b.width - 2) }))
    .filter(b => b.width < binary.width * .9 && b.height < binary.height * .98);
  // Frames, bezels and icons that enclose other blobs are not digits.
  boxes = boxes.filter(b => boxes.filter(o => o !== b && o.x >= b.x && o.y >= b.y && o.x + o.width <= b.x + b.width && o.y + o.height <= b.y + b.height).length < 2);
  // Pieces of one digit stacked vertically (an unlit middle) merge into one cell.
  boxes.sort((a, b) => a.x - b.x);
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (canMerge(a, b)) { boxes[i] = union(a, b); boxes.splice(j, 1); changed = true; break outer; }
    }
  }
  const tall = boxes.filter(b => b.height >= minHeight && b.height >= b.width * .9 && b.width >= 2);
  const small = boxes.filter(b => !tall.includes(b));
  tall.sort((a, b) => b.height - a.height);
  const used = new Set<Box>(), lines: Line[] = [];
  for (const anchor of tall) {
    if (used.has(anchor)) continue;
    const cy = anchor.y + anchor.height / 2;
    const members = tall.filter(b => !used.has(b) && b.height / anchor.height > .72 && b.height / anchor.height < 1.3 && Math.abs(b.y + b.height / 2 - cy) < anchor.height * .3)
      .sort((a, b) => a.x - b.x);
    // Keep one horizontally contiguous run around the anchor.
    const height = members.reduce((s, b) => s + b.height, 0) / members.length;
    const run: Box[] = [anchor];
    const idx = members.indexOf(anchor);
    for (let i = idx + 1; i < members.length && members[i].x - (run.at(-1)!.x + run.at(-1)!.width) < height * 1.1; i++) run.push(members[i]);
    for (let i = idx - 1; i >= 0 && run[0].x - (members[i].x + members[i].width) < height * 1.1; i--) run.unshift(members[i]);
    run.forEach(b => used.add(b));
    const top = Math.min(...run.map(b => b.y)), bottom = Math.max(...run.map(b => b.y + b.height));
    const lineHeight = bottom - top;
    // Typical digit width from the non-narrow members (a "1" is narrow).
    const wide = run.filter(b => b.width > lineHeight * .38).map(b => b.width).sort((a, b) => a - b);
    const digitWidth = wide.length ? wide[Math.floor(wide.length / 2)] : lineHeight * .55;
    const cells: DigitCell[] = [];
    const boxesOut: Rect[] = [];
    for (const b of run) {
      // Touching digits: split an over-wide blob into equal cells.
      const parts = b.width > digitWidth * 1.55 ? Math.round(b.width / (digitWidth * 1.12)) : 1;
      for (let k = 0; k < Math.max(1, parts); k++) {
        const pw = b.width / Math.max(1, parts);
        boxesOut.push({ x: b.x + k * pw, y: top, width: pw, height: lineHeight });
      }
    }
    for (const box of boxesOut) {
      const narrow = box.width < digitWidth * .5;
      const candidates: Rect[] = narrow
        ? [{ ...box, x: box.x + box.width - digitWidth, width: digitWidth }, { ...box, x: box.x + box.width / 2 - digitWidth / 2, width: digitWidth }]
        : [box];
      let chosen: DigitCell | null = null;
      for (const c of candidates) {
        const segments = sampleSegments(binary, c);
        const decoded = decodeSegments(segments, options);
        if (!chosen || decoded.fit > chosen.fit) chosen = { box: c, ...decoded, segments };
      }
      cells.push(chosen!);
    }
    // Separators: small blobs inside the run's horizontal span.
    const separators: Separator[] = [];
    const inSpan = small.filter(s => s.x > run[0].x && s.x + s.width < run.at(-1)!.x + run.at(-1)!.width + height * .5 &&
      s.height < lineHeight * .3 && s.width < lineHeight * .3 && s.y > top - lineHeight * .1 && s.y + s.height < bottom + lineHeight * .15);
    const centres = boxesOut.map(b => b.x + b.width / 2);
    for (const s of inSpan) {
      const cx = s.x + s.width / 2;
      const after = centres.filter(c => c < cx).length - 1;
      if (after < 0 || after >= cells.length - 1) continue;
      const rel = (s.y + s.height / 2 - top) / lineHeight;
      const kind: Separator['kind'] = rel > .72 ? 'dot' : 'colon';
      const existing = separators.find(x => x.after === after);
      if (existing) { if (existing.kind !== kind) existing.kind = 'colon'; } else separators.push({ kind, after });
    }
    lines.push({ box: { x: run[0].x, y: top, width: run.at(-1)!.x + run.at(-1)!.width - run[0].x, height: lineHeight }, height: lineHeight, cells, separators });
  }
  return lines.sort((a, b) => a.box.y - b.box.y);
}

export type StringCandidate = { text: string; logP: number; digits: { char: string; confidence: number }[] };

/**
 * k-best strings for a line, by product of per-cell probabilities (beam
 * search; exact for ≤ 3^n when n is small). `dotAfter` inserts a decimal
 * point after that cell index.
 */
export function kBestStrings(cells: DigitCell[], k = 3, dotAfter: number | null = null, dotConfidence = 1): StringCandidate[] {
  let beam: StringCandidate[] = [{ text: '', logP: 0, digits: [] }];
  cells.forEach((cell, i) => {
    const next: StringCandidate[] = [];
    for (const partial of beam) for (const option of cell.options) {
      const confidence = option.p * cell.fit;
      const digits = [...partial.digits, { char: option.digit, confidence }];
      let text = partial.text + option.digit;
      if (dotAfter === i) { text += '.'; digits.push({ char: '.', confidence: dotConfidence }); }
      next.push({ text, logP: partial.logP + Math.log(Math.max(1e-9, confidence)), digits });
    }
    beam = next.sort((a, b) => b.logP - a.logP).slice(0, Math.max(k, 12));
  });
  return beam.slice(0, k);
}
