import { describe, expect, it } from 'vitest';
import { priceSpotlights } from './priceSpotlight';
import { withPublicPrices } from '../prices/regulated';
import { CHECKED_AT, FIFTH, NOVEMBER, NOVEMBER_FIFTH, OCTOBER, SNAPSHOT } from '../prices/__fixtures__/officialNotices';
import type { Vehicle } from '../stats';

const vehicle: Vehicle = { id: 'car', make: 'יונדאי', model: 'i20', fuelType: '95', tankLiters: 45, tankLitersSource: 'user', priceAdjustment: 0, archived: false };

describe('price spotlights reflect a dated purchase quantity', () => {
  it('shows the 42-agorot reduction as about 19\u202F₪ for purchasing 45 litres', () => {
    const data = withPublicPrices(null, { ...SNAPSHOT, notices: [OCTOBER, NOVEMBER] }, CHECKED_AT);
    const item = priceSpotlights(data, vehicle, CHECKED_AT)[0];
    expect(item.title).toContain('0.42\u202F₪');
    expect(item.body).toContain('בתדלוק של 45 ליטר');
    expect(item.body).toContain('19\u202F₪ פחות');
    expect(item.body).not.toMatch(/מיכל מלא|חודשי/);
  });
  it('shows the confirmed upcoming increase, then the actual +0.50 transition with a different dismissal identity', () => {
    const data = withPublicPrices(null, SNAPSHOT, CHECKED_AT);
    const before = priceSpotlights(data, vehicle, NOVEMBER_FIFTH - 1)[0];
    const after = priceSpotlights(data, vehicle, NOVEMBER_FIFTH)[0];
    expect(before.title).toContain('יתייקר ב-0.50\u202F₪');
    expect(after.title).toContain('עלה ב-0.50\u202F₪');
    expect(after.title).not.toContain('0.08\u202F₪');
    expect(before.body).toContain('5 בנובמבר 2026 בשעה 00:00');
    expect(after.body).toContain('בתדלוק של 45 ליטר לפי המחיר המרבי: כ-23\u202F₪ יותר');
    expect(before.id).not.toBe(after.id);
    expect(after.target).toEqual({ kind: 'price' });
  });
  it('shows a sourced future price without an invented delta when its predecessor is unknown', () => {
    const data = withPublicPrices(null, { notices: [FIFTH], readAt: CHECKED_AT }, CHECKED_AT);
    const item = priceSpotlights(data, vehicle, CHECKED_AT)[0];
    expect(item.title).toBe('פורסם מחיר חדש לבנזין 95');
    expect(item.body).toContain('7.85\u202F₪');
    expect(item.body).not.toContain('בתדלוק');
    expect(priceSpotlights(data, vehicle, NOVEMBER_FIFTH)).toEqual([]);
  });
  it('does not estimate purchase quantities from an untrusted capacity or show 95 notices for another fuel', () => {
    const data = withPublicPrices(null, SNAPSHOT, CHECKED_AT);
    expect(priceSpotlights(data, { ...vehicle, tankLitersSource: 'estimate' }, CHECKED_AT)[0].body).not.toContain('בתדלוק');
    expect(priceSpotlights(data, { ...vehicle, fuelType: 'diesel' }, CHECKED_AT)).toEqual([]);
    expect(priceSpotlights(data, { ...vehicle, fuelType: '98' }, CHECKED_AT)).toEqual([]);
  });
  it('does not announce a same-price upcoming publication as a change', () => {
    const data = withPublicPrices(null, { ...SNAPSHOT, notices: [NOVEMBER, { ...FIFTH, price: 7.35 }] }, CHECKED_AT);
    expect(priceSpotlights(data, vehicle, CHECKED_AT)).toEqual([]);
    expect(priceSpotlights(data, vehicle, NOVEMBER_FIFTH)).toEqual([]);
  });
});
