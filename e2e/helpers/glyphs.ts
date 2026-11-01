import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Printed text for the replay scenes without a font engine: TrueType outlines
 * from a pinned font file, flattened and filled here with 4 sub-scanlines per
 * row and exact horizontal coverage. Only integer-exact and IEEE arithmetic is
 * involved, so a scene has the same pixels on every machine (the system font
 * renderer gave macOS and the CI's Linux different scenes).
 */
type Rgba = { width: number; height: number; data: Uint8ClampedArray };
type Point = [x: number, y: number, on: boolean];

/** Assistant Bold (SIL OFL 1.1, the app's own UI font; licence beside it). */
const FONT_FILE = resolve('e2e/fixtures/fonts/Assistant-Bold.ttf');
export const FONT_SHA256 = '93ecab56b243eea4f4f2a890bc340341042898f484f46b9919c365017942d153';

function parse(buf: Buffer) {
  const u16 = (o: number) => buf.readUInt16BE(o), i16 = (o: number) => buf.readInt16BE(o), u32 = (o: number) => buf.readUInt32BE(o);
  const tables: Record<string, number> = {};
  for (let i = 0; i < u16(4); i++) tables[buf.toString('latin1', 12 + 16 * i, 16 + 16 * i)] = u32(20 + 16 * i);
  const unitsPerEm = u16(tables.head + 18), longLoca = i16(tables.head + 50) === 1, metrics = u16(tables.hhea + 34);
  const loca = (g: number) => (longLoca ? u32(tables.loca + 4 * g) : u16(tables.loca + 2 * g) * 2);
  // cmap format 4 (the Windows Unicode BMP subtable).
  let sub = 0;
  for (let i = 0; i < u16(tables.cmap + 2); i++) { const o = tables.cmap + 4 + 8 * i; if (u16(o) === 3 && u16(o + 2) === 1) sub = tables.cmap + u32(o + 4); }
  const segments = u16(sub + 6) / 2, ends = sub + 14, starts = ends + 2 * segments + 2, deltas = starts + 2 * segments, ranges = deltas + 2 * segments;
  const glyphId = (code: number) => {
    for (let s = 0; s < segments; s++) {
      if (u16(ends + 2 * s) < code) continue;
      if (u16(starts + 2 * s) > code) return 0;
      const range = u16(ranges + 2 * s);
      if (!range) return (code + i16(deltas + 2 * s)) & 0xffff;
      const g = u16(ranges + 2 * s + range + 2 * (code - u16(starts + 2 * s)));
      return g ? (g + i16(deltas + 2 * s)) & 0xffff : 0;
    }
    return 0;
  };
  const advance = (g: number) => u16(tables.hmtx + 4 * Math.min(g, metrics - 1));
  function contours(g: number): Point[][] {
    let p = tables.glyf + loca(g);
    if (p === tables.glyf + loca(g + 1)) return [];
    const count = i16(p);
    if (count < 0) {
      // Composite: offset (and scaled) copies of other glyphs.
      const out: Point[][] = [];
      for (p += 10; ;) {
        const flags = u16(p), child = u16(p + 2); p += 4;
        const dx = flags & 1 ? i16(p) : buf.readInt8(p), dy = flags & 1 ? i16(p + 2) : buf.readInt8(p + 1); p += flags & 1 ? 4 : 2;
        let a = 1, b = 0, c = 0, d = 1;
        if (flags & 8) { a = d = i16(p) / 16384; p += 2; } else if (flags & 0x40) { a = i16(p) / 16384; d = i16(p + 2) / 16384; p += 4; } else if (flags & 0x80) { a = i16(p) / 16384; b = i16(p + 2) / 16384; c = i16(p + 4) / 16384; d = i16(p + 6) / 16384; p += 8; }
        for (const contour of contours(child)) out.push(contour.map(([x, y, on]) => [a * x + c * y + dx, b * x + d * y + dy, on]));
        if (!(flags & 0x20)) return out;
      }
    }
    const endPoints = Array.from({ length: count }, (_, i) => u16(p + 10 + 2 * i)), n = endPoints.length ? endPoints[count - 1] + 1 : 0;
    p += 10 + 2 * count; p += 2 + u16(p);
    const flags: number[] = [];
    while (flags.length < n) { const f = buf[p++]; flags.push(f); if (f & 8) for (let r = buf[p++]; r > 0; r--) flags.push(f); }
    const coordinates = (short: number, same: number) => {
      let v = 0;
      return flags.map(f => { if (f & short) v += f & same ? buf[p++] : -buf[p++]; else if (!(f & same)) { v += i16(p); p += 2; } return v; });
    };
    const xs = coordinates(2, 16), ys = coordinates(4, 32);
    let first = 0;
    return endPoints.map(last => { const contour = xs.slice(first, last + 1).map((x, i): Point => [x, ys[first + i], (flags[first + i] & 1) === 1]); first = last + 1; return contour; });
  }
  return { unitsPerEm, glyphId, advance, contours };
}

let font: ReturnType<typeof parse> | null = null;
function load() {
  if (font) return font;
  const bytes = readFileSync(FONT_FILE), hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== FONT_SHA256) throw new Error(`replay font ${FONT_FILE} is ${hash}, pinned ${FONT_SHA256}`);
  return (font = parse(bytes));
}

/** A quadratic TrueType contour as straight edges (16 steps per curve). */
function flatten(contour: Point[], map: (x: number, y: number) => [number, number]) {
  const n = contour.length, edges: number[][] = [];
  if (n < 2) return edges;
  const at = (i: number) => contour[((i % n) + n) % n], mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, true];
  const start = contour.findIndex(p => p[2]);
  const origin = start >= 0 ? contour[start] : mid(contour[0], contour[1]), from = start >= 0 ? start : 0;
  let pen = map(origin[0], origin[1]);
  const line = (x: number, y: number) => { const next = map(x, y); edges.push([pen[0], pen[1], next[0], next[1]]); pen = next; };
  let last: Point = origin;
  for (let k = 1; k <= n; k++) {
    const p = at(from + k);
    if (p[2]) { line(p[0], p[1]); last = p; continue; }
    const after = at(from + k + 1), end = after[2] ? after : mid(p, after);
    for (let s = 1; s <= 16; s++) { const t = s / 16, u = 1 - t; line(u * u * last[0] + 2 * u * t * p[0] + t * t * end[0], u * u * last[1] + 2 * u * t * p[1] + t * t * end[1]); }
    last = end; if (after[2]) k++;
  }
  return edges;
}

/** Fills the edges (nonzero winding) and blends `color` over the frame by coverage. */
function fill(frame: Rgba, edges: number[][], color: number[]) {
  const SUB = 4, { width, height, data } = frame;
  const top = Math.max(0, Math.floor(Math.min(...edges.map(e => Math.min(e[1], e[3]))))), bottom = Math.min(height, Math.ceil(Math.max(...edges.map(e => Math.max(e[1], e[3])))));
  const coverage = new Float64Array(width);
  for (let row = top; row < bottom; row++) {
    coverage.fill(0);
    for (let s = 0; s < SUB; s++) {
      const y = row + (s + .5) / SUB, crossings: [number, number][] = [];
      for (const [x0, y0, x1, y1] of edges) if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) crossings.push([x0 + (y - y0) * (x1 - x0) / (y1 - y0), y1 > y0 ? 1 : -1]);
      crossings.sort((a, b) => a[0] - b[0]);
      let winding = 0;
      for (let i = 0; i < crossings.length - 1; i++) {
        winding += crossings[i][1];
        if (!winding) continue;
        const a = Math.max(0, crossings[i][0]), b = Math.min(width, crossings[i + 1][0]);
        for (let x = Math.floor(a); x < b; x++) coverage[x] += (Math.min(x + 1, b) - Math.max(x, a)) / SUB;
      }
    }
    for (let x = 0; x < width; x++) {
      const alpha = Math.min(1, coverage[x]);
      if (!alpha) continue;
      const o = (row * width + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = Math.round(data[o + c] * (1 - alpha) + color[c] * alpha);
    }
  }
}

/**
 * Draws `text` with its baseline at `y`, `size` pixels to the em. `stretch`
 * narrows the glyphs (condensed display lettering). Hebrew is given in logical
 * order and drawn right to left; mixed lines are not needed here.
 */
export function drawText(frame: Rgba, text: string, { x, y, size, color, stretch = 1 }: { x: number; y: number; size: number; color: number[]; stretch?: number }) {
  const f = load(), scale = size / f.unitsPerEm, chars = [...text];
  const visual = chars.some(c => /[֐-׿]/.test(c)) ? chars.reverse() : chars;
  let pen = x;
  const edges: number[][] = [];
  for (const char of visual) {
    const g = f.glyphId(char.codePointAt(0)!);
    if (!g && char !== ' ') throw new Error(`replay font has no glyph for ${JSON.stringify(char)}`);
    const left = pen;
    for (const contour of f.contours(g)) edges.push(...flatten(contour, (gx, gy) => [left + gx * scale * stretch, y - gy * scale]));
    pen += f.advance(g) * scale * stretch;
  }
  if (edges.length) fill(frame, edges, color);
  return pen;
}
