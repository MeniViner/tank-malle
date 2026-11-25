/**
 * The app's one display reader. Code only: no trained model, no network.
 * It answers only when it is confident; otherwise the person types the number.
 */
import { sameRowOf, scanPhoto, stripOf, type ScanContext, type ScanKind, type Word } from './read';
import { displayCloudCrop } from './cloudCrop';
import type { Gray, RGBA } from './image';

export type DisplayKind = ScanKind;
export type { ScanContext };
export type DisplayReading = { total: string; liters: string } | { odometer: string };
export { ENGINE_VERSION } from './version';
import { acceptOdometer, tunedAccept, type Accept } from './accept';
export { ACCEPT, ACCEPT_RANGE, acceptOdometer, tunedAccept, type Accept } from './accept';

export type SampleRole = 'odometer' | 'total' | 'liters' | 'price';
/** A row the engine read, cut upright: what a later version (or a person) needs to see why a reading went wrong. */
export type SampleStrip = { role: SampleRole; text: string; confidence: number; width: number; height: number; data: Uint8Array };
/** What one reading attempt looked like to the engine; collected to measure and improve it (see `samples.ts`). */
export type DisplaySample = {
  /** The best guess, shown or not. */
  guess: DisplayReading | null; confidence: number | null; ms: number; width: number; height: number;
  strips: SampleStrip[];
  /** A small grey copy of the whole picture, only when nothing was read. */
  thumb: Gray | null;
};
/** Where a row that was read sits in the picture, as fractions of its width and height (for showing it). */
export type FoundRegion = { cx: number; cy: number; angle: number; width: number; height: number };
export type DisplayResult = ({ status: 'read'; values: DisplayReading; confidence: number; regions?: FoundRegion[] } | { status: 'unreadable' }) & { sample?: DisplaySample; cloudCrop?: Gray };
export type DisplayOptions = { sample?: boolean; cloudCrop?: boolean; accept?: Partial<Accept> | null };

/** Largest picture the engine is given, in pixels. */
export const MAX_PIXELS = 16_000_000;

function regionOf(word: Word, width: number, height: number): FoundRegion {
  const { cx, cy, ux, uy, length, height: digit } = word.line;
  return { cx: cx / width, cy: cy / height, angle: Math.atan2(uy, ux) * 180 / Math.PI, width: (length + digit * .5) / width, height: digit * 1.8 / height };
}

export function recognizeDisplay(image: RGBA, kind: DisplayKind, context: ScanContext = {}, options: DisplayOptions = {}): DisplayResult {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 32 || height < 32 || width * height > MAX_PIXELS || data.length !== width * height * 4) return { status: 'unreadable' };
  const result = scanPhoto(image, kind, context), accept = tunedAccept(options.accept);
  let answer: DisplayResult = { status: 'unreadable' }, guess: DisplayReading | null = null, confidence: number | null = null;
  const rows: { role: SampleRole; word: Word; text: string; confidence: number }[] = [];
  if (kind === 'odometer') {
    const best = result.odometer[0];
    if (best) { guess = { odometer: best.text }; confidence = best.confidence; }
    if (best && acceptOdometer(best.confidence, context, accept)) answer = { status: 'read', values: { odometer: best.text }, confidence: best.confidence, regions: [regionOf(best.word, width, height)] };
    for (const o of result.odometer) if (rows.length < 3 && !rows.some(r => sameRowOf(r.word, o.word))) rows.push({ role: 'odometer', word: o.word, text: o.text, confidence: o.confidence });
  } else {
    const best = result.pump[0];
    if (best) {
      guess = { total: best.total, liters: best.liters }; confidence = best.confidence;
      rows.push({ role: 'total', word: best.words.total, text: best.total, confidence: best.confidence }, { role: 'liters', word: best.words.liters, text: best.liters, confidence: best.confidence });
      if (best.words.price && best.price) rows.push({ role: 'price', word: best.words.price, text: best.price, confidence: best.confidence });
      if (best.confidence >= accept.pump) answer = { status: 'read', values: { total: best.total, liters: best.liters }, confidence: best.confidence, regions: [best.words.total, best.words.liters].map(word => regionOf(word, width, height)) };
    } else {
      // No coherent sale: keep the rows that look most like prices, so a person can see what was there.
      for (const w of result.words.filter(w => w.dot != null).sort((a, b) => b.fit * b.digits.length - a.fit * a.digits.length)) if (rows.length < 3 && !rows.some(r => sameRowOf(r.word, w))) rows.push({ role: 'total', word: w, text: w.text, confidence: w.fit });
    }
  }
  // Derive one display crop from digit geometry. Never send a thumbnail or a whole frame.
  if (options.cloudCrop && answer.status === 'unreadable') {
    answer.cloudCrop = displayCloudCrop(image, result, rows[0]?.word);
  }
  if (!options.sample) return answer;
  const strips = rows.map(r => { const g = stripOf(result.levels, r.word); return { role: r.role, text: r.text, confidence: r.confidence, width: g.width, height: g.height, data: g.data }; });
  const thumb = answer.status === 'read' ? null : result.levels.find(l => Math.max(l.width, l.height) <= 320) ?? null;
  return { ...answer, sample: { guess, confidence, ms: result.ms, width, height, strips, thumb } };
}
