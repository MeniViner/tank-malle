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

