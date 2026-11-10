import { describe, expect, it } from 'vitest';
import { levenshtein, normalise, summarise } from './metrics';

describe('scan accuracy metrics', () => {
  it('computes edit distance', () => {
    expect(levenshtein('171272', '171272')).toBe(0);
    expect(levenshtein('171272', '171212')).toBe(1);
    expect(levenshtein('17127', '171272')).toBe(1);
    expect(levenshtein('', '123')).toBe(3);
  });

  it('ignores leading zeros only', () => {
    expect(normalise('007.22')).toBe('7.22');
    expect(normalise('0')).toBe('0');
  });

  it('keeps abstentions separate from successes', () => {
    const s = summarise([
      { id: 'a', label: '123456', predicted: '123456', top3: ['123456'] },
      { id: 'b', label: '123456', predicted: '123856', top3: ['123856', '123456'] },
      { id: 'c', label: '123456', predicted: null, top3: [] },
    ]);
    expect(s).toMatchObject({ sessions: 3, answered: 2, abstained: 1, correct: 1, wrong: 1 });
    expect(s.fieldAccuracy).toBeCloseTo(1 / 3);
    expect(s.answeredPrecision).toBeCloseTo(.5);
    expect(s.digitAccuracyAnswered).toBeCloseTo(11 / 12);
    expect(s.digitAccuracyAll).toBeCloseTo(11 / 18);
    expect(s.top3Hit).toBeCloseTo(2 / 3);
  });

  it('caps a wildly wrong answer at the label length', () => {
    expect(summarise([{ id: 'a', label: '12', predicted: '99999999' }]).digitAccuracyAnswered).toBe(0);
  });
});
