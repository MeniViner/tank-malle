import { describe, expect, it } from 'vitest';
import { blank, drawDigits, lineFixture } from '../fixtures';
import { preprocess } from './preprocess';
import { PATTERNS, components, decodeSegments, dilate, kBestStrings, readLines, sampleSegments, type DigitCell } from './recognise';

const coverage = (pattern: string, on = .95, off = .03) => [...pattern].map(c => c === '1' ? on : off);

describe('scan v2 seven-segment decoder', () => {
  it('decodes every clean pattern as its digit with three ranked options', () => {
    for (const [digit, pattern] of Object.entries(PATTERNS)) {
      const result = decodeSegments(coverage(pattern));
      expect(result.options[0].digit).toBe(digit);
      expect(result.options).toHaveLength(3);
      expect(result.options[0].p).toBeGreaterThan(result.options[1].p);
      expect(result.fit).toBeGreaterThan(.85);
    }
  });

  it('keeps the plausible alternative for an unclear segment instead of refusing', () => {
    // An 8 whose lower-left stroke is half lit: 8 vs 9 are the top two.
    const result = decodeSegments([.95, .95, .95, .95, .45, .95, .95]);
    expect(result.options.map(o => o.digit).slice(0, 2).sort()).toEqual(['8', '9']);
    expect(result.options[0].p).toBeLessThan(.8);
  });

  it('accepts tail-less 6 and 9 and a 7 with a left stroke', () => {
    expect(decodeSegments(coverage('0011111')).options[0].digit).toBe('6');
    expect(decodeSegments(coverage('1110011')).options[0].digit).toBe('9');
    expect(decodeSegments(coverage('1110010')).options[0].digit).toBe('7');
  });

  it('reports poor fit for a blob that is no digit', () => {
    expect(decodeSegments([.5, .5, .5, .5, .5, .5, .5]).fit).toBeLessThan(.7);
    expect(decodeSegments([.5, .5, .5, .5, .5, .5, .5]).fit).toBeLessThan(decodeSegments(coverage(PATTERNS['8'])).fit - .25);
  });

  it('samples segment coverage from a rendered digit', () => {
    const image = lineFixture('2');
    const { binary } = preprocess(image, { polarity: 'dark-on-light', deskew: false, offset: 20 });
    const segments = sampleSegments(binary, { x: 12, y: 16, width: 56, height: 100 });
    expect(segments.map(v => v > .5 ? '1' : '0').join('')).toBe(PATTERNS['2']);
  });

  it('finds connected components and dilates gaps', () => {
    const data = new Uint8Array(20 * 10);
    for (let x = 2; x < 6; x++) data[3 * 20 + x] = 1;
    for (let x = 7; x < 10; x++) data[3 * 20 + x] = 1;
    const b = { width: 20, height: 10, data };
    expect(components(b, 1)).toHaveLength(2);
    expect(components(dilate(b, 1, 0), 1)).toHaveLength(1);
  });

  it('reads rows top to bottom with a decimal point and a colon', () => {
    const image = blank(820, 640);
    drawDigits(image, '287.40', 120, 40);
    drawDigits(image, '1234', 120, 260);
    // Colon: two dots at mid-height between the 2nd and 3rd digits.
    drawDigits(image, '9', 120, 460); drawDigits(image, '45', 280, 460);
    for (const dy of [30, 70]) for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) image.data.set([15, 29, 23, 255], ((460 + dy + y) * 820 + 220 + x) * 4);
    const { binary } = preprocess(image, { polarity: 'dark-on-light', offset: 20, deskew: false });
    const lines = readLines(binary, { minHeight: 30 });
    expect(lines.map(l => l.cells.map(c => c.options[0].digit).join(''))).toEqual(['28740', '1234', '945']);
    expect(lines[0].separators).toEqual([{ kind: 'dot', after: 2 }]);
    expect(lines[1].separators).toEqual([]);
    expect(lines[2].separators).toEqual([{ kind: 'colon', after: 0 }]);
  });

  it('enumerates the k best strings by joint probability', () => {
    const cell = (options: [string, number][]): DigitCell => ({ box: { x: 0, y: 0, width: 1, height: 1 }, fit: 1, segments: [], options: options.map(([digit, p]) => ({ digit, p })) });
    const cells = [cell([['1', .9], ['7', .1], ['4', 0]]), cell([['8', .6], ['9', .35], ['0', .05]])];
    const best = kBestStrings(cells, 3);
    expect(best.map(b => b.text)).toEqual(['18', '19', '78']);
    expect(Math.exp(best[0].logP)).toBeCloseTo(.54);
    const dotted = kBestStrings(cells, 1, 0, .3);
    expect(dotted[0].text).toBe('1.8');
    expect(dotted[0].digits.map(d => d.char)).toEqual(['1', '.', '8']);
    expect(dotted[0].digits[1].confidence).toBe(.3);
  });
});
