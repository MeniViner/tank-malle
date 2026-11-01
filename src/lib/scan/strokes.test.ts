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
