/**
 * Scan samples: what each reading attempt looked like and what the person finally saved.
 *
 * Every attempt (a camera session or a chosen file) writes one small record to `scanSamples`
 * and the rows the engine cut out to `scanImages`. When the fill-up is saved, the saved numbers
 * are attached as the label. That is the whole feedback loop: the Admin screen measures accuracy
 * from the records, and `scripts/scan-learn` re-tunes the engine's thresholds from them.
 * Nothing here may block or fail a scan: every write is fire-and-forget.
 */
import { doc, collection, getDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { APP_VERSION } from '../version';
import { ENGINE_VERSION } from './engine/version';
import type { Accept, DisplayKind, DisplayResult } from './engine';
import { labelOf, readingKey, type ScanFinal } from './sampleStats';
export type { ScanFinal };

export type ScanSource = 'camera' | 'file';
export type ScanAttempt = {
  kind: DisplayKind; source: ScanSource;
  /** The engine's answer, or null when it never answered (time limit, unreadable file). */
  result: DisplayResult | null;
  /** Camera frames looked at (1 for a file) and seconds from opening to the answer. */
  frames: number; seconds: number; journal: boolean;
};
export type ScanSampleMeta = { uid: string; session: string; attempt: number };
/** What labelling an attempt needs later. Plain data, so a fill-up draft can keep it across a reload. */
export type ScanSampleEntry = { id: string; kind: DisplayKind; outcome: 'read' | 'unreadable'; guess: string | null };
/**
 * One fill-up form's scanning: the session that groups its attempts (however often the scanner is
 * opened), the attempt counts per display, and the attempts to label when the fill-up is saved.
 */
export type ScanBook = { session: string; pump: number; odometer: number; samples: ScanSampleEntry[] };

export const newScanBook = (): ScanBook => ({ session: crypto.randomUUID(), pump: 0, odometer: 0, samples: [] });

/** A book restored from a draft, or null when it is not one. */
export function readScanBook(value: unknown): ScanBook | null {
  const b = value as Partial<ScanBook> | null;
  const count = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 99;
  if (!b || typeof b !== 'object' || typeof b.session !== 'string' || !b.session || b.session.length > 64 || !count(b.pump) || !count(b.odometer) || !Array.isArray(b.samples)) return null;
  const samples = b.samples.filter((e): e is ScanSampleEntry => !!e && typeof e === 'object' && typeof e.id === 'string' && /^[A-Za-z0-9]{1,40}$/.test(e.id)
    && (e.kind === 'pump' || e.kind === 'odometer') && (e.outcome === 'read' || e.outcome === 'unreadable') && (e.guess === null || typeof e.guess === 'string')).slice(0, 50);
  return { session: b.session, pump: b.pump!, odometer: b.odometer!, samples };
}

type Gray = { width: number; height: number; data: Uint8Array };

function jpeg(image: Gray, quality: number): string | null {
  try {
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); if (!context) return null;
    const pixels = context.createImageData(image.width, image.height);
    for (let i = 0; i < image.data.length; i++) { const v = image.data[i]; pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = v; pixels.data[i * 4 + 3] = 255; }
    context.putImageData(pixels, 0, 0);
    const url = canvas.toDataURL('image/jpeg', quality), prefix = 'data:image/jpeg;base64,';
    canvas.width = canvas.height = 0;
    return url.startsWith(prefix) && url.length - prefix.length <= 60_000 ? url.slice(prefix.length) : null;
  } catch { return null; }
}

const platform = () => { const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent; return /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) ? 'ios' : 'other'; };
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
/** The record is one write with its pictures: a value the rules refuse (NaN, a panorama's width) would lose the whole attempt. */
const unit = (n: number) => Number.isFinite(n) ? round(Math.min(1, Math.max(0, n)), 3) : 0;
const size = (n: number | undefined) => Number.isFinite(n) ? Math.min(20_000, Math.max(0, Math.round(n!))) : 0;

/** Writes the record and returns what labelling it needs (null when it could not even be queued). */
export function recordScanSample(meta: ScanSampleMeta, attempt: ScanAttempt): ScanSampleEntry | null {
  try {
    const ref = doc(collection(db, 'scanSamples')), sample = attempt.result?.sample, now = Date.now();
    const outcome = attempt.result?.status === 'read' ? 'read' as const : 'unreadable' as const;
    const guess = readingKey(attempt.kind, attempt.result?.status === 'read' ? attempt.result.values : sample?.guess ?? null);
    const confidence = attempt.result?.status === 'read' ? attempt.result.confidence : sample?.confidence ?? null;
    const batch = writeBatch(db);
    batch.set(ref, {
      uid: meta.uid, createdAt: now, day: new Date(now).toISOString().slice(0, 10), appVersion: APP_VERSION, engine: ENGINE_VERSION,
      kind: attempt.kind, source: attempt.source, session: meta.session, attempt: Math.min(99, Math.max(1, Math.round(meta.attempt))),
      outcome, guess, confidence: confidence == null || !Number.isFinite(confidence) ? null : round(Math.min(1, Math.max(0, confidence)), 3),
      ms: Math.min(600_000, Math.max(0, Math.round(sample?.ms ?? 0))), frames: Math.min(100_000, Math.max(0, Math.round(attempt.frames))),
      seconds: round(Math.min(3600, Math.max(0, Number.isFinite(attempt.seconds) ? attempt.seconds : 0)), 1), width: size(sample?.width), height: size(sample?.height),
      journal: attempt.journal, platform: platform(), final: null, result: null, labeledAt: null,
    });
    const strips = (sample?.strips ?? []).slice(0, 3).flatMap(s => { const data = jpeg(s, .82); return data ? [{ role: s.role, text: s.text.slice(0, 16), confidence: unit(s.confidence), w: s.width, h: s.height, jpeg: data }] : []; });
    const thumbData = sample?.thumb ? jpeg(sample.thumb, .6) : null;
    const thumb = thumbData && sample?.thumb ? { w: sample.thumb.width, h: sample.thumb.height, jpeg: thumbData } : null;
    if (strips.length || thumb) batch.set(doc(db, 'scanImages', ref.id), { uid: meta.uid, createdAt: now, strips, thumb });
    void batch.commit().catch(() => {});
    return { id: ref.id, kind: attempt.kind, outcome, guess };
  } catch { return null; }
}

/** Attaches the saved numbers to this form's attempts. A label is written once and never changes. */
export function labelScanSamples(entries: readonly ScanSampleEntry[], saved: Partial<ScanFinal>): void {
  for (const entry of entries) {
    const final = readingKey(entry.kind, saved); if (!final) continue;
    try { void updateDoc(doc(db, 'scanSamples', entry.id), { final, result: labelOf(entry.outcome, entry.guess, final), labeledAt: Date.now() }).catch(() => {}); } catch { /* never blocks a save */ }
  }
}

/** Time from saving to labelling: past the five seconds in which the save can still be undone. */
export const LABEL_AFTER_MS = 6_000;

/**
 * Labels once the save can no longer be undone. `cancel` (an undo started) holds the label back;
 * `flush` labels now, for an undo that failed. An undone save is never labelled: its numbers were
 * not what the person kept.
 */
export function scheduleScanLabels(entries: readonly ScanSampleEntry[], saved: Partial<ScanFinal>, delayMs = LABEL_AFTER_MS): { cancel: () => void; flush: () => void } {
  let done = !entries.length;
  const flush = () => { if (done) return; done = true; clearTimeout(timer); labelScanSamples(entries, saved); };
  const timer = setTimeout(flush, delayMs);
  return { cancel: () => clearTimeout(timer), flush };
}

let tuning: Promise<Partial<Accept> | null> | null = null;
/** Thresholds re-tuned from field data (`appConfig/scanTuning`, written by scripts/scan-learn); the engine clamps them. */
export function loadScanAccept(): Promise<Partial<Accept> | null> {
  tuning ??= getDoc(doc(db, 'appConfig', 'scanTuning')).then(snapshot => {
    const data = snapshot.data();
    return data && data.engine === ENGINE_VERSION && data.accept && typeof data.accept === 'object' ? data.accept as Partial<Accept> : null;
  }).catch(() => { tuning = null; return null; });
  return tuning;
}
