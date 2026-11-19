import { describe, expect, it } from 'vitest';
import { blank, demoPhoto, drawDigits, lineFixture } from '../fixtures';
import { ACCEPT, acceptOdometer, recognizeDisplay } from './index';
import { oneApart, scanPhoto } from './read';

describe('scan engine on synthetic displays', () => {
  it('reads the demo pump (amount, litres and the price row that proves them)', () => {
    const r = recognizeDisplay(demoPhoto('pump'), 'pump');
    expect(r).toMatchObject({ status: 'read', values: { total: '287.60', liters: '40.000' } });
    expect(scanPhoto(demoPhoto('pump'), 'pump').pump[0].price).toBe('7.19');
  });
  it('finishes an amount whose last digit was not seen from the litres and the one price that fits', () => {
    // Real case: 226.13 beside the dark bezel read as "226.1"; 28.806 L at 7.85 = 226.13. No price row is shown.
    const photo = (total: string, liters: string) => { const image = blank(820, 640); drawDigits(image, total, 150, 70); drawDigits(image, liters, 150, 255); return image; };
    const r = recognizeDisplay(photo('226.1', '28.806'), 'pump');
    expect(r).toMatchObject({ status: 'read', values: { total: '226.13', liters: '28.806' } });
    expect(scanPhoto(photo('226.1', '28.806'), 'pump').pump[0].price).toBeNull();
    // A complete amount is still read as printed.
    expect(recognizeDisplay(photo('226.13', '28.806'), 'pump')).toMatchObject({ status: 'read', values: { total: '226.13', liters: '28.806' } });
    // Litres that no price in range turns into an amount starting 226.1: nothing is invented.
    expect(recognizeDisplay(photo('226.1', '30.000'), 'pump').status).toBe('unreadable');
  });
  it('reads the demo odometer and prefers the journal-consistent reading', () => {
    expect(recognizeDisplay(demoPhoto('odometer'), 'odometer')).toMatchObject({ status: 'read', values: { odometer: '128450' } });
    expect(recognizeDisplay(demoPhoto('odometer'), 'odometer', { lastOdometer: 128000 })).toMatchObject({ status: 'read', values: { odometer: '128450' } });
  });
  it('a reading behind the journal is doubted but a far-ahead one (stale journal) still passes', () => {
    const ahead = recognizeDisplay(demoPhoto('odometer'), 'odometer', { lastOdometer: 90000 });
    expect(ahead.status).toBe('read');
    const behind = scanPhoto(demoPhoto('odometer'), 'odometer', { lastOdometer: 130000 }).odometer[0];
    expect(behind.confidence).toBeLessThan(scanPhoto(demoPhoto('odometer'), 'odometer').odometer[0].confidence * .5);
  });
  it('reads light-on-dark and dark-on-light rows at other sizes', () => {
    for (const options of [{ blue: true, scale: .6 }, { light: true, scale: 1.4 }, { scale: .45 }]) {
      const r = scanPhoto(lineFixture('170549', options), 'odometer');
      expect(r.odometer[0]?.text, JSON.stringify(options)).toBe('170549');
    }
  });
  it('refuses a blank picture, a wrong-sized buffer and a pump with no coherent sale', () => {
    const blank = { width: 300, height: 200, data: new Uint8ClampedArray(300 * 200 * 4).fill(120) };
    expect(recognizeDisplay(blank, 'odometer')).toEqual({ status: 'unreadable' });
    expect(recognizeDisplay({ width: 300, height: 200, data: new Uint8ClampedArray(10) }, 'pump')).toEqual({ status: 'unreadable' });
    const r = recognizeDisplay(lineFixture('170549'), 'pump');
    expect(r.status).toBe('unreadable');
    expect(ACCEPT.pump).toBeGreaterThan(0);
  });
  it('treats readings one segment or one edge digit apart as rivals', () => {
    expect(oneApart('120273', '120279')).toBe(true);
    expect(oneApart('119462', '1119462')).toBe(true);
    expect(oneApart('186351', '18635')).toBe(true);
    expect(oneApart('186351', '86351')).toBe(true);
    expect(oneApart('186351', '186351')).toBe(false);
    expect(oneApart('120273', '120299')).toBe(false);
    expect(oneApart('186351', '8635')).toBe(false);
  });
  it('asks more of an odometer reading when the journal has nothing to check it against', () => {
    const c = (ACCEPT.odometer + ACCEPT.odometerFirst) / 2;
    expect(acceptOdometer(c, { lastOdometer: 120000 })).toBe(true);
    expect(acceptOdometer(c)).toBe(false);
    expect(acceptOdometer(c, { lastOdometer: null })).toBe(false);
    expect(acceptOdometer(ACCEPT.odometerFirst)).toBe(true);
  });
});
