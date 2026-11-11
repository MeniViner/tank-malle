/**
 * The scan engine: one code-only reader for odometer and pump photos, whole
 * photo or camera frame alike. It proposes rows of digit-like marks anywhere in
 * the picture, reads each as seven-segment digits, and lets what is known
 * about the numbers (a pump's total = litres × price; an odometer only goes
 * up) choose among the rows. It only ever suggests: the person confirms.
 */
import { luma, pyramid, type Gray, type RGBA } from './image';
import { proposeLines, rectify, type LineProposal, type ProposalOptions } from './proposals';
import { readStrip, type Cell } from './decode';

export type Word = {
  /** Digits with at most one decimal point, as shown. */
  text: string; digits: string; dot: number | null;
  /** 0..1, geometric mean of the cells' pattern fit. */
  fit: number; cells: Cell[];
  line: LineProposal; flipped: boolean;
  /** Read from the second, re-measured cut of its row. */
  refined?: boolean;
};
export type ScanKind = 'odometer' | 'pump';
export type ScanContext = { lastOdometer?: number | null; pricePerLiter?: number | null; tankCapacity?: number | null };
export type OdometerRead = { text: string; value: number; confidence: number; word: Word };
export type PumpRead = { total: string; liters: string; price: string | null; confidence: number; words: { total: Word; liters: Word; price: Word | null } };
export type EngineResult = { kind: ScanKind; odometer: OdometerRead[]; pump: PumpRead[]; words: Word[]; ms: number };

const MIN_FIT = .55, PRICE_MIN = 4.5, PRICE_MAX = 14;

/** Splits a row into runs of well-read digits on one regular pitch. */
export function wordsOf(cells: Cell[], dots: number[], line: LineProposal, flipped: boolean): Word[] {
  const out: Word[] = [];
  const pitches: number[] = [];
  for (let i = 1; i < cells.length; i++) if (cells[i].fit >= MIN_FIT && cells[i - 1].fit >= MIN_FIT) pitches.push(cells[i].x1 - cells[i - 1].x1);
  const pitch = pitches.length ? pitches.sort((a, b) => a - b)[pitches.length >> 1] : 0;
  let start = 0;
  const flush = (end: number) => {
    if (end - start >= 3) {
      const part = cells.slice(start, end), inside = dots.filter(d => d >= start && d < end - 1);
      const digits = part.map(c => c.options[0].digit).join(''), dot = inside.length === 1 ? inside[0] - start : null;
      // A row of nothing but upright strokes is a grille or a barcode, not a number.
      if (inside.length <= 1 && [...digits].filter(d => d !== '1').length >= Math.min(2, digits.length - 1)) {
        // Segment displays keep an exact pitch; printed numerals (a speedometer scale) do not.
        let drift = 0; for (let k = 1; k < part.length; k++) if (k - 1 !== dot) drift = Math.max(drift, Math.abs((part[k].x1 - part[k - 1].x1) / pitch - 1));
        const fit = Math.exp(part.reduce((s, c) => s + Math.log(c.fit), 0) / part.length) * (drift > .12 ? Math.max(.5, 1 - (drift - .12) * 2.5) : 1);
        out.push({ digits, dot, text: dot == null ? digits : `${digits.slice(0, dot + 1)}.${digits.slice(dot + 1)}`, fit, cells: part, line, flipped });
      }
    }
  };
  for (let i = 0; i < cells.length; i++) {
    const bad = cells[i].fit < MIN_FIT;
    // A decimal point may take room of its own; any other change of pitch ends the number.
    const step = i > start && pitch > 0 ? (cells[i].x1 - cells[i - 1].x1) / pitch : 1;
    const jump = step > (dots.includes(i - 1) ? 1.55 : 1.3) || step < .72;
    if (bad) { flush(i); start = i + 1; } else if (jump) { flush(i); start = i; }
  }
  flush(cells.length);
  return out;
}

const STRIP_H = 64, BAND = 1.7, PAD = 3;

/** The row a word was read from, re-measured from its own digits: exact centre, direction and digit height. */
function refine(word: Word, read: { top: number; bottom: number; slope: number }, stripWidth: number): LineProposal {
  const { line } = word, dir = word.flipped ? -1 : 1, ux = line.ux * dir, uy = line.uy * dir, nx = -uy, ny = ux;
  const step = line.height * BAND / STRIP_H, xm = (stripWidth - 1) / 2;
  const x = (word.cells[0].x0 + word.cells.at(-1)!.x1) / 2, y = (read.top + read.bottom) / 2 + read.slope * (x - xm);
  const du = (x - xm) * step, dv = (y - (STRIP_H - 1) / 2) * step;
  let vx = ux + read.slope * nx, vy = uy + read.slope * ny; const norm = Math.hypot(vx, vy); vx /= norm; vy /= norm;
  return { ...line, cx: line.cx + ux * du + nx * dv, cy: line.cy + uy * du + ny * dv, ux: vx, uy: vy,
    height: (read.bottom - read.top + 1) * step, length: (word.cells.at(-1)!.x1 - word.cells[0].x0) * step, count: word.cells.length };
}

/**
 * A pump shows its numbers stacked: the amount, and the volume under it. Once one of them is read
 * well, the rows just above and below it are cut out directly, at a few offsets and sizes, instead
 * of waiting for the blob search to stumble on them (reflections and glare often hide them from it).
 */
export function stackedRows(levels: Gray[], words: Word[]): Word[] {
  const anchors = words.filter(w => w.dot != null && w.fit >= .85 && w.digits.length >= 4).sort((a, b) => b.fit * b.line.height - a.fit * a.line.height);
  const kept: Word[] = [], out: Word[] = [];
  for (const a of anchors) { if (kept.length < 3 && !kept.some(k => sameRow(k, a))) kept.push(a); }
  for (const a of kept) {
    const dir = a.flipped ? -1 : 1, ux = a.line.ux * dir, uy = a.line.uy * dir, nx = -uy, ny = ux;
    for (const side of [1, -1]) for (let k = .8; k <= 2.21; k += .2) for (const scale of [.65, .8, 1, 1.25]) {
      const line: LineProposal = { ...a.line, ux, uy, cx: a.line.cx + nx * side * k * a.line.height, cy: a.line.cy + ny * side * k * a.line.height, height: a.line.height * scale, length: a.line.length * 1.1 };
      const read = readStrip(rectify(levels, line, STRIP_H, false, PAD, BAND), line.polarity);
      if (read) out.push(...wordsOf(read.cells, read.dots, line, false).filter(w => w.fit >= .8));
    }
  }
  return out;
}

export function readWords(levels: Gray[], options: ProposalOptions = {}): { words: Word[]; lines: number } {
  const lines = proposeLines(levels, options), first: { word: Word; refined: LineProposal }[] = [], words: Word[] = [];
  for (const line of lines) {
    // A steep row may be upside down; a gently sloped one is read left to right only.
    for (const flipped of Math.abs(line.ux) < .5 ? [false, true] : [false]) {
      const strip = rectify(levels, line, STRIP_H, flipped, PAD, BAND), read = readStrip(strip, line.polarity);
      if (!read) continue;
      for (const word of wordsOf(read.cells, read.dots, line, flipped)) first.push({ word, refined: refine(word, read, strip.width) });
      // The digits sit off-centre in the strip or are a different size than expected (so they may be
      // cut, or sampled too small): cut again around the band that was measured.
      const offCentre = Math.abs((read.top + read.bottom) / 2 - (STRIP_H - 1) / 2), size = (read.bottom - read.top + 1) / (STRIP_H / BAND);
      if (offCentre > STRIP_H * .08 || size < .82 || size > 1.2 || Math.abs(read.slope) > .06) {
        const dir = flipped ? -1 : 1, ux = line.ux * dir, uy = line.uy * dir, nx = -uy, ny = ux, step = line.height * BAND / STRIP_H;
        const dv = ((read.top + read.bottom) / 2 - (STRIP_H - 1) / 2) * step;
        let vx = ux + read.slope * nx, vy = uy + read.slope * ny; const norm = Math.hypot(vx, vy); vx /= norm; vy /= norm;
        const again: LineProposal = { ...line, cx: line.cx + nx * dv, cy: line.cy + ny * dv, ux: vx, uy: vy, height: (read.bottom - read.top + 1) * step };
        const strip2 = rectify(levels, again, STRIP_H, false, PAD, BAND), read2 = readStrip(strip2, again.polarity);
        if (read2) for (const word of wordsOf(read2.cells, read2.dots, again, false)) first.push({ word, refined: refine(word, read2, strip2.width) });
      }
    }
  }
  // Second look: each promising row is cut out again from its own measured geometry
  // (first-pass strips come from blob statistics and are often off-centre or tilted).
  first.sort((a, b) => b.word.fit * Math.min(6, b.word.cells.length) - a.word.fit * Math.min(6, a.word.cells.length));
  const seeds: typeof first = [];
  for (const f of first) {
    if (f.word.fit < .7 || seeds.length >= 40) continue;
    if (seeds.some(s => s.word.line.polarity === f.word.line.polarity && Math.hypot(s.refined.cx - f.refined.cx, s.refined.cy - f.refined.cy) < s.refined.height * .5 && Math.min(s.refined.height, f.refined.height) / Math.max(s.refined.height, f.refined.height) > .7)) continue;
    seeds.push(f);
  }
  for (const seed of seeds) {
    const read = readStrip(rectify(levels, seed.refined, STRIP_H, false, PAD + 1, BAND), seed.refined.polarity);
    if (read) for (const word of wordsOf(read.cells, read.dots, seed.refined, false)) words.push({ ...word, refined: true });
  }
  for (const f of first) words.push(f.word);
  return { words, lines: lines.length };
}

/** Two words read from the same physical row of the display (found twice, at different scales). */
const sameRow = (a: Word, b: Word) => a === b || Math.hypot(a.line.cx - b.line.cx, a.line.cy - b.line.cy) < Math.max(a.line.height, b.line.height) * .6;

/** Same length and one digit different, or the same digits with one more at either end. */
export function oneApart(a: string, b: string): boolean {
  if (a.length === b.length) { let d = 0; for (let i = 0; i < a.length; i++) d += +(a[i] !== b[i]); return d === 1; }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.length === short.length + 1 && (long.slice(1) === short || long.slice(0, -1) === short);
}

const ODOMETER_LENGTH: Record<number, number> = { 4: .5, 5: .85, 6: 1, 7: .8 };

export function chooseOdometer(words: Word[], context: ScanContext = {}): OdometerRead[] {
  const best = new Map<string, OdometerRead>();
  for (const word of words) {
    if (word.dot != null) continue;
    // The number may sit inside a longer row (a gear letter before it, a unit after it).
    for (let n = Math.min(7, word.digits.length); n >= 4; n--) for (let s = 0; s + n <= word.digits.length; s++) {
      const text = word.digits.slice(s, s + n).replace(/^0+(?=\d)/, ''); if (text.length < 4) continue;
      const value = Number(text), part = word.cells.slice(s, s + n);
      let confidence = Math.exp(part.reduce((sum, c) => sum + Math.log(c.fit * c.options[0].p), 0) / n) * (ODOMETER_LENGTH[text.length] ?? .4) * (n === word.digits.length ? 1 : .8) * word.fit * (word.refined ? 1 : .85);
      // The journal's last reading helps choose between rows, but it may be stale (a car
      // recorded long ago), so a reading far ahead of it is only mildly doubted; one behind it more so.
      const last = context.lastOdometer;
      if (last != null && last > 0) confidence *= value >= last && value <= last + 5000 ? 1 : value >= last ? .75 : .4;
      const prev = best.get(text);
      if (!prev || confidence > prev.confidence) best.set(text, { text, value, confidence, word });
    }
  }
  const list = [...best.values()];
  // A reading that is only part of a longer reading of the same row lost a digit at one end.
  for (const a of list) if (list.some(b => b !== a && b.text.length > a.text.length && b.text.includes(a.text) && sameRow(a.word, b.word) && b.confidence >= a.confidence * .6)) a.confidence *= .6;
  // Two close readings (one digit apart, or one with an extra digit at an end) that are both
  // plausible mean one segment or one narrow "1" decided between them: doubt both. On public odometer
  // photos (scripts/scan-real/trodo.mjs) this halves the wrong readings shown for a few right ones.
  const before = new Map(list.map(a => [a, a.confidence]));
  for (const a of list) if (list.some(b => b !== a && oneApart(a.text, b.text) && before.get(b)! >= before.get(a)! * .5)) a.confidence *= .7;
  return list.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

type Decimal = { word: Word; text: string; value: number; quality: number };
/**
 * Readings of a row as a number with `places` decimals and at most `maxInt`
 * whole digits. The row may carry extra cells at either end (a frame, a label),
 * so every window that ends in the right place is offered; a point the display
 * did not show may be assumed, at a cost.
 */
function decimals(word: Word, places: number[], maxInt: number, minInt = 1): Decimal[] {
  const out: Decimal[] = [], n = word.digits.length;
  const add = (start: number, end: number, d: number, cost: number) => {
    const part = word.cells.slice(start, end), whole = word.digits.slice(start, end - d).replace(/^0+(?=\d)/, '');
    const text = `${whole}.${word.digits.slice(end - d, end)}`, fit = Math.exp(part.reduce((sum, c) => sum + Math.log(c.fit), 0) / part.length);
    // Leaving out a cell that read well as a digit is suspicious; leaving out a poor one (a frame, a letter) is not.
    let dropped = 1; word.cells.forEach((c, i) => { if (i < start || i >= end) dropped *= 1 - .7 * c.fit * c.fit; });
    out.push({ word, text, value: Number(text), quality: fit * cost * dropped * (word.refined ? 1 : .85) * (/^0\d/.test(word.digits.slice(start, end - d)) ? .5 : 1) });
  };
  for (const d of places) {
    if (word.dot != null) { const end = word.dot + 1 + d; if (end <= n) for (let i = minInt; i <= maxInt && word.dot + 1 - i >= 0; i++) add(word.dot + 1 - i, end, d, 1); }
    else for (let end = d + minInt; end <= n; end++) for (let i = minInt; i <= maxInt && end - d - i >= 0; i++) add(end - d - i, end, d, .55);
  }
  return out;
}

export function choosePump(words: Word[], context: ScanContext = {}): PumpRead[] {
  const good = words.filter(w => w.fit >= .6);
  const totals = good.flatMap(w => decimals(w, [2], 4)), liters = good.flatMap(w => decimals(w, [3, 2], 3)), prices = good.flatMap(w => decimals(w, [2], 2));
  const best = new Map<string, PumpRead>();
  for (const t of totals) for (const l of liters) {
    if (sameRow(l.word, t.word) || l.value < 1 || t.value < 3) continue;
    // Fuel sells for a few shekels a litre; anything far outside that is two unrelated numbers.
    const implied = t.value / l.value; if (implied < PRICE_MIN || implied > PRICE_MAX) continue;
    // Same display: the litres row sits right under the amount (never beside it) and is not larger than it.
    const dir = t.word.flipped ? -1 : 1, ux = t.word.line.ux * dir, uy = t.word.line.uy * dir, dx = l.word.line.cx - t.word.line.cx, dy = l.word.line.cy - t.word.line.cy;
    const along = dx * ux + dy * uy, below = -dx * uy + dy * ux, size = t.word.line.height;
    if (below < size * .6 || below > size * 3 || Math.abs(along) > Math.max(t.word.line.length, size * 3) || l.word.line.height > size * 1.5 || l.word.line.height < size * .3) continue;
    // The pump rounds litres × price to the agora, and shows litres to the millilitre.
    const tolerance = .0062 + .0006 * implied;
    let price: Decimal | null = null;
    for (const p of prices) if (p.value >= PRICE_MIN && p.value <= PRICE_MAX && !sameRow(p.word, t.word) && !sameRow(p.word, l.word) && Math.abs(l.value * p.value - t.value) <= tolerance && (!price || p.quality > price.quality)) price = p;
    let confidence = t.quality * l.quality;
    // Evidence that the two numbers belong together, strongest first: the price row itself agrees;
    // the known price agrees; some whole-agora price makes the sum exact (true of every real sale).
    const round = Math.abs(l.value * Math.round(implied * 100) / 100 - t.value) <= tolerance;
    if (price) confidence *= .6 + .4 * price.quality;
    else if (context.pricePerLiter && Math.abs(implied - context.pricePerLiter) < .6) confidence *= round ? .7 : .4;
    else confidence *= round ? .4 : .08;
    if (context.tankCapacity && l.value > context.tankCapacity * 1.05) confidence *= .2;
    const k = `${t.text}|${l.text}`, prev = best.get(k);
    if (!prev || confidence > prev.confidence) best.set(k, { total: t.text, liters: l.text, price: price?.text ?? null, confidence, words: { total: t.word, liters: l.word, price: price?.word ?? null } });
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

/** Faint displays (glare, dusk, a dim backlight) need a lower ink threshold; it is slower and noisier, so it is the second try. */
const FAINT: ProposalOptions = { offset: 6 };

export function scanPhoto(image: RGBA, kind: ScanKind, context: ScanContext = {}): EngineResult {
  const started = Date.now(), levels = pyramid(luma(image));
  const choose = (words: Word[]) => ({ odometer: kind === 'odometer' ? chooseOdometer(words, context) : [], pump: kind === 'pump' ? choosePump(words, context) : [] });
  let { words } = readWords(levels), chosen = choose(words);
  const sure = kind === 'odometer' ? (chosen.odometer[0]?.confidence ?? 0) >= .6 : !!chosen.pump[0]?.price && chosen.pump[0].confidence >= .5;
  const sureNow = () => kind === 'odometer' ? (chosen.odometer[0]?.confidence ?? 0) >= .6 : !!chosen.pump[0]?.price && chosen.pump[0].confidence >= .5;
  if (!sure && kind === 'pump') { words = [...words, ...stackedRows(levels, words)]; chosen = choose(words); }
  if (!sureNow()) { words = [...words, ...readWords(levels, FAINT).words]; if (kind === 'pump') words = [...words, ...stackedRows(levels, words)]; chosen = choose(words); }
  return { kind, words, ...chosen, ms: Date.now() - started };
}
