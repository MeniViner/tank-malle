/**
 * Scan v2 pipeline: viewfinder crop → greyscale / adaptive threshold / deskew
 * → seven-segment cell decoder → top-3 candidates per field → constraint
 * selection. Pure and synchronous; runs in a worker in the app.
 *
 * The output is always for the verification screen. It never saves anything.
 */
import { selectOdometer, selectPump, type FieldCandidate, type OdometerSelection, type PumpSelection, type ScanContext } from './constraints';
import type { ScanKind } from './guide';
import { cropImage, isValidImage, preprocess, type Polarity, type Rect, type RGBAImage } from './preprocess';
import { kBestStrings, readLines, type Line, type LineOptions, type StringCandidate } from './recognise';

export type PumpField = 'total' | 'liters' | 'price';
export type ScanV2Options = LineOptions & {
  /** Crop rectangle in source pixels (the guide box). Omit to read the whole image. */
  crop?: Rect;
  /** Adaptive threshold offsets as shares of the crop's grey range (2nd-98th percentile); one pass each. */
  offsets?: number[];
  /** Local-contrast factor: ink must also exceed mean + contrast × local std. */
  contrast?: number;
  /** Threshold window radius as a share of the crop's shorter side. */
  radiusShare?: number;
  /** Confidence given to a decimal point the display did not show. */
  insertedDotConfidence?: number;
  /** Longest side the crop is scaled to before processing. */
  workingSize?: number;
  /** Greyscale conversions to try (each with both polarities). */
  grays?: ('luma' | 'max')[];
};
export type ScanV2Result = {
  kind: ScanKind;
  status: 'candidates' | 'nothing-found' | 'invalid-image';
  /** The cropped pixels the person sees beside the digits. */
  crop: { width: number; height: number; data: Uint8ClampedArray } | null;
  fields: Partial<Record<PumpField | 'odometer', FieldCandidate[]>>;
  pump?: PumpSelection;
  odometer?: OdometerSelection;
  /** Per-crop facts for diagnosis and the correction log. */
  meta: { polarity: Polarity | null; angle: number; shear: number; lines: number };
};

const DEFAULTS = { offsets: [.06, .12, .2], contrast: .8, radiusShare: .06, insertedDotConfidence: .35, workingSize: 640, grays: ['luma'] as ('luma' | 'max')[] };

/** Nearest-neighbour downscale so the longest side is at most `size`. */
export function downscale(image: { width: number; height: number; data: Uint8ClampedArray }, size: number) {
  const longest = Math.max(image.width, image.height);
  if (longest <= size) return image;
  const r = size / longest, width = Math.max(2, Math.round(image.width * r)), height = Math.max(2, Math.round(image.height * r));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    // Box-average 2×2 source samples to reduce aliasing of thin strokes.
    const sy0 = Math.min(image.height - 1, Math.floor((y + .25) / r)), sy1 = Math.min(image.height - 1, Math.floor((y + .75) / r));
    for (let x = 0; x < width; x++) {
      const sx0 = Math.min(image.width - 1, Math.floor((x + .25) / r)), sx1 = Math.min(image.width - 1, Math.floor((x + .75) / r));
      for (let c = 0; c < 4; c++) {
        data[(y * width + x) * 4 + c] = (image.data[(sy0 * image.width + sx0) * 4 + c] + image.data[(sy0 * image.width + sx1) * 4 + c] +
          image.data[(sy1 * image.width + sx0) * 4 + c] + image.data[(sy1 * image.width + sx1) * 4 + c]) / 4;
      }
    }
  }
  return { width, height, data };
}

/** Spread of grey levels between the 2nd and 98th percentile of luma. */
export function grayRange(image: { width: number; height: number; data: ArrayLike<number> }): number {
  const histogram = new Uint32Array(256), n = image.width * image.height;
  for (let i = 0; i < n; i++) histogram[Math.round(.299 * image.data[i * 4] + .587 * image.data[i * 4 + 1] + .114 * image.data[i * 4 + 2])]++;
  let seen = 0, low = 0, high = 255;
  for (let v = 0; v < 256; v++) { seen += histogram[v]; if (seen >= n * .02) { low = v; break; } }
  seen = 0;
  for (let v = 255; v >= 0; v--) { seen += histogram[v]; if (seen >= n * .02) { high = v; break; } }
  return Math.max(1, high - low);
}

function toCandidate(s: StringCandidate): FieldCandidate {
  const chars = s.digits;
  const confidence = chars.length ? Math.exp(chars.reduce((sum, d) => sum + Math.log(Math.max(1e-6, d.confidence)), 0) / chars.length) : 0;
  return { text: s.text, value: Number(s.text), confidence, digits: chars };
}

function merge(lists: FieldCandidate[][], k = 3): FieldCandidate[] {
  const best = new Map<string, FieldCandidate>();
  for (const c of lists.flat()) {
    if (!Number.isFinite(c.value)) continue;
    const prev = best.get(c.text);
    if (!prev || c.confidence > prev.confidence) best.set(c.text, c);
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence).slice(0, k);
}

const meanFit = (line: Line) => line.cells.reduce((s, c) => s + c.fit, 0) / Math.max(1, line.cells.length);

/**
 * Prior over odometer length: most cars show 5-6 digits; a 4-digit row is
 * more often a clock without its colon, a 7-digit one often has an icon glyph.
 */
export const ODOMETER_LENGTH_PRIOR: Record<number, number> = { 4: .55, 5: .9, 6: 1, 7: .8 };

/** Odometer candidates from one set of lines: integer rows of 4-7 digits. */
export function odometerCandidates(lines: Line[]): FieldCandidate[] {
  const out: FieldCandidate[][] = [];
  const add = (cells: Line['cells'], k: number, factor = 1) =>
    out.push(kBestStrings(cells, k).map(toCandidate).map(c => ({ ...c, confidence: c.confidence * factor * (ODOMETER_LENGTH_PRIOR[c.text.length] ?? .5) })));
  for (const line of lines) {
    if (line.separators.length) continue;
    const n = line.cells.length;
    if (n >= 4 && n <= 7) add(line.cells, 3);
    // A row that swallowed a neighbouring glyph (an icon, a unit): also try
    // the best 6- and 7-digit windows inside it.
    for (const size of [7, 6]) {
      if (n <= size) continue;
      let bestStart = 0, bestFit = -1;
      for (let s = 0; s + size <= n; s++) {
        const fit = line.cells.slice(s, s + size).reduce((sum, c) => sum + c.fit, 0);
        if (fit > bestFit) { bestFit = fit; bestStart = s; }
      }
      add(line.cells.slice(bestStart, bestStart + size), 2, .85);
    }
  }
  return merge(out);
}

const DECIMALS: Record<PumpField, number[]> = { total: [2], liters: [3, 2], price: [2] };

/** Candidates for one pump field from one line, inserting a missing decimal point when needed. */
export function pumpFieldCandidates(line: Line, field: PumpField, insertedDotConfidence = DEFAULTS.insertedDotConfidence): FieldCandidate[] {
  if (line.separators.some(s => s.kind === 'colon') || line.separators.length > 1 || line.cells.length < 2) return [];
  const dot = line.separators[0];
  if (dot) return kBestStrings(line.cells, 3, dot.after).map(toCandidate);
  const lists = DECIMALS[field].filter(d => d < line.cells.length).map(d => kBestStrings(line.cells, 3, line.cells.length - 1 - d, insertedDotConfidence).map(toCandidate));
  return merge(lists);
}

/** Assigns the display's rows to total, liters and price (top to bottom). */
export function pumpRows(lines: Line[]): Partial<Record<PumpField, Line>> {
  const usable = lines.filter(l => l.cells.length >= 2 && !l.separators.some(s => s.kind === 'colon'));
  if (!usable.length) return {};
  const tallest = Math.max(...usable.map(l => l.height));
  const rows = usable.filter(l => l.height >= tallest * .5).sort((a, b) => a.box.y - b.box.y).slice(0, 3);
  return { total: rows[0], liters: rows[1], price: rows[2] };
}

export function scanV2(image: RGBAImage, kind: ScanKind, context: ScanContext = {}, options: ScanV2Options = {}): ScanV2Result {
  const settings = { ...DEFAULTS, ...options };
  const empty = (status: ScanV2Result['status'], crop: ScanV2Result['crop'] = null): ScanV2Result =>
    ({ kind, status, crop, fields: {}, meta: { polarity: null, angle: 0, shear: 0, lines: 0 } });
  if (!isValidImage(image, 40_000_000)) return empty('invalid-image');
  const cropped = cropImage(image, options.crop ?? { x: 0, y: 0, width: image.width, height: image.height });
  const working = downscale(cropped, settings.workingSize);
  if (working.width < 16 || working.height < 16) return empty('invalid-image', cropped);
  const range = grayRange(working);
  const passes = settings.grays.flatMap(method => (['light-on-dark', 'dark-on-light'] as const).flatMap(polarity => settings.offsets.map(offset => ({ method, polarity, offset })))).map(({ method, polarity, offset }) => {
    // Offsets are shares of the crop's grey range, so a dim display gets a lower bar.
    const pre = preprocess(working, { polarity, method, offset: Math.max(4, offset * range), contrast: settings.contrast, radius: Math.max(4, Math.min(working.width, working.height) * settings.radiusShare) });
    const lines = readLines(pre.binary, { ...options, minHeight: options.minHeight ?? Math.max(8, Math.round(working.height * .06)) });
    return { pre, lines, fit: lines.length ? Math.max(...lines.map(l => meanFit(l) * Math.min(1, l.cells.length / 4))) : 0 };
  }).sort((a, b) => b.fit - a.fit);
  const best = passes[0];
  const meta = { polarity: best.pre.polarity, angle: best.pre.angle, shear: best.pre.shear, lines: best.lines.length };
  if (kind === 'odometer') {
    const candidates = merge(passes.map(p => odometerCandidates(p.lines).map(c => p === best ? c : { ...c, confidence: c.confidence * .9 })));
    if (!candidates.length) return { ...empty('nothing-found', cropped), meta };
    return { kind, status: 'candidates', crop: cropped, fields: { odometer: candidates }, odometer: selectOdometer(candidates, context), meta };
  }
  const rows = pumpRows(best.lines);
  const fields: ScanV2Result['fields'] = {};
  for (const field of ['total', 'liters', 'price'] as const) {
    const line = rows[field];
    if (line) { const list = pumpFieldCandidates(line, field, settings.insertedDotConfidence); if (list.length) fields[field] = list; }
  }
  if (!fields.total?.length || !fields.liters?.length) return { ...empty('nothing-found', cropped), fields, meta };
  return { kind, status: 'candidates', crop: cropped, fields, pump: selectPump({ total: fields.total, liters: fields.liters, price: fields.price }, context), meta };
}
