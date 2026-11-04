import { describe, expect, it } from 'vitest';
import { decideDisplay, recognizeDisplay } from './automaticDisplay';
import { checkPixels, fromText, readStill, type TextItem, type TextReader } from './pipeline';
import { rect } from './fixtures';
import { blank, drawDigits } from './fixtures';
import { resolveOdometer, resolvePump, type LabelToken, type NumericLine } from './identity';
import { automaticPumpPlausible } from './acceptance';
import { reviewedScan } from './draft';

// Synthetic reproductions of failures confirmed against the 1.6.0 reader. They
// prove the mechanism only; real-display accuracy is measured by the benchmark.
const NIGHT = [8, 15, 24], BLUE = [40, 170, 255];
const line = (text: string, top: number, left = 150, height = 100): NumericLine => ({ text, top, left, right: left + text.length * 70, height });
const label = (text: string, top: number, left: number, height = 30): LabelToken => ({ text, top, left, right: left + text.length * 18, height });

describe('confirmed scan failures', () => {
  it('reads dark segments on a light odometer LCD', () => {
    const image = blank(820, 480); drawDigits(image, '128450', 130, 190);
    expect(recognizeDisplay(image, 'odometer')).toMatchObject({ status: 'read', values: { odometer: '128450' } });
  });
  for (const text of ['171717', '117110', '711171'])
    it(`reads an odometer dominated by ones and sevens: ${text}`, () => {
      const image = blank(820, 480, NIGHT); drawDigits(image, text, 130, 190, BLUE);
      expect(recognizeDisplay(image, 'odometer')).toMatchObject({ status: 'read', values: { odometer: text } });
    });
  it('rejects mileage below 1,000 without identity evidence and accepts it with an ODO label beside it', () => {
    const image = blank(820, 480, NIGHT); drawDigits(image, '850', 250, 190, BLUE);
    expect(recognizeDisplay(image, 'odometer')).toEqual({ status: 'unreadable', reason: 'identity-ambiguous' });
    expect(recognizeDisplay(image, 'odometer', [{ text: 'ODO', left: 500, right: 560, top: 250, height: 40 }])).toMatchObject({ status: 'read', values: { odometer: '850' } });
    // "km" is also printed beside trips, ranges and speeds.
    expect(recognizeDisplay(image, 'odometer', [{ text: 'km', left: 500, right: 540, top: 250, height: 40 }])).toMatchObject({ status: 'unreadable', reason: 'identity-ambiguous' });
    expect(resolveOdometer([line('42', 100)], [label('ODO', 120, 400)])).toMatchObject({ status: 'resolved', values: { odometer: '42' } });
    // A label above a short number may belong to something else on the dial.
    expect(resolveOdometer([line('42', 100)], [label('ODO', 60, 150)])).toMatchObject({ status: 'abstain', reason: 'identity-ambiguous' });
    expect(resolveOdometer([line('128450', 100)], [label('ODO', 60, 150)])).toMatchObject({ status: 'resolved', values: { odometer: '128450' } });
    // Speedometer scale numbers next to a printed "km" are not an odometer.
    expect(resolveOdometer(['160', '180', '200'].map((t, i) => line(t, 100 + i * 120)), [label('km', 360, 400)])).toMatchObject({ status: 'abstain' });
    // An unsure long number blocks acceptance of anything else in the frame.
    expect(resolveOdometer([line('128450', 60), { ...line('49028', 250), contested: 'edge' }])).toMatchObject({ status: 'abstain', reason: 'identity-ambiguous' });
  });
  // TRODO tuning photographs (00000171, 00000215, …): the recogniser read the
  // register correctly with its padding zeros, and identity refused eight characters.
  it('reads a zero-padded register as the number it pads, never as a second reading', () => {
    expect(resolveOdometer([line('00236096', 100)])).toMatchObject({ status: 'resolved', values: { odometer: '236096' } });
    expect(resolveOdometer([line('00236096', 100), line('236096', 300)])).toMatchObject({ status: 'resolved', values: { odometer: '236096' } });
    expect(resolveOdometer([line('00236096', 100), line('236090', 300)])).toMatchObject({ status: 'abstain', reason: 'identity-ambiguous' });
    // The displayed zeros still count as the register's length; more than seven significant digits do not parse.
    expect(resolveOdometer([line('000000123', 100)])).toMatchObject({ status: 'resolved', values: { odometer: '123' } });
    expect(resolveOdometer([line('012345678', 100)])).toMatchObject({ status: 'abstain' });
  });
  // Frozen fixture set (fixtures-frozen-2026-11-01, g016): amount 233.83, volume
  // 34.91, price 6.698. The amount row was lost from a crop, and 34.91 / 6.698
  // looked like a 2-place amount beside a 3-place volume.
  it('never reads a pump whose amount row is missing from the panel it decided on', async () => {
    const rows = (...texts: [string, number][]) => [{ polarity: 'light' as const, stable: texts.map(([text, top]) => ({ ...line(text, top, 150, 60), polarity: 'light' as const, support: 2 })), conflicts: [] }];
    expect(decideDisplay(rows(['34.91', 200], ['6.698', 300]), 'pump')).toMatchObject({ status: 'read', values: { total: '34.91', liters: '6.698' } });
    // A cut row above, in the same column, too small to join the panel.
    expect(decideDisplay([{ ...rows(['34.91', 200], ['6.698', 300])[0], stable: [...rows(['34.91', 200], ['6.698', 300])[0].stable, { ...line('205.05', 40, 150, 20), polarity: 'light', support: 2 }] }], 'pump')).toEqual({ status: 'unreadable', reason: 'identity-ambiguous' });
    // In the pipeline: the whole frame shows three rows (the amount unsure);
    // the central region, which holds only the lower two, is not read.
    const image = blank(1600, 1000);
    for (let y = 0; y < 1000; y += 40) for (let x = (y / 40) % 2 * 40; x < 1600; x += 80) rect(image, x, y, 40, 40, [90, 100, 95]);
    const reader: TextReader = { name: 'stub', read: async pixels => pixels.width === 960
      ? [{ text: '233.83', left: 300, right: 520, top: 120, height: 60, score: .9, contested: 'verifier', verifierText: '205.05' }, { text: '34.91', left: 300, right: 500, top: 280, height: 60, score: .9 }, { text: '6.698', left: 300, right: 500, top: 440, height: 60, score: .9 }]
      : [{ text: '34.91', left: pixels.width * .3, right: pixels.width * .6, top: pixels.height * .3, height: pixels.height * .1, score: .9 }, { text: '6.698', left: pixels.width * .3, right: pixels.width * .6, top: pixels.height * .6, height: pixels.height * .1, score: .9 }] };
    const { decision, analysis } = await readStill(image, 'pump', { textReader: reader });
    expect(analysis.attempts.map(a => a.path)).not.toContain('stub@centre');
    expect(decision.status).toBe('abstained');
  });
  // TRODO challenge 00000170 (a trip "84.9" with unlit "888" before it, read
  // as 888849) and test 00001307 ("151771" read as "15177", a "1" at 0.43
  // after the last "7"). The stub reader answers as the recogniser did, with
  // where it read each character; the pixels decide.
  const traced = async (image: ReturnType<typeof blank>, item: TextItem) => checkPixels(image, fromText([item], 'odometer').lines)[0];
  const cellsAt = (text: string, x: number) => [...text].map((_, i) => x + 78 * i + 28);
  it('measures unlit segments read as digits as faint, without acting on it (still an open failure)', async () => {
    const image = blank(960, 540, NIGHT); drawDigits(image, '888', 200, 200, [50, 54, 60]); drawDigits(image, '849', 200 + 3 * 78, 200, [240, 240, 240]);
    const ghost = await traced(image, { text: '888849', left: 190, right: 680, top: 180, height: 140, score: .9, doubts: [0, 0, 0, 0, 0, 0, 0], centres: cellsAt('888849', 200) });
    expect(ghost.faint).toBeLessThan(.2);
    // FAINT_DIGIT is 0: on real displays the measure did not separate unlit
    // segments from unevenly lit digits (paired-failures.json).
    expect(ghost).not.toHaveProperty('contested');
  });
  it('makes a number unsure when a digit stroke in its box went unread and a digit was nearly read there', async () => {
    const image = blank(960, 540, NIGHT); drawDigits(image, '151771', 200, 200, BLUE);
    const item = { text: '15 177 ', left: 190, right: 690, top: 180, height: 140, score: .9, centres: [228, 306, 345, 384, 462, 540, 600] };
    expect(await traced(image, { ...item, doubts: [0, .01, .01, .01, 0, .01, 0, .43] })).toMatchObject({ text: '15177', contested: 'stroke' });
    // The same stroke without the near-miss, or the near-miss without a stroke, is not enough.
    expect(await traced(image, { ...item, doubts: [0, .01, .01, .01, 0, .01, 0, .1] })).not.toHaveProperty('contested');
    const read = blank(960, 540, NIGHT); drawDigits(read, '15177', 200, 200, BLUE);
    expect(await traced(read, { ...item, doubts: [0, .01, .01, .01, 0, .01, 0, .43] })).not.toHaveProperty('contested');
  });
  // Camera replay of the seven-segment pump: after 4:2:0 colour subsampling
  // the gray channel found only the volume row and the value channel only the
  // amount row, so neither formed a panel.
  it('reads a pump from the light and value channels together when they agree where they overlap', () => {
    const rows = (polarity: 'light' | 'value', ...texts: [string, number][]) => ({ polarity, stable: texts.map(([text, top]) => ({ ...line(text, top, 150, 60), polarity, support: 2 })), conflicts: [] });
    expect(decideDisplay([rows('light', ['40.000', 300]), rows('value', ['287.40', 120])], 'pump')).toMatchObject({ status: 'read', values: { total: '287.40', liters: '40.000' } });
    // Each alone: no panel.
    expect(decideDisplay([rows('light', ['40.000', 300])], 'pump')).toEqual({ status: 'unreadable', reason: 'format' });
    // Channels that read an overlapping row differently are not merged: no
    // reading takes one channel's volume beside the other's amount.
    expect(decideDisplay([rows('light', ['40.000', 300]), rows('value', ['287.40', 120], ['40.008', 300])], 'pump')).not.toMatchObject({ values: { liters: '40.000' } });
  });
  it('does not assign pump fields by row order', () => {
    const swapped = blank(820, 480); drawDigits(swapped, '26.092', 150, 95); drawDigits(swapped, '202.73', 150, 285);
    expect(recognizeDisplay(swapped, 'pump')).toMatchObject({ status: 'read', values: { total: '202.73', liters: '26.092' } });
    const unresolved = blank(820, 480); drawDigits(unresolved, '40.00', 150, 95); drawDigits(unresolved, '287.40', 150, 285);
    expect(recognizeDisplay(unresolved, 'pump')).toEqual({ status: 'unreadable', reason: 'identity-ambiguous' });
  });
  it('abstains on ambiguous field identity and resolves it only from printed labels', () => {
    const rows = [line('202.73', 60), line('26.092', 250), line('7.77', 440)];
    // The product identifies the amount but cannot tell volume from unit price.
    expect(resolvePump(rows)).toMatchObject({ status: 'abstain', reason: 'identity-ambiguous' });
    expect(resolvePump(rows, [label('LITRES', 270, 620)])).toMatchObject({ status: 'resolved', values: { total: '202.73', liters: '26.092', unitPrice: '7.77' } });
    // Labels decide, not an expected price: the same rows with LITRES beside 7.77.
    expect(resolvePump(rows, [label('LITRES', 460, 620)])).toMatchObject({ status: 'resolved', values: { liters: '7.77', unitPrice: '26.092' } });
    expect(resolvePump(rows, [label('LITRES', 270, 620), label('LITRES', 460, 620)])).toMatchObject({ status: 'abstain', reason: 'format' });
    expect(resolvePump([line('40.00', 60), line('287.40', 250)], [label('₪', 80, 620), label('ליטרים', 270, 620)])).toMatchObject({ status: 'resolved', values: { total: '40.00', liters: '287.40' } });
    const image = blank(820, 480, NIGHT); drawDigits(image, '1254', 200, 190, BLUE);
    expect(recognizeDisplay(image, 'odometer')).toEqual({ status: 'unreadable', reason: 'identity-ambiguous' });
    expect(resolveOdometer([line('128450', 60), line('1254', 250)], [label('TRIP A', 270, 470)])).toMatchObject({ status: 'resolved', values: { odometer: '128450' } });
    expect(resolveOdometer([line('128450', 60)], [label('TRIP', 80, 600)])).toEqual({ status: 'abstain', reason: 'trip-meter' });
    expect(resolveOdometer([line('128450', 60)], [label('mi', 80, 600)])).toEqual({ status: 'abstain', reason: 'unit-miles' });
    expect(resolveOdometer([line('128450', 60), line('265408', 250)])).toMatchObject({ status: 'abstain', reason: 'identity-ambiguous' });
  });
  it('blocks swapped values from automatic acceptance while manual review stays unrestricted', () => {
    // The ordinary review form still accepts what a person types.
    expect(reviewedScan({ total: '26.092', liters: '202.73', odometer: '1' })).not.toBeNull();
    expect(automaticPumpPlausible({ total: '26.092', liters: '202.73' })).toBe(false);
    expect(automaticPumpPlausible({ total: '202.73', liters: '26.092' })).toBe(true);
  });
});
