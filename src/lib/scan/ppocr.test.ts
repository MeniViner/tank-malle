import { describe, expect, it } from 'vitest';
import { createPpocrReader, ctcDecode, verifierAgrees, widen, type OrtSession } from './ppocr';
import { blank, drawDigits } from './fixtures';

describe('second recogniser agreement', () => {
  it('reads seven-segment digits the verifier wrote as letters as the digits they are drawn like', () => {
    // Verifier readings from TRODO tuning photographs.
    for (const [reading, verifier] of [['26475', '2647Sm'], ['120449', '120YY9'], ['18022', '1B022'], ['66500', '66S00'], ['128450', 'I28450'], ['146155', '14615S'], ['235128km', '235128im']])
      expect(verifierAgrees(reading, verifier), `${reading} ~ ${verifier}`).toBe(true);
  });
  it('still disagrees when the verifier reads a different digit, or one more or fewer', () => {
    for (const [reading, verifier] of [['16157', '161571m'], ['117197', '117191'], ['119752', '19752'], ['157492', '5惠'], ['92625', '0019262s'], ['16575', '15575'], ['2101', '210!']])
      expect(verifierAgrees(reading, verifier), `${reading} ~ ${verifier}`).toBe(false);
  });
});

describe('CTC decoding', () => {
  it('reports a digit the model nearly emitted in each gap between characters', () => {
    // Classes: blank, '1', '9', 'k'. Steps: 1, blank (1 at 0.35), 9, blank, k.
    const p = [[.1, .8, .05, .05], [.6, .35, .03, .02], [.1, .05, .8, .05], [.9, .02, .03, .05], [.1, .05, .05, .8]];
    const result = ctcDecode(p.flat(), p.length, 4, ['1', '9', 'k']);
    expect(result.text).toBe('19k');
    expect(result.doubts).toEqual([0, .35, .03, 0]);
  });
  it('places each character at the middle of its run of steps', () => {
    // Classes: blank, '1', '9'. Steps: 1 1 blank 9 blank blank (6 steps).
    const p = [[.1, .8, .1], [.1, .8, .1], [.8, .1, .1], [.1, .1, .8], [.8, .1, .1], [.8, .1, .1]];
    expect(ctcDecode(p.flat(), p.length, 3, ['1', '9']).centres).toEqual([1 / 6, 3.5 / 6]);
  });
});

describe('a detector box that cuts a glyph', () => {
  // Seven-segment "287.40" at x = 300 (scale 1.2): the "2" spans 300–367.
  const image = blank(900, 260, [8, 15, 24]);
  drawDigits(image, '287.40', 300, 60, [255, 196, 80], 1.2);
  it('is widened to the blank gap beyond the glyph it cuts', () => {
    const box = widen(image, { left: 350, right: 790, top: 50, bottom: 190 });
    expect(box.left).toBeGreaterThan(285); expect(box.left).toBeLessThan(300);
    expect(box.right).toBe(790);
  });
  it('is kept when its edge lies in a blank gap, or the ink runs on past 0.6 × its height', () => {
    const fits = { left: 290, right: 790, top: 50, bottom: 190 };
    expect(widen(image, fits)).toBe(fits);
    const bar = blank(900, 260, [8, 15, 24]);
    for (let y = 100; y < 150; y++) for (let x = 0; x < 900; x++) bar.data.set([255, 196, 80, 255], (y * 900 + x) * 4);
    const cut = { left: 350, right: 600, top: 50, bottom: 190 };
    expect(widen(bar, cut)).toBe(cut);
  });
});

describe('currency signs the first recogniser drops', () => {
  // A fake detector map with one box, and two recognisers: the first reads the
  // lone glyph as "C" at 0.17, the second (wider alphabet) as "€".
  const tensor = (data: Float32Array, dims: number[]) => ({ data, dims });
  const detector = (): OrtSession => ({ inputNames: ['x'], outputNames: ['y'], run: async feeds => {
    const [, , h, w] = (feeds.x as { dims: number[] }).dims, map = new Float32Array(h * w);
    for (let y = 8; y < 24; y++) for (let x = 40; x < 56; x++) map[y * w + x] = .9;
    return { y: { data: map, dims: [1, 1, h, w] } };
  } });
  const recogniser = (dictionary: string[], char: string, p: number): OrtSession => ({ inputNames: ['x'], outputNames: ['y'], run: async () => {
    const classes = dictionary.length + 1, steps = 4, out = new Float32Array(steps * classes);
    for (let t = 0; t < steps; t++) out[t * classes] = 1;
    out[0] = 1 - p; out[dictionary.indexOf(char) + 1] = p;
    return { y: { data: out, dims: [1, steps, classes] } };
  } });
  it('takes a sign the second recogniser reads in a box the first could not read', async () => {
    const reader = createPpocrReader({ name: 'test', det: detector(), rec: recogniser(['C', '1'], 'C', .17), dictionary: ['C', '1'], db: { thresh: .3, boxThresh: .6, unclip: 1.5 }, verifier: { rec: recogniser(['€', '₪'], '€', .97), dictionary: ['€', '₪'] } }, { tensor });
    const items = await reader.read(blank(96, 32));
    expect(items.map(i => i.text)).toEqual(['€']);
  });
  it('ignores what the second recogniser reads that is not a currency sign', async () => {
    const reader = createPpocrReader({ name: 'test', det: detector(), rec: recogniser(['C', '1'], 'C', .17), dictionary: ['C', '1'], db: { thresh: .3, boxThresh: .6, unclip: 1.5 }, verifier: { rec: recogniser(['D', '₪'], 'D', .97), dictionary: ['D', '₪'] } }, { tensor });
    expect(await reader.read(blank(96, 32))).toEqual([]);
  });
});

