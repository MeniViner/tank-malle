import { expect, it } from 'vitest';
import { restorablePreferences } from './restorablePreferences';

it('does not restore or grant optional financial-summary consent from any backup value', () => {
  for (const shareTcoBenchmarks of [true, false, 'true', 1, null]) {
    expect(restorablePreferences({ shareTcoBenchmarks, shareBenchmarks: false, theme: 'dark' }))
      .toEqual({ shareBenchmarks: false, theme: 'dark' });
  }
});
it('retains the established restorable preference validation', () => {
  expect(restorablePreferences({ quickEntry: true, reminderLeadDays: 7, reminderLeadKm: 1000, units: 'kmPerLiter', customAccent: '#aabbcc' }))
    .toEqual({ quickEntry: true, reminderLeadDays: 7, reminderLeadKm: 1000, units: 'kmPerLiter', customAccent: '#aabbcc' });
  expect(restorablePreferences({ quickEntry: 'true', reminderLeadDays: 9, reminderLeadKm: '1000', units: 'bad', customAccent: 'bad' })).toEqual({});
});
