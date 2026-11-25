import { blobs, type Gray, type RGBA } from './image';
import { rectify, type LineProposal } from './proposals';
import type { EngineResult, Word } from './read';

/** Locate a compact strip of illuminated digits, including on a tilted instrument cluster. */
function illuminatedStrip(image: RGBA): LineProposal | undefined {
  const step = Math.max(1, Math.ceil(Math.max(image.width, image.height) / 560));
  const width = Math.floor(image.width / step), height = Math.floor(image.height / step);
  const mask = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = (y * step * image.width + x * step) * 4;
      const r = image.data[p], g = image.data[p + 1], b = image.data[p + 2];
      const peak = Math.max(r, g, b);
      if (peak < 100 || peak - Math.min(r, g, b) < 75) continue;
      // Join strokes at preview resolution before fitting their orientation.
      for (let dy = -1; dy <= 1; dy++) mask.fill(1, (y + dy) * width + x - 1, (y + dy) * width + x + 2);
    }
  }
  const candidates = blobs(mask, width, height, 30, width * height * .025).filter(b => {
    const aspect = b.major / b.minor;
    return aspect >= 2.7 && aspect <= 9 && b.minor >= 4 && b.major <= width * .55 &&
      b.x0 > 1 && b.x1 < width - 2 && b.y0 > 1 && b.y1 < height - 2;
  });
  // Prefer an illuminated strip against dark instrument housing. This rejects
  // coloured trim, reflections and the bright edges of a windscreen.
  let best: LineProposal | undefined, bestScore = 0;
  for (const b of candidates) {
    const ux = Math.cos(b.angle), uy = Math.sin(b.angle);
    const brightness = (u: number, v: number) => {
      const x = Math.round((b.cx + ux * u - uy * v) * step);
      const y = Math.round((b.cy + uy * u + ux * v) * step);
      if (x < 0 || x >= image.width || y < 0 || y >= image.height) return 255;
      const p = 4 * (y * image.width + x);
      return Math.max(image.data[p], image.data[p + 1], image.data[p + 2]);
    };
    let surround = 0;
    for (const u of [-.3, 0, .3]) surround += brightness(u * b.major, b.minor) + brightness(u * b.major, -b.minor);
    if (surround / 6 >= 105) continue;
    const score = b.major * b.minor * (1 - surround / (6 * 255));
    if (score > bestScore) {
      bestScore = score;
      best = { level: 0, cx: b.cx * step, cy: b.cy * step, ux, uy, height: b.minor * step,
        length: b.major * step, count: 0, contrast: 0, polarity: 'light' };
    }
  }
  return best;
}

export function displayCloudCrop(image: RGBA, result: EngineResult, firstRow?: Word): Gray | undefined {
  // Pump totals are printed in large digits. Smaller marks on a receipt screen or
  // instruction panel can otherwise win on decoder confidence alone.
  const pumpAnchor = result.kind === 'pump' ? result.words.filter(w => w.digits.length >= 4 && w.fit >= .85)
    .sort((a, b) => b.fit * b.line.height - a.fit * a.line.height)[0] : undefined;
  const anchor = pumpAnchor ?? firstRow ?? result.words.reduce<Word | undefined>((best, word) =>
    !best || word.fit * word.digits.length > best.fit * best.digits.length ? word : best, undefined);
  const illuminated = result.kind === 'odometer' ? illuminatedStrip(image) : undefined;
  const line = illuminated ?? anchor?.line ?? result.candidateLine;
  if (!line) return;
  const pump = result.kind === 'pump';
  const band = pump ? 4.2 : 2.4, padding = pump ? 2.3 : 1.5;
  const h = line.height * band, w = line.length + 2 * padding * line.height;
  if (w * h >= image.width * image.height * .7 || w / h > 12 || h < 12) return;
  return rectify(result.levels, line, Math.min(300, Math.max(1, Math.floor(960 * h / w))),
    !illuminated && !!anchor?.flipped, padding, band);
}
