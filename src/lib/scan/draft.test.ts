import { describe, expect, it } from 'vitest';
import { acceptScanReading, type AcceptedScanDraft } from './draft';
import { suggestReceiptPrice, typeReceiptField, type ReceiptState } from '../receipt';

const empty = (): AcceptedScanDraft => ({ draft: { total: '', liters: '', odometer: '' }, acceptedFields: [] });

describe('accepted scan readings', () => {
  it('replaces a nonempty automatic prefill while preserving authored receipt and odometer fields', () => {
    const opening: AcceptedScanDraft = { draft: { total: '280', liters: '38.30', odometer: '128450' }, acceptedFields: [] };
    const pump = acceptScanReading(opening, { total: '287.40', liters: '40.000' }, ['total', 'odometer']);
    const result = acceptScanReading(pump, { odometer: '128500' }, ['total', 'odometer']);
    expect(result).toEqual({ draft: { total: '280', liters: '40.000', odometer: '128450' }, acceptedFields: ['liters'] });
    expect(opening.draft.liters).toBe('38.30');
    expect(opening.acceptedFields).toEqual([]);
  });

  it('confirms an equal prefill so a later price suggestion cannot reprice accepted measurements', () => {
    const opening: AcceptedScanDraft = { draft: { total: '280.00', liters: '40', odometer: '' }, acceptedFields: [] };
    const scan = acceptScanReading(opening, { total: '280.00', liters: '40' }, ['total']);
    expect(scan.acceptedFields).toEqual(['liters']);
    const receipt: ReceiptState = { totalCost: '280.00', liters: '40', pricePerLiter: '7', authored: ['totalCost'] };
    const confirmed = typeReceiptField(receipt, 'liters', scan.draft.liters);
    expect(suggestReceiptPrice(confirmed, 7.85)).toEqual(confirmed);
    expect(confirmed.authored).toEqual(['totalCost', 'liters']);
  });

  it('retains a complete partial pump reading before any odometer succeeds', () => {
    const result = acceptScanReading(empty(), { total: '287.40', liters: '40.000' }, []);
    expect(result).toEqual({ draft: { total: '287.40', liters: '40.000', odometer: '' }, acceptedFields: ['total', 'liters'] });
  });

  it('adds the second step without losing or reformatting the accepted pump values', () => {
    const pump = acceptScanReading(empty(), { total: '287.40', liters: '40.000' }, []);
    expect(acceptScanReading(pump, { odometer: '128450' }, [])).toEqual({
      draft: { total: '287.40', liters: '40.000', odometer: '128450' }, acceptedFields: ['total', 'liters', 'odometer'],
    });
  });

  it('allows a corrected pump scan and reports each accepted field only once', () => {
    const first = acceptScanReading(empty(), { total: '287.40', liters: '40.000' }, []);
    const corrected = acceptScanReading(first, { total: '294.40', liters: '41.000' }, []);
    expect(corrected).toEqual({ draft: { total: '294.40', liters: '41.000', odometer: '' }, acceptedFields: ['total', 'liters'] });
    expect(first.draft.total).toBe('287.40');
  });

  it('does not claim protected values as accepted, including a known zero', () => {
    const opening: AcceptedScanDraft = { draft: { total: '0', liters: '17.500', odometer: '' }, acceptedFields: [] };
    expect(acceptScanReading(opening, { total: '287.40', liters: '40.000' }, ['total', 'liters'])).toEqual(opening);
  });
});
