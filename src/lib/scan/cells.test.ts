import { describe, expect, it } from 'vitest';
import { faintest, topBar } from './cells';
import { blank, drawDigits } from './fixtures';

// Seven-segment digits at x = 40, 78 px apart; each read at its cell's middle.
const BRIGHT = [240, 240, 240], DIM = [70, 74, 80], NIGHT = [8, 15, 24];
const band = { left: 30, right: 520, top: 50, height: 120 };
const cells = (text: string) => [...text].map((char, i) => ({ char, x: 40 + 78 * i + 28 }));

describe('a digit much fainter than its number', () => {
  it('measures unlit segments read as digits ("888" before a lit "849") as faint', () => {
    const image = blank(560, 220, NIGHT);
    drawDigits(image, '888', 40, 60, DIM); drawDigits(image, '849', 40 + 3 * 78, 60, BRIGHT);
    expect(faintest(image, band, cells('888849'))).toBeLessThan(.35);
  });
  it('measures a number lit alike, narrow "1"s included, as even', () => {
    const image = blank(560, 220, NIGHT);
    drawDigits(image, '118948', 40, 60, BRIGHT);
    expect(faintest(image, band, cells('118948'))).toBeGreaterThan(.85);
  });
});

describe('a "1" with a bar across its top', () => {
  it('measures a "7" read as "1" by its top bar, and a "1" as none', () => {
    const seven = blank(560, 220, NIGHT), one = blank(560, 220, NIGHT);
    drawDigits(seven, '279890', 40, 60, BRIGHT); drawDigits(one, '219890', 40, 60, BRIGHT);
    // Both read "219890": the second digit is a 7 in one image and a 1 in the other.
    expect(topBar(seven, band, cells('219890'))).toBeGreaterThan(.4);
    expect(topBar(one, band, cells('219890'))).toBeLessThan(.1);
  });
  it('is 0 for a number without a "1"', () => {
    const image = blank(560, 220, NIGHT);
    drawDigits(image, '279890', 40, 60, BRIGHT);
    expect(topBar(image, band, cells('279890'))).toBe(0);
  });
});
