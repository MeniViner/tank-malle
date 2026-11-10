import { describe, expect, it } from 'vitest';
import { addCivilDays, snoozePresets } from './snooze';

describe('snooze presets', () => {
  it('maps tomorrow / week / month onto future civil days', () => {
    expect(snoozePresets('2026-11-10')).toEqual([
      { key: 'tomorrow', label: 'מחר', day: '2026-11-11' },
      { key: 'week', label: 'בעוד שבוע', day: '2026-11-17' },
      { key: 'month', label: 'בעוד חודש', day: '2026-12-10' },
    ]);
  });

  it('crosses month and year boundaries and clamps the month preset', () => {
    expect(snoozePresets('2026-12-31').map(p => p.day)).toEqual(['2027-01-01', '2027-01-07', '2027-01-31']);
    expect(snoozePresets('2027-01-31').map(p => p.day)).toEqual(['2027-02-01', '2027-02-07', '2027-02-28']);
    expect(snoozePresets('2028-01-31').at(-1)?.day).toBe('2028-02-29');
  });

  it('is stable across the Israeli DST change', () => {
    expect(addCivilDays('2026-03-26', 1)).toBe('2026-03-27');
    expect(addCivilDays('2026-10-24', 1)).toBe('2026-10-25');
  });

  it('every preset is strictly after today, so the existing "future day" rule always accepts it', () => {
    for (const today of ['2026-02-28', '2026-06-30', '2026-11-10']) {
      for (const preset of snoozePresets(today)) expect(preset.day > today).toBe(true);
    }
  });

  it('returns nothing for an invalid day rather than guessing', () => {
    expect(snoozePresets('not-a-day')).toEqual([]);
  });
});
