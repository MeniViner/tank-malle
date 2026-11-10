/**
 * Finds rows of digit-sized marks anywhere in a photo, at any size and angle.
 * A display is tiny in a whole-dashboard photo and huge in a close-up, so the
 * search runs on every level of an image pyramid and looks for the same thing
 * each time: three or more similar blobs standing side by side.
 */
import { blobs, integral, localInk, sample, type Blob, type Gray, type Polarity } from './image';

export type LineProposal = {
  level: number; polarity: Polarity;
  /** Centre of the row, reading direction (unit vector) and digit height, in level-0 pixels. */
  cx: number; cy: number; ux: number; uy: number; height: number; length: number;
  count: number;
  /** Grey-level spread along the row (0..255): displays are crisp, surface texture is faint. */
  contrast: number;
};

export type ProposalOptions = { minSize?: number; maxSize?: number; radius?: number; offset?: number; maxLines?: number };
const DEFAULTS: Required<ProposalOptions> = { minSize: 11, maxSize: 52, radius: 14, offset: 14, maxLines: 600 };

function levelLines(g: Gray, level: number, polarity: Polarity, table: Uint32Array, o: Required<ProposalOptions>): LineProposal[] {
  const mask = localInk(g, o.radius, o.offset, polarity, table);
  const all = blobs(mask, g.width, g.height, 8, o.maxSize * o.maxSize * 4);
  // A digit is taller than wide and not a speck or a long rule.
  const marks = all.filter(b => b.major >= o.minSize && b.major <= o.maxSize && b.minor >= 1.5 && b.minor <= b.major * .95);
  const cell = o.maxSize * 2, grid = new Map<number, number[]>(), cols = Math.ceil(g.width / cell) + 1;
  marks.forEach((b, i) => { const k = Math.floor(b.cy / cell) * cols + Math.floor(b.cx / cell); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  const near = (b: Blob, reach: number) => {
    const out: number[] = [], gx = Math.floor(b.cx / cell), gy = Math.floor(b.cy / cell), span = Math.ceil(reach / cell);
    for (let y = gy - span; y <= gy + span; y++) for (let x = gx - span; x <= gx + span; x++) for (const j of grid.get(y * cols + x) ?? []) out.push(j);
    return out;
  };
  const similar = (a: Blob, b: Blob) => Math.min(a.major, b.major) / Math.max(a.major, b.major) > .62;
  const seenKeys = new Set<string>(), lines: LineProposal[] = [];
  marks.forEach((a, i) => {
    const partners = near(a, a.major * 1.8).filter(j => j !== i && similar(a, marks[j]) && Math.hypot(marks[j].cx - a.cx, marks[j].cy - a.cy) < a.major * 1.5)
      .sort((p, q) => Math.hypot(marks[p].cx - a.cx, marks[p].cy - a.cy) - Math.hypot(marks[q].cx - a.cx, marks[q].cy - a.cy)).slice(0, 4);
    for (const j of partners) {
      const b = marks[j]; let ux = b.cx - a.cx, uy = b.cy - a.cy; const d = Math.hypot(ux, uy); if (d < 2) continue; ux /= d; uy /= d;
      // Everything close to the line through a and b, of similar size.
      const members = near(a, a.major * 14).filter(k => similar(a, marks[k]) && Math.abs((marks[k].cx - a.cx) * -uy + (marks[k].cy - a.cy) * ux) < a.major * .28)
        .map(k => ({ k, t: (marks[k].cx - a.cx) * ux + (marks[k].cy - a.cy) * uy })).sort((p, q) => p.t - q.t);
      // One contiguous run containing a.
      const at = members.findIndex(m => m.k === i); if (at < 0) continue;
      let lo = at, hi = at;
      while (lo > 0 && members[lo].t - members[lo - 1].t < a.major * 1.7) lo--;
      while (hi < members.length - 1 && members[hi + 1].t - members[hi].t < a.major * 1.7) hi++;
      const run = members.slice(lo, hi + 1);
      if (run.length < 3) continue;
      const key = run.map(m => m.k).join(',');
      if (seenKeys.has(key)) continue; seenKeys.add(key);
      // Digits stand across the row: their long axis is closer to the normal than to the row.
      const upright = run.reduce((s, m) => s + Math.abs(Math.cos(marks[m.k].angle) * ux + Math.sin(marks[m.k].angle) * uy), 0) / run.length;
      if (upright > .62) continue;
      // Least-squares direction through the centroids.
      let mx = 0, my = 0; for (const m of run) { mx += marks[m.k].cx; my += marks[m.k].cy; } mx /= run.length; my /= run.length;
      let sxx = 0, syy = 0, sxy = 0; for (const m of run) { const dx = marks[m.k].cx - mx, dy = marks[m.k].cy - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const theta = .5 * Math.atan2(2 * sxy, sxx - syy); let vx = Math.cos(theta), vy = Math.sin(theta);
      // Photos are taken roughly upright: read left to right (a steep row is tried both ways later).
      if (vx < 0) { vx = -vx; vy = -vy; }
      const heights = run.map(m => marks[m.k].major).sort((p, q) => p - q), height = heights[heights.length >> 1];
      const ts = run.map(m => (marks[m.k].cx - mx) * vx + (marks[m.k].cy - my) * vy), t0 = Math.min(...ts), t1 = Math.max(...ts);
      const scale = 1 << level, mid = (t0 + t1) / 2;
      // Grey spread along the row, through the upper and lower halves of the marks.
      const values: number[] = [];
      for (const off of [-.25, .25]) for (let t = t0 - height * .3; t <= t1 + height * .3; t += 1) values.push(sample(g, mx + vx * t - vy * off * height, my + vy * t + vx * off * height));
      values.sort((p, q) => p - q);
      const contrast = values[Math.floor(values.length * .92)] - values[Math.floor(values.length * .08)];
      lines.push({ level, polarity, contrast, cx: (mx + vx * mid + .5) * scale - .5, cy: (my + vy * mid + .5) * scale - .5, ux: vx, uy: vy, height: height * scale, length: (t1 - t0 + height) * scale, count: run.length });
    }
  });
  // A small or blurred display: its digits run together into one long blob, as tall as a digit.
  const scale = 1 << level;
  for (const b of all) {
    if (b.minor < (level >= 2 ? 4.5 : o.minSize * .8) || b.minor > o.maxSize || b.major < b.minor * 2.2 || b.major > b.minor * 9 || b.area < b.major * b.minor * .25) continue;
    let ux = Math.cos(b.angle), uy = Math.sin(b.angle); if (ux < 0) { ux = -ux; uy = -uy; }
    const values: number[] = [];
    for (const off of [-.25, .25]) for (let t = -b.major / 2; t <= b.major / 2; t += 1) values.push(sample(g, b.cx + ux * t - uy * off * b.minor, b.cy + uy * t + ux * off * b.minor));
    values.sort((p, q) => p - q);
    lines.push({ level, polarity, contrast: values[Math.floor(values.length * .92)] - values[Math.floor(values.length * .08)],
      cx: (b.cx + .5) * scale - .5, cy: (b.cy + .5) * scale - .5, ux, uy, height: b.minor * scale, length: b.major * scale, count: Math.max(3, Math.round(b.major / (b.minor * .7))) });
  }
  return lines;
}

export function proposeLines(levels: Gray[], options: ProposalOptions = {}): LineProposal[] {
  const o = { ...DEFAULTS, ...options }, out: LineProposal[] = [];
  levels.forEach((g, level) => {
    if (Math.min(g.width, g.height) < 24) return;
    const table = integral(g);
    for (const polarity of ['light', 'dark'] as const) out.push(...levelLines(g, level, polarity, table, o));
  });
  // A textured surface (leather grain, asphalt) throws up thousands of faint rows; keep the crispest.
  const strength = (l: LineProposal) => l.contrast * Math.sqrt(Math.min(8, l.count));
  out.sort((a, b) => strength(b) - strength(a));
  out.length = Math.min(out.length, o.maxLines);
  // Keep the longest of near-identical rows (same place, direction and size).
  out.sort((a, b) => b.count - a.count);
  const kept: LineProposal[] = [];
  for (const l of out) {
    if (kept.some(k => k.polarity === l.polarity && Math.hypot(k.cx - l.cx, k.cy - l.cy) < k.height * .5 && Math.abs(k.ux * l.ux + k.uy * l.uy) > .97 &&
      Math.min(k.height, l.height) / Math.max(k.height, l.height) > .75 && l.length <= k.length * 1.15)) continue;
    kept.push(l);
  }
  return kept;
}

/**
 * Upright strip around a row: `outHeight` pixels tall, the digits filling the
 * middle ~60 %. `flip` reads the row in the opposite direction (upside down).
 */
export function rectify(levels: Gray[], line: LineProposal, outHeight = 64, flip = false, padCells = 1.6, band = 1.7): Gray {
  const stripH = line.height * band, step0 = stripH / outHeight;
  // Sample from the pyramid level whose pixels are just finer than the output's.
  let level = 0; while (level + 1 < levels.length && (1 << (level + 1)) <= step0) level++;
  const g = levels[level], s = 1 << level, step = step0 / s;
  const len = line.length + 2 * padCells * line.height, width = Math.max(8, Math.round(len / step0));
  const dir = flip ? -1 : 1, ux = line.ux * dir, uy = line.uy * dir, nx = -uy, ny = ux;
  const ox = (line.cx + .5) / s - .5, oy = (line.cy + .5) / s - .5, out = new Uint8Array(width * outHeight);
  for (let y = 0; y < outHeight; y++) {
    const v = (y - (outHeight - 1) / 2) * step;
    for (let x = 0; x < width; x++) {
      const u = (x - (width - 1) / 2) * step;
      out[y * width + x] = sample(g, ox + ux * u + nx * v, oy + uy * u + ny * v);
    }
  }
  return { width, height: outHeight, data: out };
}
