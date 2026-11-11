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

type Gray = { width: number; height: number; data: Uint8Array };
const pending = new Map<string, { kind: DisplayKind; outcome: 'read' | 'unreadable'; guess: string | null }>();

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

/** Writes the record and returns its id (null when it could not even be queued). */
export function recordScanSample(meta: ScanSampleMeta, attempt: ScanAttempt): string | null {
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
      seconds: round(Math.min(3600, Math.max(0, attempt.seconds)), 1), width: sample?.width ?? 0, height: sample?.height ?? 0,
      journal: attempt.journal, platform: platform(), final: null, result: null, labeledAt: null,
    });
    const strips = (sample?.strips ?? []).slice(0, 3).flatMap(s => { const data = jpeg(s, .82); return data ? [{ role: s.role, text: s.text.slice(0, 16), confidence: round(Math.min(1, Math.max(0, s.confidence)), 3), w: s.width, h: s.height, jpeg: data }] : []; });
    const thumbData = sample?.thumb ? jpeg(sample.thumb, .6) : null;
    const thumb = thumbData && sample?.thumb ? { w: sample.thumb.width, h: sample.thumb.height, jpeg: thumbData } : null;
    if (strips.length || thumb) batch.set(doc(db, 'scanImages', ref.id), { uid: meta.uid, createdAt: now, strips, thumb });
    void batch.commit().catch(() => {});
    pending.set(ref.id, { kind: attempt.kind, outcome, guess });
    return ref.id;
  } catch { return null; }
}

/** Attaches the saved numbers to this form's attempts. Called once, after the fill-up is saved. */
export function labelScanSamples(ids: readonly string[], saved: Partial<ScanFinal>): void {
  for (const id of ids) {
    const entry = pending.get(id); if (!entry) continue;
    pending.delete(id);
    const final = readingKey(entry.kind, saved); if (!final) continue;
    try { void updateDoc(doc(db, 'scanSamples', id), { final, result: labelOf(entry.outcome, entry.guess, final), labeledAt: Date.now() }).catch(() => {}); } catch { /* never blocks a save */ }
  }
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
