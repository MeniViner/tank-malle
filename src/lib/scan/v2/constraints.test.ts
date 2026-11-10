import { describe, expect, it } from 'vitest';
import {
  leastConfidentDigit, odometerChecks, pumpChecks, selectOdometer, selectPump, totalTolerance,
  type FieldCandidate,
} from './constraints';

const c = (text: string, confidence: number): FieldCandidate => ({ text, value: Number(text), confidence });

describe('pump constraints', () => {
  it('tolerates agora rounding but not a wrong digit', () => {
    expect(totalTolerance(100)).toBeCloseTo(.3);
    expect(totalTolerance(10)).toBe(.06);
    expect(pumpChecks(320.08, 44.332, 7.22, {})[0].status).toBe('ok');
    expect(pumpChecks(320.08, 44.332, 7.27, {})[0].status).toBe('failed');
    expect(pumpChecks(150, 23.734, 6.32, {})[0].status).toBe('ok');
  });

  it('checks the price range on the shown price, else on total ÷ liters', () => {
    expect(pumpChecks(287.4, 40, null, {}).find(x => x.name === 'price-range')?.status).toBe('ok');
    expect(pumpChecks(287.4, 4, null, {}).find(x => x.name === 'price-range')?.status).toBe('failed');
    expect(pumpChecks(70, 14, 5, {}).find(x => x.name === 'price-range')?.status).toBe('ok');
    expect(pumpChecks(48, 4, 12, {}).find(x => x.name === 'price-range')?.status).toBe('ok');
    expect(pumpChecks(49.2, 4, 12.3, {}).find(x => x.name === 'price-range')?.status).toBe('failed');
    expect(pumpChecks(19.6, 4, 4.9, {}).find(x => x.name === 'price-range')?.status).toBe('failed');
  });

  it('checks liters against the tank only when the capacity is known', () => {
    expect(pumpChecks(400, 55, null, { tankCapacity: 50 }).find(x => x.name === 'liters≤tank')?.status).toBe('failed');
    expect(pumpChecks(380, 52, null, { tankCapacity: 50 }).find(x => x.name === 'liters≤tank')?.status).toBe('ok');
    expect(pumpChecks(400, 55, null, {}).find(x => x.name === 'liters≤tank')?.status).toBe('unknown');
    expect(pumpChecks(400, 55, null, { tankCapacity: null }).find(x => x.name === 'liters≤tank')?.status).toBe('unknown');
  });

  it('picks a lower-ranked candidate when only it satisfies total ≈ liters × price', () => {
    const result = selectPump({
      total: [c('320.08', .9), c('328.08', .5), c('820.08', .3)],
      liters: [c('44.882', .8), c('44.332', .7), c('44.832', .2)],
      price: [c('7.22', .95), c('1.22', .3), c('7.88', .2)],
    });
    expect(result.total?.text).toBe('320.08');
    expect(result.liters?.text).toBe('44.332');
    expect(result.price?.text).toBe('7.22');
    expect(result.consistent).toBe(true);
    expect(result.changedByConstraints).toBe(true);
  });

  it('keeps top-1 everywhere and reports consistent=false when nothing fits', () => {
    const result = selectPump({ total: [c('999.99', .9)], liters: [c('10.000', .9)], price: [c('7.00', .9)] });
    expect(result.total?.text).toBe('999.99');
    expect(result.consistent).toBe(false);
    expect(result.changedByConstraints).toBe(false);
    expect(result.checks.filter(x => x.status === 'failed').map(x => x.name)).toEqual(['total≈liters×price']);
  });

  it('without a price row, uses total ÷ liters for the range and leaves the product unknown', () => {
    const result = selectPump({ total: [c('28.74', .9), c('287.40', .6)], liters: [c('40.000', .9)] });
    expect(result.total?.text).toBe('287.40');
    expect(result.price).toBeNull();
    expect(result.impliedPrice).toBeCloseTo(7.185);
    expect(result.checks.find(x => x.name === 'total≈liters×price')?.status).toBe('unknown');
  });

  it('rejects liters above the tank and picks the combination that fits', () => {
    const result = selectPump({ total: [c('400.00', .9)], liters: [c('65.000', .9), c('55.000', .8)] }, { tankCapacity: 60 });
    expect(result.liters?.text).toBe('55.000');
  });

  it('is exhaustive: across every 3×3×3 ranking, the chosen combo is the most confident consistent one', () => {
    const totals = ['320.08', '328.08', '820.08'], liters = ['44.332', '44.882', '14.332'], prices = ['7.22', '7.88', '1.22'];
    const confidences = [.9, .5, .2];
    const perms = (a: string[]) => [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map(p => p.map(i => a[i]));
    let checked = 0;
    for (const t of perms(totals)) for (const l of perms(liters)) for (const p of perms(prices)) {
      const fields = { total: t.map((x, i) => c(x, confidences[i])), liters: l.map((x, i) => c(x, confidences[i])), price: p.map((x, i) => c(x, confidences[i])) };
      const result = selectPump(fields);
      // Brute force reference.
      let best: { s: number; t: string; l: string; p: string } | null = null;
      for (const a of fields.total) for (const b of fields.liters) for (const d of fields.price) {
        const ok = pumpChecks(a.value, b.value, d.value, {}).every(x => x.status !== 'failed');
        const s = Math.log(a.confidence) + Math.log(b.confidence) + Math.log(d.confidence);
        if (ok && (!best || s > best.s)) best = { s, t: a.text, l: b.text, p: d.text };
      }
      expect(best).not.toBeNull();
      expect([result.total?.text, result.liters?.text, result.price?.text]).toEqual([best!.t, best!.l, best!.p]);
      expect(result.consistent).toBe(true);
      checked++;
    }
    expect(checked).toBe(216);
  });

  it('handles missing fields without throwing', () => {
    expect(selectPump({ total: [], liters: [c('40.000', .9)] }).consistent).toBe(false);
    expect(selectPump({ total: [c('287.40', .9)], liters: [] }).liters).toBeNull();
  });
});

describe('odometer constraints', () => {
  it('evaluates the 3,000 km window only with a known last reading', () => {
    expect(odometerChecks(128450, {}).every(x => x.status === 'unknown')).toBe(true);
    expect(odometerChecks(128450, { lastOdometer: 0 }).every(x => x.status === 'unknown')).toBe(true);
    expect(odometerChecks(128450, { lastOdometer: 128000 }).map(x => x.status)).toEqual(['ok', 'ok']);
    expect(odometerChecks(128000, { lastOdometer: 128000 }).map(x => x.status)).toEqual(['failed', 'ok']);
    expect(odometerChecks(131000, { lastOdometer: 128000 }).map(x => x.status)).toEqual(['ok', 'failed']);
    expect(odometerChecks(130999, { lastOdometer: 128000 }).map(x => x.status)).toEqual(['ok', 'ok']);
    expect(odometerChecks(127999, { lastOdometer: 128000 }).map(x => x.status)).toEqual(['failed', 'ok']);
  });

  it('picks the most confident candidate inside the window', () => {
    const list = [c('188450', .9), c('128450', .7), c('128458', .6)];
    expect(selectOdometer(list, { lastOdometer: 128100 }).odometer?.text).toBe('128450');
    expect(selectOdometer(list, { lastOdometer: 128100 }).changedByConstraints).toBe(true);
    expect(selectOdometer(list).odometer?.text).toBe('188450');
    expect(selectOdometer(list, { lastOdometer: 200000 })).toMatchObject({ consistent: false, odometer: { text: '188450' } });
  });

  it('ignores non-integer and non-positive values', () => {
    expect(selectOdometer([c('12.5', .9), c('0', .9)]).odometer).toBeNull();
  });

  it('is exhaustive over every window position for three candidates', () => {
    const list = [c('100500', .9), c('101500', .6), c('104000', .3)];
    for (let last = 97000; last <= 105000; last += 250) {
      const inside = list.filter(x => x.value > last && x.value < last + 3000);
      const result = selectOdometer(list, { lastOdometer: last });
      expect(result.odometer?.text).toBe((inside[0] ?? list[0]).text);
      expect(result.consistent).toBe(inside.length > 0);
    }
  });
});

describe('least confident character', () => {
  it('finds the lowest, including an inserted decimal point', () => {
    expect(leastConfidentDigit({ ...c('287.40', .8), digits: [...'287.40'].map((ch, i) => ({ char: ch, confidence: i === 3 ? .35 : .9 })) })).toBe(3);
    expect(leastConfidentDigit({ ...c('128450', .8), digits: [...'128450'].map((ch, i) => ({ char: ch, confidence: i === 4 ? .2 : .9 })) })).toBe(4);
    expect(leastConfidentDigit(null)).toBe(-1);
    expect(leastConfidentDigit(c('1', 1))).toBe(-1);
  });
});
