import { describe, expect, it } from 'vitest';
import { analyzeFrame, fromText, readStill, type TextReader } from './pipeline';
import { blank, demoPhoto, drawDigits } from './fixtures';

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
    expect(fromText([{ text: '128,450 km', left: 0, right: 100, top: 0, height: 20, score: 1 }, { text: 'ODO', left: 0, right: 30, top: 30, height: 10, score: 1 }])).toEqual({
      lines: [{ left: 0, right: 100, top: 0, height: 20, text: '128450' }],
      labels: [{ left: 100, right: 120, top: 0, height: 20, text: 'km' }, { left: 0, right: 30, top: 30, height: 10, text: 'ODO' }],
    });
  });
  it('skips unusable frames without reading them', async () => {
    const dark = blank(640, 480, [2, 2, 2]);
    expect(await analyzeFrame(dark, 'odometer', 0)).toMatchObject({ quality: { usable: false, hint: 'too-dark' }, attempts: [] });
  });
});
