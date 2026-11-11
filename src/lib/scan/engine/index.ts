/**
 * The app's one display reader. Code only: no trained model, no network.
 * It answers only when it is confident; otherwise the person types the number.
 */
import { scanPhoto, type ScanContext, type ScanKind } from './read';
import type { RGBA } from './image';

export type DisplayKind = ScanKind;
export type { ScanContext };
export type DisplayReading = { total: string; liters: string } | { odometer: string };
export type DisplayResult = { status: 'read'; values: DisplayReading; confidence: number } | { status: 'unreadable' };

/**
 * Below these the engine's best guess is wrong more often than right on the
 * owner's photo set (scripts/scan-real); above them it was never wrong there.
 * Without a previous reading in the journal nothing checks an odometer reading,
 * so it needs more confidence (`odometerFirst`, set on public photos of other cars).
 */
export const ACCEPT = { odometer: .45, odometerFirst: .55, pump: .2 } as const;

/** Whether an odometer reading is confident enough to offer. */
export const acceptOdometer = (confidence: number, context: ScanContext = {}) =>
  confidence >= (context.lastOdometer != null && context.lastOdometer > 0 ? ACCEPT.odometer : ACCEPT.odometerFirst);
/** Largest picture the engine is given, in pixels. */
export const MAX_PIXELS = 16_000_000;

export function recognizeDisplay(image: RGBA, kind: DisplayKind, context: ScanContext = {}): DisplayResult {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 32 || height < 32 || width * height > MAX_PIXELS || data.length !== width * height * 4) return { status: 'unreadable' };
  const result = scanPhoto(image, kind, context);
  if (kind === 'odometer') {
    const best = result.odometer[0];
    return best && acceptOdometer(best.confidence, context) ? { status: 'read', values: { odometer: best.text }, confidence: best.confidence } : { status: 'unreadable' };
  }
  const best = result.pump[0];
  return best && best.confidence >= ACCEPT.pump ? { status: 'read', values: { total: best.total, liters: best.liters }, confidence: best.confidence } : { status: 'unreadable' };
}
