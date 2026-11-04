import { describe, expect, it } from 'vitest';
import { breakdown, groupBootstrap, percentile, sameValue, summarize, verdict, wilson, type SessionOutcome } from './metrics';

const row = (over: Partial<SessionOutcome>): SessionOutcome => ({ id: 'x', kind: 'odometer', group: 'g', family: 'f', device: 'd', split: 'test', eligible: true, expected: { odometer: '128450' }, status: 'accepted', values: { odometer: '128450' }, latencyMs: 100, frames: 1, ...over });

describe('scan benchmark metrics', () => {
  it('computes Wilson intervals and refuses to call a target met on a small sample', () => {
    const w = wilson(19, 20);
    expect(w.estimate).toBeCloseTo(.95); expect(w.low!).toBeCloseTo(.7639, 3); expect(w.high!).toBeCloseTo(.9911, 3);
    expect(verdict(w, .95)).toBe('unproven');
    expect(verdict(wilson(2000, 2000), .995)).toBe('met');
    expect(verdict(wilson(0, 0), .95)).toBe('not-measured');
    expect(verdict(wilson(10, 100), .95)).toBe('not-met');
  });
  it('compares displayed numbers exactly, allowing only leading zeros and trailing decimal zeros', () => {
    expect(sameValue('odometer', '000850', '850')).toBe(true);
    expect(sameValue('odometer', '850', '8500')).toBe(false);
    expect(sameValue('total', '202.730', '202.73')).toBe(true);
    expect(sameValue('total', '202.7', '202.73')).toBe(false);
    expect(sameValue('liters', undefined, '1')).toBe(false);
  });
  it('separates coverage among eligible sessions from coverage among all sessions and counts wrong acceptances', () => {
    const rows = [
      row({ id: 'a' }), row({ id: 'b', group: 'h', values: { odometer: '128458' } }),
      row({ id: 'c', status: 'abstained', values: undefined, reason: 'identity-ambiguous' }),
      row({ id: 'd', eligible: false, expected: null, status: 'abstained', values: undefined, reason: 'unreadable' }),
      row({ id: 'e', eligible: false, expected: null }),
    ];
    const s = summarize(rows);
    expect(s.coverageEligible).toMatchObject({ k: 1, n: 3 });
    expect(s.coverageAll).toMatchObject({ k: 1, n: 5 });
    expect(s.acceptedPrecision).toMatchObject({ k: 1, n: 3 });
    expect(s.wrongAcceptanceAmongAll).toMatchObject({ k: 2, n: 5 });
    expect(s.wrongAcceptanceAmongIneligible).toMatchObject({ k: 1, n: 2 });
    expect(s.sessionReasons).toEqual({ 'identity-ambiguous': 1, unreadable: 1 });
    expect(breakdown(rows, r => r.group).h).toMatchObject({ sessions: 1, wrongAccepted: 1 });
  });
  it('resamples whole groups, so one display photographed many times does not narrow the interval', () => {
    const many = [...Array(50)].map((_, i) => row({ id: `r${i}`, group: 'one' }));
    expect(groupBootstrap(many, r => r.group, () => true, () => true)).toMatchObject({ low: 1, high: 1, groups: 1 });
    expect(percentile([1, 2, 3, 4], .5)).toBe(2.5);
  });
});
