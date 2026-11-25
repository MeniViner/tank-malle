import { describe, expect, it } from 'vitest';
import { parseCloudReading } from './cloudReading';

describe('cloud scan suggestions', () => {
  const receipt = { total: '287.60', liters: '40.000', price: '7.19' };
  it('keeps the original precision even when the unit price is unreadable', () => {
    for (const price of ['7.19', null]) {
      expect(parseCloudReading('pump', JSON.stringify({ ...receipt, price }), {}))
        .toEqual({ total: '287.60', liters: '40.000' });
    }
  });
  it('rejects arithmetic errors, misplaced decimal points, large fills and incomplete JSON', () => {
    for (const patch of [{ total: '2876.00' }, { price: '9.19' }, { liters: '40000' }, { liters: null }, { total: 287.60 }]) {
      expect(parseCloudReading('pump', JSON.stringify({ ...receipt, ...patch }), {})).toBeNull();
    }
    expect(parseCloudReading('pump', JSON.stringify(receipt), { tankCapacity: 30 })).toBeNull();
    expect(parseCloudReading('pump', 'unknown', {})).toBeNull();
  });
  it('checks mileage against the journal locally and permits the first reading', () => {
    for (const odometer of ['100000', '198550', '12500.1', null]) {
      expect(parseCloudReading('odometer', JSON.stringify({ odometer }), { lastOdometer: 125000 })).toBeNull();
    }
    expect(parseCloudReading('odometer', '{"odometer":"012345"}', {})).toEqual({ odometer: '12345' });
  });
});
