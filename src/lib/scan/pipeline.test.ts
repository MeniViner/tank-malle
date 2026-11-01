import { describe, expect, it } from 'vitest';
import { resolveOdometer, resolvePump } from './identity';
import { analyzeFrame, fromText, readStill, type TextItem, type TextReader } from './pipeline';
import { blank, demoPhoto, drawDigits, rect } from './fixtures';

/** A crisp synthetic display photographed at a higher resolution. */
function enlarge(image: ReturnType<typeof blank>, factor: number) {
  const out = blank(image.width * factor, image.height * factor);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) out.data.set(image.data.subarray(((Math.floor(y / factor) * image.width) + Math.floor(x / factor)) * 4, ((Math.floor(y / factor) * image.width) + Math.floor(x / factor)) * 4 + 4), (y * out.width + x) * 4);
  return out;
}

describe('frame pipeline', () => {
  it('reads a whole display, then corroborates it from a full-resolution recrop', async () => {
    const { decision, analysis } = await readStill(enlarge(demoPhoto('pump'), 2), 'pump');
    expect(analysis.attempts.map(a => a.path)).toEqual(['segment@960', 'segment@roi']);
    expect(decision).toMatchObject({ status: 'accepted', values: { total: '287.40', liters: '40.000' }, paths: ['segment@960', 'segment@roi'] });
  });
  it('abstains on a still whose only paths disagree with nothing to resolve identity', async () => {
    const image = blank(820, 480); drawDigits(image, '40.00', 150, 95); drawDigits(image, '287.40', 150, 285);
    expect((await readStill(image, 'pump')).decision).toMatchObject({ status: 'abstained', reason: 'unreadable' });
  });
  it('uses printed labels from a second local recogniser to resolve identity', async () => {
    const image = blank(820, 480); drawDigits(image, '40.00', 150, 95); drawDigits(image, '287.40', 150, 285);
    // A stand-in recogniser: it returns what is printed at fixed places of this fixture.
    const reader: TextReader = { name: 'stub', read: async pixels => {
      const s = pixels.width / 820 > 0 ? 1 : 1; void s;
      return [{ text: 'ש"ח', left: 600, right: 660, top: 120, height: 40, score: .9 }, { text: 'LITRES', left: 600, right: 700, top: 310, height: 40, score: .9 }];
    } };
    const analysis = await analyzeFrame(image, 'pump', 0, { textReader: reader });
    expect(analysis.attempts.find(a => a.path === 'segment@960')?.result).toMatchObject({ status: 'read', values: { total: '40.00', liters: '287.40' } });
  });
  it('splits recognised text into numbers, units and labels', () => {
    // The number's part of the box reaches to the unit (character 8 of 10);
    // the unit read with it is placed on it.
    expect(fromText([{ text: '128,450 km', left: 0, right: 100, top: 0, height: 20, score: 1 }, { text: 'ODO', left: 0, right: 30, top: 30, height: 10, score: 1 }])).toEqual({
      lines: [{ left: 0, right: 80, top: 0, height: 20, text: '128450', beside: { left: false, right: true } }],
      labels: [{ left: 0, right: 80, top: 0, height: 20, text: 'km' }, { left: 0, right: 30, top: 30, height: 10, text: 'ODO' }],
    });
    // Punctuation is narrow detector noise inside the number's box, and a
    // clock is not a number.
    expect(fromText([{ text: '237348\'', left: 0, right: 70, top: 0, height: 20, score: 1 }, { text: '6: 16', left: 0, right: 50, top: 40, height: 20, score: 1 }])).toEqual({
      lines: [{ left: 0, right: 70, top: 0, height: 20, text: '237348' }],
      labels: [{ left: 0, right: 50, top: 40, height: 20, text: '6: 16' }],
    });
  });
  it('does not join neighbouring dial numbers into one long number', () => {
    const item = (text: string) => ({ text, left: 0, right: 100, top: 0, height: 20, score: 1 });
    expect(fromText([item('100 120')]).lines.map(l => l.text)).toEqual(['100', '120']);
    expect(fromText([item('16 1563km')]).lines.map(l => l.text)).toEqual(['161563']);
    expect(fromText([item('0023 1755')]).lines.map(l => l.text)).toEqual(['00231755']);
  });
  it('recrops a padded register for its second path', async () => {
    // Printed digits only the (stub) recogniser reads; its first read locates them.
    // A textured scene (usable quality) with no seven-segment digits in it.
    const image = blank(1600, 1000);
    for (let y = 0; y < 1000; y += 40) for (let x = (y / 40) % 2 * 40; x < 1600; x += 80) rect(image, x, y, 40, 40, [90, 100, 95]);
    const reader: TextReader = { name: 'stub', read: async pixels => [{ text: '00236096km', left: pixels.width * .3, right: pixels.width * .7, top: pixels.height * .45, height: pixels.height * .1, score: .9 }] };
    const { decision, analysis } = await readStill(image, 'odometer', { textReader: reader });
    expect(analysis.attempts.map(a => a.path)).toEqual(expect.arrayContaining(['stub@960', 'stub@roi']));
    expect(decision).toMatchObject({ status: 'accepted', values: { odometer: '236096' }, paths: ['stub@960', 'stub@roi'] });
  });
  it('skips unusable frames without reading them', async () => {
    const dark = blank(640, 480, [2, 2, 2]);
    expect(await analyzeFrame(dark, 'odometer', 0)).toMatchObject({ quality: { usable: false, hint: 'too-dark' }, attempts: [] });
  });
});

/** A recognised box at a row of a display; characters are 10 px wide. */
const box = (text: string, top = 0, left = 0): TextItem => ({ text, left, right: left + text.trim().length * 10, top, height: 20, score: 1 });
const odometer = (...items: TextItem[]) => { const { lines, labels } = fromText(items, 'odometer'); return resolveOdometer(lines, labels); };
describe('text boxes that hold a label and a number', () => {
  it('keeps the number and its label whichever side the label is on', () => {
    for (const text of ['ODO 128450', '128450 ODO', 'ODO128450', 'ODO: 128,450 km'])
      expect(odometer(box(text)), text).toMatchObject({ status: 'resolved', values: { odometer: '128450' }, evidence: expect.arrayContaining(['label:odometer']) });
    expect(fromText([box('ODO 128450')]).lines).toEqual([{ text: '128450', left: 30, right: 100, top: 0, height: 20, beside: { left: true, right: false } }]);
  });
  it('keeps a trip meter with its own label, beside or below the odometer', () => {
    const { lines, labels } = fromText([box('TRIP 84.9')], 'odometer');
    expect(lines.map(l => l.text)).toEqual(['84.9']);
    expect(labels).toEqual([{ text: 'TRIP', left: 40, right: 90, top: 0, height: 20 }]);
    expect(odometer(box('ODO 128450'), box('TRIP 84.9', 40))).toMatchObject({ status: 'resolved', values: { odometer: '128450' } });
    expect(odometer(box('TRIP A 84.9'), box('ODO 128450', 40))).toMatchObject({ status: 'resolved', values: { odometer: '128450' } });
    // A whole-number trip meter is still a trip meter.
    expect(odometer(box('ODO 128450'), box('TRIP 12345', 40))).toMatchObject({ status: 'resolved', values: { odometer: '128450' } });
    expect(odometer(box('ODO 128450', 0), box('TRIP 12345', 0, 140))).toMatchObject({ status: 'resolved', values: { odometer: '128450' } });
  });
  it('never accepts a number whose own label says it is something else', () => {
    expect(odometer(box('TRIP 128450'))).toMatchObject({ status: 'abstain' });
    expect(odometer(box('128450 mi'))).toMatchObject({ status: 'abstain', reason: 'unit-miles' });
    expect(odometer(box('A 128450'))).toMatchObject({ status: 'abstain' });
    // A label between two numbers of one box could belong to either.
    expect(odometer(box('ODO 128450 TRIP 84.9'))).toMatchObject({ status: 'abstain' });
    // A label beside a number that does not parse is not moved to another one.
    expect(odometer(box("ODO 128'450"), box('42', 0, 120))).toMatchObject({ status: 'abstain' });
  });
  it('makes a number unsure when an unknown word beside it may be a misread digit', () => {
    for (const text of ['I 28450', 'l28450', 'S 28450', '28450 x']) {
      expect(fromText([box(text)], 'odometer').lines[0], text).toMatchObject({ text: '28450', contested: 'text' });
      expect(odometer(box(text)), text).toMatchObject({ status: 'abstain' });
    }
    // A lone "m" is a "km" missing its k; a unit glued to the digits is a unit.
    expect(odometer(box('128450m'))).toMatchObject({ status: 'resolved', values: { odometer: '128450' } });
    expect(odometer(box('128450km'))).toMatchObject({ status: 'resolved', values: { odometer: '128450' } });
  });
  it('keeps pump labels and decimals read with the numbers', () => {
    const { lines, labels } = fromText([box('SALE 287.40'), box('LITRES 40.00', 40), box('PRICE 7.185', 80)], 'pump');
    expect(lines.map(l => [l.text, l.contested])).toEqual([['287.40', undefined], ['40.00', undefined], ['7.185', undefined]]);
    expect(resolvePump(lines, labels)).toMatchObject({ status: 'resolved', values: { total: '287.40', liters: '40.00', unitPrice: '7.185' } });
    expect(fromText([box('12.34 L')], 'pump').lines[0]).not.toHaveProperty('contested');
    // "l" is a litre unit on a pump and a look-alike "1" on an odometer.
    expect(fromText([box('l28450')], 'odometer').lines[0].contested).toBe('text');
  });
});

describe('decimal commas, foreign currency and nearly-read digits', () => {
  it('reads a comma before one or two final digits as a decimal comma, and leaves 1,109 ambiguous', () => {
    expect(fromText([box('58,57'), box('52,81', 40), box('1,109', 80)], 'pump').lines.map(l => l.text)).toEqual(['58.57', '52.81', '1109']);
    expect(fromText([box('128,450 km')], 'odometer').lines.map(l => l.text)).toEqual(['128450']);
  });
  it('never fills an amount shown in another currency as shekels', () => {
    const { lines, labels } = fromText([box('58,57 €'), box('52,81 Litres', 40)], 'pump');
    expect(resolvePump(lines, labels)).toEqual({ status: 'abstain', reason: 'foreign-currency' });
    // Frozen fixture set (fixtures-frozen-2026-11-02): the sign read in one box with its word.
    for (const sale of ['SALE €', 'TOTAL EUR', 'Ft fizetendő'])
      expect(resolvePump(fromText([box('146.33'), box('19.33', 40)], 'pump').lines, [{ text: sale, left: 200, right: 300, top: 0, height: 20 }]), sale).toEqual({ status: 'abstain', reason: 'foreign-currency' });
    // Moroccan pump (Commons): DIRHAMS / LITRES, litres to two places.
    const dirhams = fromText([box('300.00'), box('19.62', 40)], 'pump');
    expect(resolvePump(dirhams.lines, [{ text: 'DIRHAMS', left: 200, right: 300, top: 0, height: 20 }])).toEqual({ status: 'abstain', reason: 'foreign-currency' });
    const shekels = fromText([box('58.57 ₪'), box('52.810 LITRES', 40)], 'pump');
    expect(resolvePump(shekels.lines, shekels.labels)).toMatchObject({ status: 'resolved', values: { total: '58.57', liters: '52.810' } });
  });
  it('makes a number unsure when the recogniser nearly read a digit between it and a glued word', () => {
    // "190061km" read as "19006km": a blank step between "6" and "k" where "1" had 0.25.
    const doubts = [0, 0, 0, 0, 0, .25, 0, 0];
    const [line] = fromText([{ ...box('19006km'), doubts }], 'odometer').lines;
    expect(line).toMatchObject({ text: '19006', doubt: .25, contested: 'doubt' });
    expect(fromText([{ ...box('19006km'), doubts: [0, 0, 0, 0, 0, .15, 0, 0] }], 'odometer').lines[0]).not.toHaveProperty('contested');
    // With a space before the unit the gap is layout, not a glued edge.
    expect(fromText([{ ...box('19006 km'), doubts: [0, 0, 0, 0, 0, .9, 0, 0, 0] }], 'odometer').lines[0].doubt).toBe(0);
    expect(fromText([{ ...box('19006km'), doubts: [0, 0, 0, 0, 0, 0, 0, .9] }], 'odometer').lines[0].doubt).toBe(0);
    expect(fromText([{ ...box('1 15605'), doubts: [0, 0, .6, 0, 0, 0, 0, 0] }], 'odometer').lines[0].doubt).toBe(0);
  });
  it('records the near-miss at either edge, over spaces the recogniser emitted there, and where each digit was read', () => {
    // "151771" read as "15 177 ": a "1" at 0.43 after the trailing space.
    const [line] = fromText([{ ...box('15 177 '), doubts: [0, .01, .01, .01, 0, .01, 0, .43], centres: [10, 20, 30, 40, 50, 60, 70] }], 'odometer').lines;
    expect(line).toMatchObject({ text: '15177', edge: .43, doubt: 0 });
    expect(line).not.toHaveProperty('contested');
    expect(line.cells).toEqual([{ char: '1', x: 10 }, { char: '5', x: 20 }, { char: '1', x: 40 }, { char: '7', x: 50 }, { char: '7', x: 60 }]);
  });
});

describe('printed words beside segment digits', () => {
  /** A pump whose rows have printed words beside them, as SVG text. */
  async function labelledPump() {
    const sharp = (await import('sharp')).default, ink = [255, 196, 80], base = blank(1100, 600, [8, 15, 24]);
    drawDigits(base, '287.40', 120, 60, ink); drawDigits(base, '40.000', 120, 250, ink);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="600"><text x="620" y="135" font-family="Arial" font-size="52" fill="rgb(${ink})">SALE</text><text x="620" y="325" font-family="Arial" font-size="52" fill="rgb(${ink})">LITRES</text></svg>`;
    const { data, info } = await sharp(Buffer.from(base.data), { raw: { width: 1100, height: 600, channels: 4 } }).composite([{ input: Buffer.from(svg) }]).raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
  }
  // A stub recogniser that reads only the printed words of the whole frame
  // (as if it could not read the seven-segment digits).
  const words = (found: { text: string; x: number; y: number; w: number }[]): TextReader => ({ name: 'stub', read: async pixels => {
    if (pixels.width !== 960) return [];
    const k = 960 / 1100;
    return found.map(({ text, x, y, w }) => ({ text, left: (x - 20) * k, right: (x + w + 20) * k, top: (y - 20) * k, height: 80 * k, score: .9, core: { left: x * k, right: (x + w) * k, top: y * k, height: 40 * k } }));
  } });
  it('reads the rows again with the words painted over, and keeps the words as labels', async () => {
    const image = await labelledPump();
    expect((await readStill(image, 'pump')).decision).toMatchObject({ status: 'abstained' });
    const { decision, analysis } = await readStill(image, 'pump', { textReader: words([{ text: 'SALE', x: 620, y: 97, w: 130 }, { text: 'LITRES', x: 620, y: 287, w: 175 }]) });
    expect(decision).toMatchObject({ status: 'accepted', values: { total: '287.40', liters: '40.000' }, paths: ['segment-painted@960', 'segment-painted@roi'] });
    expect(analysis.attempts.find(a => a.path === 'segment-painted@960')?.result).toMatchObject({ evidence: expect.arrayContaining(['label:total', 'label:liters']) });
  });
  it('never paints a word that could be a misread number', async () => {
    const image = await labelledPump();
    const { decision } = await readStill(image, 'pump', { textReader: words([{ text: 'SOB', x: 620, y: 97, w: 130 }, { text: 'IO', x: 620, y: 287, w: 175 }]) });
    expect(decision.status).toBe('abstained');
  });
});

