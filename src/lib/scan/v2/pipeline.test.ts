import { describe, expect, it } from 'vitest';
import { blank, demoPhoto, drawDigits } from '../fixtures';
import { scanV2 } from './pipeline';
import { guideRect } from './guide';

// Synthetic renderings only: mechanism checks, never accuracy evidence.
describe('scan v2 pipeline (synthetic)', () => {
  it('reads a generated pump display into top-3 candidates and a consistent selection', () => {
    const result = scanV2(demoPhoto('pump'), 'pump');
    expect(result.status).toBe('candidates');
    expect(result.fields.total?.[0].text).toBe('287.40');
    expect(result.fields.liters?.[0].text).toBe('40.000');
    expect(result.fields.total!.length).toBeLessThanOrEqual(3);
    expect(result.pump?.total?.text).toBe('287.40');
    expect(result.pump?.consistent).toBe(true);
  });

  it('reads a generated light-on-dark odometer', () => {
    const result = scanV2(demoPhoto('odometer'), 'odometer');
    expect(result.status).toBe('candidates');
    expect(result.fields.odometer?.[0].text).toBe('128450');
    expect(result.odometer?.odometer?.text).toBe('128450');
  });

  it('uses the price row: total ≈ liters × price picks among candidates', () => {
    const image = blank(820, 640);
    drawDigits(image, '320.08', 150, 60);
    drawDigits(image, '44.332', 150, 250);
    drawDigits(image, '7.22', 150, 440);
    const result = scanV2(image, 'pump');
    expect(result.fields.price?.[0].text).toBe('7.22');
    expect(result.pump?.checks.find(c => c.name === 'total≈liters×price')?.status).toBe('ok');
  });

  it('inserts a missing decimal point as a low-confidence character', () => {
    const image = blank(820, 480);
    drawDigits(image, '28740', 150, 95);
    drawDigits(image, '40.000', 150, 285);
    const result = scanV2(image, 'pump');
    const total = result.fields.total?.[0];
    expect(total?.text).toBe('287.40');
    const dot = total!.digits!.find(d => d.char === '.')!;
    expect(dot.confidence).toBeLessThan(.5);
  });

  it('reads only inside the guide box', () => {
    const image = blank(800, 600, [8, 15, 24]);
    drawDigits(image, '265408', 70, 240, [40, 170, 255], .9);
    drawDigits(image, '999999', 70, 20, [40, 170, 255], .9);
    const result = scanV2(image, 'odometer', {}, { crop: guideRect(800, 600, 'odometer') });
    expect(result.fields.odometer?.[0].text).toBe('265408');
    expect(result.fields.odometer?.some(c => c.text === '999999')).toBe(false);
  });

  it('returns nothing-found for a blank frame and invalid-image for malformed input', () => {
    expect(scanV2(blank(400, 300), 'odometer').status).toBe('nothing-found');
    expect(scanV2({ width: 10, height: 10, data: [] }, 'pump').status).toBe('invalid-image');
  });

  it('applies the odometer window from the last reading', () => {
    const image = blank(820, 480, [8, 15, 24]);
    drawDigits(image, '128450', 130, 60, [40, 170, 255]);
    drawDigits(image, '131200', 130, 280, [40, 170, 255]);
    const result = scanV2(image, 'odometer', { lastOdometer: 130500 });
    expect(result.odometer?.odometer?.text).toBe('131200');
    expect(result.odometer?.consistent).toBe(true);
  });
});
