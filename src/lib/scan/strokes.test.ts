import { describe, expect, it } from 'vitest';
import { blank, drawDigits, rect } from './fixtures';
import { strayStroke } from './strokes';

// Digits are 100 px tall; a detector box carries margin above and below.
const box = (left: number, right: number) => ({ text: '19462', left, right, top: 170, height: 160 });
describe('stray seven-segment strokes beside a recognised number', () => {
  it('finds a "1" the detector left outside the box, on the left or the right', () => {
    const image = blank(900, 480, [8, 15, 24]); drawDigits(image, '119462', 100, 200, [255, 200, 90]);
    expect(strayStroke(image, box(170, 570))).toBe(true);
    const trailing = blank(900, 480, [8, 15, 24]); drawDigits(trailing, '194621', 100, 200, [255, 200, 90]);
    expect(strayStroke(trailing, box(90, 492))).toBe(true);
  });
  it('ignores a "1" inside the box, a display frame edge and empty space', () => {
    const inside = blank(900, 480, [8, 15, 24]); drawDigits(inside, '119462', 100, 200, [255, 200, 90]);
    expect(strayStroke(inside, { ...box(90, 570), text: '119462' })).toBe(false);
    const framed = blank(900, 480, [8, 15, 24]); drawDigits(framed, '19462', 178, 200, [255, 200, 90]); rect(framed, 120, 60, 6, 380, [255, 200, 90]);
    expect(strayStroke(framed, box(170, 570))).toBe(false);
    const dark = blank(900, 480); drawDigits(dark, '19462', 178, 200);
    expect(strayStroke(dark, box(170, 570))).toBe(false);
    drawDigits(dark, '1', 100, 200);
    expect(strayStroke(dark, box(170, 570))).toBe(true);
  });
  it('does not take the letters of a label read in the same box for a stroke', () => {
    // "1" stands in for the vertical edge of an "O" in "ODO 19462".
    const image = blank(900, 480, [8, 15, 24]); drawDigits(image, '119462', 100, 200, [255, 200, 90]);
    expect(strayStroke(image, { ...box(170, 570), beside: { left: true, right: false } })).toBe(false);
    expect(strayStroke(image, { ...box(170, 570), beside: { left: false, right: true } })).toBe(true);
  });
});

describe('strokes inside the box beyond the digits read (with the recogniser\'s character positions)', () => {
  // Digit i of text drawn at x = 100 + 78 i is read at its cell's middle, x + 28.
  const at = (text: string, from = 0) => [...text].map((char, i) => ({ char, x: 100 + 78 * (i + from) + 28 }));
  it('finds a last "1" dropped inside the box ("151771" read as "15177")', () => {
    const image = blank(900, 480, [8, 15, 24]); drawDigits(image, '151771', 100, 200, [255, 200, 90]);
    const line = { ...box(90, 580), text: '15177' };
    expect(strayStroke(image, line)).toBe(false);
    expect(strayStroke(image, line, at('15177'))).toBe(true);
  });
  it('finds a lone "1" between two digits read', () => {
    const image = blank(900, 480, [8, 15, 24]); drawDigits(image, '191', 100, 200, [255, 200, 90]); drawDigits(image, '462', 100 + 4 * 78, 200, [255, 200, 90]);
    drawDigits(image, '1', 100 + 3 * 78 - 20, 200, [255, 200, 90]);
    expect(strayStroke(image, { ...box(90, 570), text: '191462' }, [...at('191'), ...at('462', 4)])).toBe(true);
  });
  it('ignores a number whose every digit was read, "1"s included', () => {
    const image = blank(900, 480, [8, 15, 24]); drawDigits(image, '119461', 100, 200, [255, 200, 90]);
    expect(strayStroke(image, { ...box(90, 580), text: '119461' }, at('119461'))).toBe(false);
  });
});
