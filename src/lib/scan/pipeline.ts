import { analyzeDisplay, decideDisplay, type DisplayKind, type PolarityLines } from './automaticDisplay';
import { clip, crop, scaled, type Rect, type RgbaFrame } from './frame';
import type { LabelToken, NumericLine } from './identity';
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
  contested?: 'verifier'; verifierText?: string };
type Pixels = { width: number; height: number; data: Uint8ClampedArray };
/** Local text detection/recognition. Coordinates are in the image passed in. */
export type TextReader = { name: string; read: (image: Pixels) => Promise<TextItem[]> };
export type FrameAnalysis = { quality: FrameQuality; attempts: Attempt[]; region: Rect | null; ms: Record<string, number> };
export type PipelineOptions = { textReader?: TextReader | null; working?: number; fallback?: number; now?: () => number };
type Box = { left: number; right: number; top: number; height: number };

// A trailing unit read with the digits; a lone "m" is a "km" missing its k.
// Registers may pad with zeros beyond seven digits ("00236096").
const NUMBER = /^((?:0*\d{1,7})(?:\.\d{1,3})?)(km|kms|mi|m|l|lt|ltr)?$/i;
/** Split recognised text boxes into numeric lines and labels. */
export function fromText(items: TextItem[]) {
  const lines: NumericLine[] = [], labels: LabelToken[] = [];
  for (const item of items) {
    const box = { left: item.left, right: item.right, top: item.top, height: item.height };
    // A detector box can hold neighbouring numbers of a dial ("100 120"):
    // groups that are all round dial values are not one number.
    const groups = item.text.trim().split(/\s+/);
    if (groups.length > 1 && groups.every(group => /^\d{2,3}$/.test(group) && Number(group) % 10 === 0 && Number(group) <= 400)) {
      for (const group of groups) lines.push({ ...box, text: group });
      continue;
    }
    // Otherwise spaces inside a number and thousands commas are layout; quote
    // marks after it are detector noise.
    const compact = item.text.replace(/\s+/g, '').replace(/,(?=\d{3}(?!\d))/g, '').replace(/["'`]+$/, '');
    const match = NUMBER.exec(compact);
    if (match) {
      lines.push({ ...box, text: match[1], ...(item.contested ? { contested: item.contested } : {}) });
      // A unit printed in the same box is a label directly after the number.
      if (match[2] && match[2].toLowerCase() !== 'm') labels.push({ ...box, left: box.right, right: box.right + box.height, text: match[2] });
    } else labels.push({ ...box, text: item.text.trim() });
  }
  // Digits directly beside a number in its own band (a separate drum, a split
  // box) make the number's extent uncertain: was it cut, or is it two values?
  for (const line of lines) for (const item of items) {
    if (item.left === line.left && item.top === line.top || !/^\d[\d.,]*(km|m)?$/i.test(item.text.replace(/\s+/g, ''))) continue;
    const gap = Math.max(item.left - line.right, line.left - item.right), dy = Math.abs(item.top + item.height / 2 - line.top - line.height / 2), ratio = item.height / line.height;
    if (gap < line.height * .45 && dy < line.height * .35 && ratio > .75 && ratio < 1.33) line.contested = 'adjacent';
  }
  return { lines, labels };
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

  /** Text read on a region of the full frame, mapped back to working coordinates. */
  const readText = async (rect: Rect | null, path: string) => {
    if (!reader) return null;
    try {
      // A region is cut at the photo's own resolution (never enlarged): the
      // recogniser sees real pixels, and small regions are scaled by detection.
      const cut = rect ? crop(source, rect, Math.min(1, 960 / Math.max(rect.w, rect.h))) : { image, rect: { x: 0, y: 0, w: source.width, h: source.height }, scale: ratio };
      const found = fromText(await time(reader.name, () => reader.read(cut.image)));
      for (const line of found.lines) if (!line.contested && strayStroke(cut.image, line)) line.contested = 'stroke';
      const scale = ratio / cut.scale, dx = cut.rect.x * ratio, dy = cut.rect.y * ratio;
      return { lines: mapBoxes(found.lines, scale, dx, dy), labels: mapBoxes(found.labels, scale, dx, dy), path };
    } catch { return null; }
  };
  if (reader) {
    // Whole frame (or the located display) first; when that yields no reading,
    // the central region at a larger detection scale, where a small display
    // aimed at by the camera usually is.
    const centre = { x: source.width * .2, y: source.height * .2, w: source.width * .6, h: source.height * .6 };
    for (const [rect, name] of [[region, region ? 'roi' : String(working)], [region ? null : centre, 'centre']] as const) {
      if (name === 'centre' && (!rect || attempts.some(a => a.result.status === 'read'))) break;
      const first = await readText(rect, `${reader.name}@${name}`);
      if (!first) break;
      labels = [...labels, ...first.labels];
      const result = decideDisplay(asPolarity(first.lines), kind, first.labels);
      if (first.lines.length) attempts.push({ frame, path: first.path, result });
      // Nothing segment-like was located but text was: read that text again,
      // cut from the full frame at higher resolution, as a separate path.
      if (!region && result.status === 'read') {
        const textRegion = regionOf(first.lines.filter(l => Object.values(result.values).includes(l.text)), ratio, source);
        const second = textRegion ? await readText(textRegion, `${reader.name}@roi`) : null;
        if (second?.lines.length) attempts.push({ frame, path: second.path, result: decideDisplay(asPolarity(second.lines), kind, [...second.labels, ...first.labels]) });
        region = textRegion;
        break;
      }
    }
  }
  attempts.push({ frame, path: `segment@${working}`, result: decideDisplay(primary, kind, labels) });

  const segmentRegion = regionOf(primary.flatMap(p => p.stable), ratio, source);
  if (segmentRegion) {
    // High-resolution recrop: the located display cut from the full frame with
    // digits about 64, then 96 px tall. The segment reader's tolerances are
    // relative to image size, so a second size is a genuinely different read.
    const height = Math.max(...primary.flatMap(p => p.stable.map(l => l.height))) / ratio;
    let result: Attempt['result'] | null = null;
    // The segment reader expects digits under a third of the image height:
    // when the frame edge would leave less than 3.4 digit heights, the recrop
    // extends past the edge (repeating edge pixels) instead.
    const clipped = clip(segmentRegion, source), short = clipped.h < height * 3.4;
    const tall = Math.max(segmentRegion.h, height * 3.4), recrop = short ? { ...segmentRegion, y: segmentRegion.y + segmentRegion.h / 2 - tall / 2, h: tall } : clipped;
    for (const target of [64, 96]) {
      const cut = crop(source, recrop, Math.max(.4, Math.min(3, target / height)), 1_500_000, short);
      const lines = await time('segment-roi', () => analyzeDisplay(cut.image, kind));
      if (lines) result = decideDisplay(lines, kind, mapBoxes(labels, cut.scale / ratio, -cut.rect.x * cut.scale, -cut.rect.y * cut.scale));
      if (result?.status === 'read') break;
    }
    if (result) attempts.push({ frame, path: 'segment@roi', result });
  } else if (Math.max(source.width, source.height) > working * 1.15) {
    const larger = await time('resample', () => scaled(source, fallback));
    const lines = await time('segment', () => analyzeDisplay(larger.image, kind));
    if (lines) {
      attempts.push({ frame, path: `segment@${fallback}`, result: decideDisplay(lines, kind, mapBoxes(labels, larger.ratio / ratio)) });
      region ??= regionOf(lines.flatMap(p => p.stable), larger.ratio, source);
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
