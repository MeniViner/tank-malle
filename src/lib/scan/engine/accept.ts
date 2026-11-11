/** Confidence thresholds. No imports: scripts/scan-learn loads this file directly in Node. */
export type Accept = { odometer: number; odometerFirst: number; pump: number };

/**
 * Below these the engine's best guess is wrong more often than right on the
 * owner's photo set (scripts/scan-real); above them it was never wrong there.
 * Without a previous reading in the journal nothing checks an odometer reading,
 * so it needs more confidence (`odometerFirst`, set on public photos of other cars).
 */
export const ACCEPT = { odometer: .45, odometerFirst: .55, pump: .2 } as const;

/** A tuned threshold (from field data, see scripts/scan-learn) may move only this far from the built-in one. */
export const ACCEPT_RANGE = { odometer: [.4, .8], odometerFirst: [.5, .85], pump: [.15, .6] } as const;
export function tunedAccept(tuned?: Partial<Accept> | null): Accept {
  const pick = (k: keyof Accept) => { const v = tuned?.[k]; return typeof v === 'number' && Number.isFinite(v) ? Math.min(ACCEPT_RANGE[k][1], Math.max(ACCEPT_RANGE[k][0], v)) : ACCEPT[k]; };
  return { odometer: pick('odometer'), odometerFirst: pick('odometerFirst'), pump: pick('pump') };
}

/** Whether an odometer reading is confident enough to offer; `journal` = a previous reading exists to check it against. */
export const acceptOdometer = (confidence: number, context: { lastOdometer?: number | null } = {}, accept: Accept = ACCEPT) =>
  confidence >= (context.lastOdometer != null && context.lastOdometer > 0 ? accept.odometer : accept.odometerFirst);
