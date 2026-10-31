import { describe, expect, it } from 'vitest';
import { recognizeDisplay } from './automaticDisplay';
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
