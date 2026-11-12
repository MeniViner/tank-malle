import { describe, expect, it } from 'vitest';
import { acceptKeyOf, byDay, groupBy, labelOf, readingKey, readRate, rightRate, toSampleRow, triesToRead, tally, tuneThreshold, wrongRate, type ScanSampleRow } from './sampleStats';

const base: ScanSampleRow = { id: 'a', uid: 'u', createdAt: Date.UTC(2026, 10, 11, 9), day: '2026-11-11', appVersion: '1.9.0', engine: 2, kind: 'odometer', source: 'camera',
  session: 's1', attempt: 1, outcome: 'read', guess: '168053', confidence: .7, ms: 800, frames: 5, seconds: 3, journal: true, platform: 'android', final: '168053', result: 'match' };
const row = (patch: Partial<ScanSampleRow>): ScanSampleRow => ({ ...base, ...patch });

describe('scan sample statistics', () => {
  it('separates right, wrong, typed and the right guesses that were not shown', () => {
    const t = tally([row({}), row({ final: '168058', result: 'corrected' }), row({ outcome: 'unreadable', guess: '168053', result: 'manual' }),
      row({ outcome: 'unreadable', guess: null, result: 'manual' }), row({ final: null, result: null }), row({ outcome: 'unreadable', final: null, result: null })]);
    expect(t).toEqual({ attempts: 6, read: 3, unreadable: 3, labeled: 4, right: 1, wrong: 1, missedRight: 1, typed: 2 });
    expect(readRate(t)).toBe(.5); expect(rightRate(t)).toBe(.25); expect(wrongRate(t)).toBe(.5);
  });
  it('gives no rate when there is nothing to divide by', () => {
    const t = tally([]);
    expect(readRate(t)).toBeNull(); expect(rightRate(t)).toBeNull(); expect(wrongRate(t)).toBeNull();
  });
  it('counts how many tries each display needed', () => {
    const rows = [row({ session: 'a', attempt: 1 }), row({ session: 'b', attempt: 1, outcome: 'unreadable' }), row({ session: 'b', attempt: 2 }),
      row({ session: 'c', attempt: 1, outcome: 'unreadable' }), row({ session: 'c', attempt: 2, outcome: 'unreadable' }), row({ session: 'c', attempt: 3 }),
      row({ session: 'd', attempt: 1, outcome: 'unreadable' }), row({ session: 'a', kind: 'pump', attempt: 1, outcome: 'unreadable' })];
    expect(triesToRead(rows)).toEqual({ tasks: 5, first: 1, second: 1, later: 1, never: 2 });
  });
  it('lays out one bar per day, empty days included, and groups by a key', () => {
    const now = Date.UTC(2026, 10, 11, 12), bars = byDay([row({}), row({ day: '2026-11-10', outcome: 'unreadable' }), row({ day: '2026-10-01' })], 3, now);
    expect(bars.map(b => b.day)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(bars[2]).toMatchObject({ right: 1 }); expect(bars[1]).toMatchObject({ unreadable: 1 }); expect(bars[0]).toMatchObject({ right: 0, unreadable: 0 });
    expect(groupBy([row({}), row({ kind: 'pump' }), row({})], r => r.kind).map(g => [g.key, g.tally.attempts])).toEqual([['odometer', 2], ['pump', 1]]);
  });
  it('reads stored documents defensively', () => {
    expect(toSampleRow('x', { kind: 'receipt', outcome: 'read', createdAt: 1 })).toBeNull();
    expect(toSampleRow('x', { kind: 'pump', outcome: 'read', createdAt: 1794000000000, guess: 5, final: '1.00|2.000', result: 'weird' })).toMatchObject({ guess: null, final: '1.00|2.000', result: null, source: 'camera' });
  });
  it('picks the threshold key the way the engine does', () => {
    expect(acceptKeyOf({ kind: 'pump', journal: true })).toBe('pump');
    expect(acceptKeyOf({ kind: 'odometer', journal: true })).toBe('odometer');
    expect(acceptKeyOf({ kind: 'odometer', journal: false })).toBe('odometerFirst');
  });
});

describe('threshold tuning from labelled attempts', () => {
  const many = (n: number, patch: Partial<ScanSampleRow>) => Array.from({ length: n }, () => row(patch));
  it('needs enough labelled attempts', () => {
    expect(tuneThreshold(many(50, {}), .45, [.4, .8])).toBeNull();
  });
  it('lowers the threshold, one step at most, when lower-confidence guesses were right', () => {
    const rows = [...many(200, { confidence: .7 }), ...many(100, { confidence: .42, outcome: 'unreadable', source: 'file' })];
    expect(tuneThreshold(rows, .5, [.4, .8])).toMatchObject({ value: .45, wrong: 0 });
    expect(tuneThreshold(rows, .45, [.4, .8])).toMatchObject({ value: .4, right: 300 });
  });
  it('raises it past a band of wrong readings, inside the allowed range', () => {
    const rows = [...many(300, { confidence: .7 }), ...many(30, { confidence: .47, final: '168058', result: 'corrected' })];
    expect(tuneThreshold(rows, .45, [.4, .8])).toMatchObject({ value: .48, wrong: 0, right: 300 });
    expect(tuneThreshold(rows, .45, [.4, .46])!.value).toBe(.46);
  });
  it('ignores the stray best frame of a camera session that showed nothing', () => {
    const stray = many(5, { confidence: .6, outcome: 'unreadable', source: 'camera', final: '168058', result: 'manual' });
    expect(tuneThreshold([...many(30, { confidence: .7 }), ...stray], .45, [.4, .8])).toBeNull();
    // The same guesses from single pictures would have been shown at that confidence: they count.
    expect(tuneThreshold([...many(30, { confidence: .7 }), ...stray.map(r => ({ ...r, source: 'file' as const }))], .45, [.4, .8])).toMatchObject({ value: .5 });
  });
  it('with few attempts only tightens, and only after two wrong readings were shown', () => {
    const wrong = (n: number) => many(n, { confidence: .47, final: '168058', result: 'corrected' });
    expect(tuneThreshold([...many(30, { confidence: .7 }), ...wrong(1)], .45, [.4, .8])).toBeNull();
    expect(tuneThreshold([...many(10, { confidence: .7 }), ...wrong(2)], .45, [.4, .8])).toBeNull();
    expect(tuneThreshold([...many(30, { confidence: .7 }), ...wrong(2)], .45, [.4, .8])).toMatchObject({ value: .48, wrong: 0, right: 30 });
    // Right guesses under the threshold are not enough to lower it yet.
    expect(tuneThreshold([...many(30, { confidence: .7 }), ...many(100, { confidence: .42, outcome: 'unreadable', source: 'file' })], .5, [.4, .8])).toBeNull();
  });
});

describe('labels', () => {
  it('normalises what is compared', () => {
    expect(readingKey('odometer', { odometer: '168053' })).toBe('168053');
    expect(readingKey('odometer', { odometer: '' })).toBeNull();
    expect(readingKey('pump', { total: '287.6', liters: '40' })).toBe('287.60|40.000');
    expect(readingKey('pump', { total: '287.6', liters: '' })).toBeNull();
  });
  it('names the outcome', () => {
    expect(labelOf('read', '168053', '168053')).toBe('match');
    expect(labelOf('read', '168053', '168058')).toBe('corrected');
    expect(labelOf('unreadable', '168053', '168053')).toBe('manual');
  });
});
