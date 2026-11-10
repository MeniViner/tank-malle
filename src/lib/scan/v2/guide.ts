/**
 * The viewfinder guide box. The camera overlay draws exactly this rectangle
 * (as fractions of the visible preview) and the pipeline reads only the
 * pixels inside it, so whatever the person framed is what gets recognised.
 */
import type { Rect } from './preprocess';

export type ScanKind = 'pump' | 'odometer';
/** Fractions of the visible frame: x, y, width, height. */
export const GUIDE_BOXES: Record<ScanKind, Rect> = {
  // Pump: total, litres and (often) price stacked; a tall box.
  pump: { x: .08, y: .14, width: .84, height: .72 },
  // Odometer: one line, but dashboards show trip/clock rows nearby.
  odometer: { x: .06, y: .3, width: .88, height: .4 },
};

/** Pixel rectangle of the guide box inside a frame of `width` × `height`. */
export function guideRect(width: number, height: number, kind: ScanKind): Rect {
  const g = GUIDE_BOXES[kind];
  const x = Math.round(g.x * width), y = Math.round(g.y * height);
  return { x, y, width: Math.max(1, Math.min(width - x, Math.round(g.width * width))), height: Math.max(1, Math.min(height - y, Math.round(g.height * height))) };
}

/** A rectangle grown by `fraction` of its size on every side, clamped to the frame. */
export function padRect(rect: Rect, fraction: number, width: number, height: number): Rect {
  const x = Math.max(0, rect.x - rect.width * fraction), y = Math.max(0, rect.y - rect.height * fraction);
  return {
    x, y,
    width: Math.min(width, rect.x + rect.width * (1 + fraction)) - x,
    height: Math.min(height, rect.y + rect.height * (1 + fraction)) - y,
  };
}
