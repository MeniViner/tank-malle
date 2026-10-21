import { expect, it } from 'vitest';
import { EMPTY_EXTRA, type VehicleIssue } from './model';
import { emptyExtraSources, recordExtraSourceError, type ExtraSourceState } from './sourceState';

const issue: VehicleIssue = { id: 'private', schemaVersion: 1, version: 1, day: '2026-10-01', title: 'Private repair', symptoms: '', odometer: null, importance: 'important', status: 'open', notes: '', serviceEventIds: [], history: [] };
const loaded: ExtraSourceState = { ...emptyExtraSources('owner-a/car-a'), data: { ...EMPTY_EXTRA, vehicleIssues: [issue] }, loaded: ['vehicleIssues', 'notificationStates'], cached: ['vehicleIssues'], malformed: 2 };

it('a first subscription failure after owner or vehicle switching cannot expose previous records', () => {
  for (const scope of ['owner-b/car-a', 'owner-a/car-b']) {
    const result = recordExtraSourceError(loaded, scope, 'vehicleIssues');
    expect(result).toEqual({ scope, data: EMPTY_EXTRA, loaded: [], cached: [], malformed: 0, errors: ['vehicleIssues'] });
  }
  expect(loaded.data.vehicleIssues).toEqual([issue]);
});

it('a same-scope failure retains its own cached records and deduplicates the error', () => {
  const result = recordExtraSourceError(recordExtraSourceError(loaded, loaded.scope, 'vehicleIssues'), loaded.scope, 'vehicleIssues');
  expect(result.data).toBe(loaded.data);
  expect(result.loaded).toEqual(loaded.loaded);
  expect(result.cached).toEqual(loaded.cached);
  expect(result.errors).toEqual(['vehicleIssues']);
});
