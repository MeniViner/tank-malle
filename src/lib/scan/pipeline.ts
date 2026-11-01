import { analyzeDisplay, decideDisplay, type DisplayKind, type PolarityLines } from './automaticDisplay';
import { clip, crop, scaled, type Rect, type RgbaFrame } from './frame';
import { classifyLabel, type LabelToken, type NumericLine } from './identity';
import { assessQuality, type FrameQuality } from './quality';
import { strayStroke } from './strokes';
import { CaptureSession, type Attempt } from './session';

/**
 * One frame, several independent recognition paths. The cheap segment reader
 * runs first on a working-size copy. A display it locates is cut again from
 * the full-resolution frame (a high-resolution recrop) and read separately;
 * a frame where nothing is located is retried at another scale. A second,
 * local text recogniser — when loaded — reads printed labels and numbers,
 * and is itself re-run on its own located number at higher resolution.
 * Every path reports its own attempt; the capture session decides.
 */
export type TextItem = { text: string; left: number; right: number; top: number; height: number; score: number;
  /** The second recogniser read a different number (kept for diagnosis). */
  contested?: 'verifier'; verifierText?: string;
  /** Per gap between characters of `text` (see ctcDecode): how close the
   * recogniser came to reading a digit it did not emit there. */
  doubts?: number[];
  /** The detected text region itself, in image coordinates, before the
   * detector's margin (left/right/top/height as above). */
  core?: Box };
type Pixels = { width: number; height: number; data: Uint8ClampedArray };
/** Local text detection/recognition. Coordinates are in the image passed in. */
export type TextReader = { name: string; read: (image: Pixels) => Promise<TextItem[]> };
export type FrameAnalysis = { quality: FrameQuality; attempts: Attempt[]; region: Rect | null; ms: Record<string, number> };
/** What one path saw, in full-frame coordinates (benchmark diagnosis only). */
export type TraceEvent = { path: string; items?: TextItem[]; lines: NumericLine[]; labels: LabelToken[] };
export type PipelineOptions = { textReader?: TextReader | null; working?: number; fallback?: number; now?: () => number; trace?: (event: TraceEvent) => void };
type Box = { left: number; right: number; top: number; height: number };

// Registers may pad with zeros beyond seven digits ("00236096").
const NUMBER = /^(?:0*\d{1,7})(?:\.\d{1,3})?$/;
// A number as read: digits, with spaces, commas, points or quote marks only
// between them (a colon makes a clock, which does not parse); or a word.
// Punctuation without letters is detector noise.
const TOKEN = /\d(?:[\d\s,.:'`"]*\d)?|[^\s\d]+/g, WORD = /[\p{L}\p{Sc}]/u;
type Run = { text: string; start: number; end: number; valid: boolean };
/** A digit the recogniser nearly read at a number's edge where a word is
 * glued to it (see ctcDecode) makes the number unsure: it may have dropped
 * that digit, as a narrow "1" between the digits and "km" ("190061km" read as
 * "19006km"). Chosen on the tuning split, where it costs no correct reading. */
export const DIGIT_DOUBT = .2;
/** "58,57" → "58.57". A comma before three digits is a thousands separator
 * ("1,109" stays ambiguous and is not read as a decimal). */
export const decimalComma = (text: string) => text.replace(/^(\d+),(\d{1,2})$/, '$1.$2');
/** A printed label of this kind of display (either kind when not given). A
 * lone "m" beside an odometer reading is a "km" missing its k. */
const known = (word: string, kind?: DisplayKind) => (kind ? [kind] : ['odometer', 'pump'] as const).some(k => classifyLabel(word, k) || (k === 'odometer' && /^m$/i.test(word)));
/**
 * Split recognised text boxes into numeric lines and labels. One box can hold
 * a label and its number ("ODO 128450", "128450 km", "TRIP 84.9"): each part
 * keeps its place in the box (by character position), and a label read in the
 * same box as a number is placed on that number, so it attaches to it and not
 * to a neighbour. A label between two numbers of one box could belong to
 * either and is placed on both. A label beside a number that does not parse
 * is dropped with it, never moved to another number. An unknown word directly
 * beside a number ("I 28450", "S12.34") may be a misread digit: the number is
 * unsure.
 */
export function fromText(items: TextItem[], kind?: DisplayKind) {
  const found: { line: NumericLine; item: number }[] = [], labels: LabelToken[] = [], pieces: (Box & { text: string; item: number })[] = [];
  items.forEach((item, index) => {
    const box = { left: item.left, right: item.right, top: item.top, height: item.height }, text = item.text.trim();
    // A detector box can hold neighbouring numbers of a dial ("100 120"):
    // groups that are all round dial values are not one number.
    const groups = text.split(/\s+/);
    if (groups.length > 1 && groups.every(group => /^\d{2,3}$/.test(group) && Number(group) % 10 === 0 && Number(group) <= 400)) {
      for (const group of groups) found.push({ line: { ...box, text: group }, item: index });
      pieces.push({ ...box, text: groups.join(''), item: index });
      return;
    }
    const tokens = [...text.matchAll(TOKEN)].map(m => ({ text: m[0], start: m.index, end: m.index + m[0].length, number: /^\d/.test(m[0]) }));
    // Spaces inside a number and thousands commas are layout; a comma before
    // one or two final digits can only be a decimal comma ("58,57").
    const runs: Run[] = tokens.filter(t => t.number).map(t => { const compact = decimalComma(t.text.replace(/\s+/g, '').replace(/,(?=\d{3}(?!\d))/g, '')); return { text: compact, start: t.start, end: t.end, valid: NUMBER.test(compact) }; });
    if (!runs.some(run => run.valid)) {
      labels.push({ ...box, text });
      for (const run of runs) pieces.push({ ...box, text: run.text, item: index });
      return;
    }
    // A number's part of the box reaches to the neighbouring word or number:
    // punctuation beside it is narrow noise inside its box, so the box edge
    // stays where the detector put it.
    const significant = tokens.filter(t => t.number || WORD.test(t.text)), at = (i: number) => box.left + (box.right - box.left) * i / text.length;
    const place = (run: Run) => ({ ...box, left: at(significant.findLast(t => t.end <= run.start)?.end ?? 0), right: at(significant.find(t => t.start >= run.end)?.start ?? text.length) });
    for (const run of runs) pieces.push({ ...place(run), text: run.text, item: index });
    tokens.forEach((token, i) => {
      if (token.number) {
        const run = runs.find(r => r.start === token.start)!; if (!run.valid) return;
        const word = (t?: typeof token): t is typeof token => !!t && !t.number && WORD.test(t.text), [prev, next] = [tokens[i - 1], tokens[i + 1]];
        // Ink of a label in the same box is not a stray digit stroke.
        const beside = { left: word(prev) && known(prev.text, kind), right: word(next) && known(next.text, kind) };
        const offset = item.text.length - item.text.trimStart().length, glued = (t?: typeof token) => word(t) && (t.end === run.start || t.start === run.end);
        const doubt = item.doubts ? Math.max(glued(prev) ? item.doubts[offset + run.start] ?? 0 : 0, glued(next) ? item.doubts[offset + run.end] ?? 0 : 0) : 0;
        const contested = item.contested ?? ([prev, next].some(t => word(t) && !known(t.text, kind)) ? 'text' : doubt >= DIGIT_DOUBT ? 'doubt' : undefined);
        found.push({ line: { ...place(run), text: run.text, ...(contested ? { contested } : {}), ...(beside.left || beside.right ? { beside } : {}), ...(item.doubts ? { doubt } : {}) }, item: index });
      } else if (WORD.test(token.text)) {
        const before = runs.findLast(r => r.end <= token.start), after = runs.find(r => r.start >= token.end);
        for (const run of [before, after]) if (run?.valid) labels.push({ ...place(run), text: token.text });
      }
    });
  });
  // Digits directly beside a number in its own band (a separate drum, a split
  // box) make the number's extent uncertain: was it cut, or is it two values?
  for (const { line, item } of found) for (const piece of pieces) {
    if (piece.item === item || !/^\d[\d.,]*$/.test(piece.text)) continue;
    const gap = Math.max(piece.left - line.right, line.left - piece.right), dy = Math.abs(piece.top + piece.height / 2 - line.top - line.height / 2), ratio = piece.height / line.height;
    if (gap < line.height * .45 && dy < line.height * .35 && ratio > .75 && ratio < 1.33) line.contested = 'adjacent';
  }
  return { lines: found.map(f => f.line), labels };
}
// Letters that are never drawn like a digit: a word made of at least two of
// them is not a misread number.
const NOT_DIGIT = /[\p{L}]/u, LOOKS_LIKE_DIGIT = new Set([...'IlOoDQSsBZzGbqgYyi|']);
const paintable = (text: string) => !/\d/.test(text) && [...text].filter(c => NOT_DIGIT.test(c) && !LOOKS_LIKE_DIGIT.has(c)).length >= 2;
/** A copy of the frame with each box (and a margin of a tenth of its height)
 * filled with the median colour of the pixels around it. */
function paint(source: RgbaFrame, boxes: Box[]): RgbaFrame {
  const { width, height } = source, data = new Uint8ClampedArray(source.data);
  for (const b of boxes) {
    const m = b.height * .1, x0 = Math.max(0, Math.floor(b.left - m)), x1 = Math.min(width - 1, Math.ceil(b.right + m)), y0 = Math.max(0, Math.floor(b.top - m)), y1 = Math.min(height - 1, Math.ceil(b.top + b.height + m));
    if (x1 <= x0 || y1 <= y0) continue;
    const ring: number[][] = [[], [], []];
    const sample = (x: number, y: number) => { const i = (y * width + x) * 4; for (let c = 0; c < 3; c++) ring[c].push(source.data[i + c]); };
    for (let x = x0; x <= x1; x++) { sample(x, y0); sample(x, y1); }
    for (let y = y0; y <= y1; y++) { sample(x0, y); sample(x1, y); }
    const fill = ring.map(values => values.sort((a, b) => a - b)[values.length >> 1]);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * width + x) * 4; data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; }
  }
  return { width, height, data };
}
/** Boxes mapped between images: out = in × scale + offset. */
const mapBoxes = <T extends Box>(boxes: T[], scale: number, dx = 0, dy = 0) => boxes.map(b => ({ ...b, left: b.left * scale + dx, right: b.right * scale + dx, top: b.top * scale + dy, height: b.height * scale }));
/** Union of located lines (working coordinates) as a full-frame region,
 * widened to take in labels printed beside or above the digits. */
function regionOf(lines: Box[], ratio: number, frame: { width: number; height: number }): Rect | null {
  if (!lines.length) return null;
  const left = Math.min(...lines.map(l => l.left)), right = Math.max(...lines.map(l => l.right));
  const top = Math.min(...lines.map(l => l.top)), bottom = Math.max(...lines.map(l => l.top + l.height)), size = Math.max(...lines.map(l => l.height));
  const rect = { x: (left - size * 1.6) / ratio, y: (top - size * 1.1) / ratio, w: (right - left + size * 3.2) / ratio, h: (bottom - top + size * 2.2) / ratio };
  return rect.w > 0 && rect.h > 0 && rect.w <= frame.width * 1.2 ? rect : null;
}
const asPolarity = (lines: NumericLine[]): PolarityLines[] => [{ polarity: 'light', stable: lines.map(l => ({ ...l, polarity: 'light' as const, support: 2 })), conflicts: [] }];

export async function analyzeFrame(source: RgbaFrame, kind: DisplayKind, frame: number, options: PipelineOptions = {}): Promise<FrameAnalysis> {
  const now = options.now ?? (() => performance.now()), ms: Record<string, number> = {}, attempts: Attempt[] = [];
  const time = async <T>(name: string, run: () => T | Promise<T>) => { const start = now(); try { return await run(); } finally { ms[name] = (ms[name] ?? 0) + now() - start; } };
  const working = options.working ?? 960, fallback = options.fallback ?? 1280, reader = options.textReader ?? null;
  const { image, ratio } = await time('resample', () => scaled(source, working));
  const quality = assessQuality(image);
  if (!quality.usable) return { quality, attempts, region: null, ms };
  const primary = await time('segment', () => analyzeDisplay(image, kind));
  if (!primary) return { quality, attempts, region: null, ms };
  let region = regionOf(primary.flatMap(p => p.stable), ratio, source), labels: LabelToken[] = [];
  /** Recognised words that cannot be digits, in full-frame coordinates. */
  const words: Box[] = [];
  let readWhole = false;

  /** Text read on a region of the full frame, mapped back to working coordinates. */
  const readText = async (rect: Rect | null, path: string) => {
    if (!reader) return null;
    try {
      // A region is cut at the photo's own resolution (never enlarged): the
      // recogniser sees real pixels, and small regions are scaled by detection.
      const cut = rect ? crop(source, rect, Math.min(1, 960 / Math.max(rect.w, rect.h))) : { image, rect: { x: 0, y: 0, w: source.width, h: source.height }, scale: ratio };
      if (!rect) readWhole = true;
      const items = await time(reader.name, () => reader.read(cut.image)), found = fromText(items, kind);
      for (const line of found.lines) if (!line.contested && strayStroke(cut.image, line)) line.contested = 'stroke';
      const scale = ratio / cut.scale, dx = cut.rect.x * ratio, dy = cut.rect.y * ratio;
      words.push(...mapBoxes(items.filter(i => i.core && paintable(i.text)).map(i => i.core!), 1 / cut.scale, cut.rect.x, cut.rect.y));
      options.trace?.({ path, items: mapBoxes(items, 1 / cut.scale, cut.rect.x, cut.rect.y), lines: mapBoxes(found.lines, 1 / cut.scale, cut.rect.x, cut.rect.y), labels: mapBoxes(found.labels, 1 / cut.scale, cut.rect.x, cut.rect.y) });
      return { lines: mapBoxes(found.lines, scale, dx, dy), labels: mapBoxes(found.labels, scale, dx, dy), path };
    } catch { return null; }
  };
  if (reader) {
    // Whole frame (or the located display) first; when that yields no reading,
    // the central region at a larger detection scale, where a small display
    // aimed at by the camera usually is.
    const centre = { x: source.width * .2, y: source.height * .2, w: source.width * .6, h: source.height * .6 };
    // A pump's rows are stacked, each with its own word: when the segment
    // reader located some rows but could not read the display, the region it
    // found may hold only one of them, so the text reader starts from the
    // whole frame instead.
    const from = kind === 'pump' && region && decideDisplay(primary, kind).status !== 'read' ? null : region;
    let sawDecimals = false;
    for (const [rect, name] of [[from, from ? 'roi' : String(working)], [from ? null : centre, 'centre']] as const) {
      // A pump whose whole frame already showed decimal rows is not retried on
      // the central region: that crop can cut off its amount row.
      if (name === 'centre' && (!rect || attempts.some(a => a.result.status === 'read') || (kind === 'pump' && sawDecimals))) break;
      const first = await readText(rect, `${reader.name}@${name}`);
      if (!first) break;
      sawDecimals ||= first.lines.some(l => l.text.includes('.'));
      labels = [...labels, ...first.labels];
      const result = decideDisplay(asPolarity(first.lines), kind, first.labels);
      if (first.lines.length) attempts.push({ frame, path: first.path, result });
      // Nothing segment-like was located but text was: read that text again,
      // cut from the full frame at higher resolution, as a separate path.
      if (!from && result.status === 'read') {
        // The value may be a padded register's number ("00236096" read as 236096).
        // A pump's recrop takes every row read, so it never cuts one in half
        // (a half row is rightly unsure and blocks the reading).
        const textRegion = regionOf(kind === 'pump' ? first.lines : first.lines.filter(l => Object.values(result.values).some(v => v === l.text || v === l.text.replace(/^0+(?=\d)/, ''))), ratio, source);
        const second = textRegion ? await readText(textRegion, `${reader.name}@roi`) : null;
        if (second?.lines.length) attempts.push({ frame, path: second.path, result: decideDisplay(asPolarity(second.lines), kind, [...second.labels, ...first.labels]) });
        region = textRegion;
        break;
      }
    }
  }
  attempts.push({ frame, path: `segment@${working}`, result: decideDisplay(primary, kind, labels) });
  options.trace?.({ path: `segment@${working}`, lines: mapBoxes(primary.flatMap(p => p.stable), 1 / ratio), labels: mapBoxes(labels, 1 / ratio) });

  /** High-resolution recrop: the located display cut from the full frame with
   * digits about 64, then 96 px tall. The segment reader's tolerances are
   * relative to image size, so a second size is a genuinely different read. */
  const recropSegment = async (frameImage: RgbaFrame, located: PolarityLines[], path: string) => {
    const segmentRegion = regionOf(located.flatMap(p => p.stable), ratio, frameImage);
    if (!segmentRegion) return false;
    const height = Math.max(...located.flatMap(p => p.stable.map(l => l.height))) / ratio;
    let result: Attempt['result'] | null = null;
    // The segment reader expects digits under a third of the image height:
    // when the frame edge would leave less than 3.4 digit heights, the recrop
    // extends past the edge (repeating edge pixels) instead.
    const clipped = clip(segmentRegion, frameImage), short = clipped.h < height * 3.4;
    const tall = Math.max(segmentRegion.h, height * 3.4), recrop = short ? { ...segmentRegion, y: segmentRegion.y + segmentRegion.h / 2 - tall / 2, h: tall } : clipped;
    for (const target of [64, 96]) {
      const cut = crop(frameImage, recrop, Math.max(.4, Math.min(3, target / height)), 1_500_000, short);
      const lines = await time('segment-roi', () => analyzeDisplay(cut.image, kind));
      if (lines) result = decideDisplay(lines, kind, mapBoxes(labels, cut.scale / ratio, -cut.rect.x * cut.scale, -cut.rect.y * cut.scale));
      if (lines) options.trace?.({ path, lines: mapBoxes(lines.flatMap(p => p.stable), 1 / cut.scale, cut.rect.x, cut.rect.y), labels: mapBoxes(labels, 1 / ratio) });
      if (result?.status === 'read') break;
    }
    if (result) attempts.push({ frame, path, result });
    return true;
  };
  // Nothing located: the frame again at a larger working size.
  if (!(await recropSegment(source, primary, 'segment@roi')) && Math.max(source.width, source.height) > working * 1.15) {
    const larger = await time('resample', () => scaled(source, fallback));
    const lines = await time('segment', () => analyzeDisplay(larger.image, kind));
    if (lines) {
      attempts.push({ frame, path: `segment@${fallback}`, result: decideDisplay(lines, kind, mapBoxes(labels, larger.ratio / ratio)) });
      options.trace?.({ path: `segment@${fallback}`, lines: mapBoxes(lines.flatMap(p => p.stable), 1 / larger.ratio), labels: mapBoxes(labels, 1 / ratio) });
      region ??= regionOf(lines.flatMap(p => p.stable), larger.ratio, source);
    }
  }
  // Printed words beside the digits (SALE, LITRES, km) can be taken into the
  // segment reader's digit row, which then does not parse. When no segment
  // path read anything and the recogniser found such words, their own text
  // regions are painted over with the colour around them and the segment
  // reader runs again on that copy (whole frame, then a recrop) as separate
  // paths. Only words that cannot be digits are painted, never a box holding
  // a digit, and the words still count as labels for identity.
  // Pumps only (stacked rows, each with its own printed word; on odometer
  // photographs this cost about 0.7 s a frame for one more reading on the
  // tuning split), and only where the segment reader did locate digit rows.
  const located = kind === 'pump' && primary.some(p => p.stable.length > 0);
  if (reader && located && !attempts.some(a => a.path.startsWith('segment') && a.result.status === 'read')) {
    // Text read only around one located row can miss a label on another
    // row: the whole frame is read for words (not as another reading path).
    const whole = readWhole ? null : await readText(null, `${reader.name}@${working}-words`);
    if (whole) labels = [...labels, ...whole.labels];
  }
  if (located && words.length && !attempts.some(a => a.path.startsWith('segment') && a.result.status === 'read')) {
    const painted = await time('paint', () => paint(source, words));
    const small = await time('resample', () => scaled(painted, working));
    const lines = await time('segment', () => analyzeDisplay(small.image, kind));
    if (lines) {
      attempts.push({ frame, path: `segment-painted@${working}`, result: decideDisplay(lines, kind, labels) });
      options.trace?.({ path: `segment-painted@${working}`, lines: mapBoxes(lines.flatMap(p => p.stable), 1 / ratio), labels: mapBoxes(labels, 1 / ratio) });
      await recropSegment(painted, lines, 'segment-painted@roi');
    }
  }
  return { quality, attempts, region, ms };
}

/** A still photo is a session of one frame with several paths. */
export async function readStill(source: RgbaFrame, kind: DisplayKind, options: PipelineOptions = {}) {
  const session = new CaptureSession(kind, { still: true }), analysis = await analyzeFrame(source, kind, 0, options);
  session.frame(0, analysis.quality.hint);
  for (const attempt of analysis.attempts) session.attempt(attempt);
  return { decision: session.decide(), analysis };
}
