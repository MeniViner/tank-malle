import { describe, expect, it } from 'vitest';
import type { MaintenancePlan, ServiceEvent } from './model';
import { suggestNextReminder } from './nextReminder';

const service = (patch: Partial<ServiceEvent> = {}): ServiceEvent => ({ id: 's', schemaVersion: 1, version: 1, day: '2026-11-11', title: 'טיפול תקופתי',
  jobs: ['periodic', 'oil'], odometer: 170_000, costAgorot: null, garage: '', notes: '', completedPlanIds: [], ...patch });
const plan = (patch: Partial<MaintenancePlan> = {}): MaintenancePlan => ({ id: 'p', schemaVersion: 1, version: 1, title: 'x', job: 'periodic', dueDay: null,
  dueOdometer: 180_000, intervalMonths: null, intervalKm: null, basis: 'manual', source: 'owner', notes: '', active: true, ...patch });

describe('suggestNextReminder', () => {
  it('offers the periodic job a year and 10,000 km after the service', () => {
    expect(suggestNextReminder(service(), [], null)).toEqual({ title: 'טיפול תקופתי', job: 'periodic', dueDay: '2027-11-11',
      dueOdometer: 180_000, intervalMonths: 12, intervalKm: 10_000 });
  });
  it('falls back to the latest reading, and to a date-only reminder without one', () => {
    expect(suggestNextReminder(service({ odometer: null }), [], 171_000)?.dueOdometer).toBe(181_000);
    const dateOnly = suggestNextReminder(service({ odometer: null }), [], null);
    expect(dateOnly).toMatchObject({ dueOdometer: null, intervalKm: null, intervalMonths: 12 });
  });
  it('uses the first job, and a custom service keeps its own title', () => {
    expect(suggestNextReminder(service({ jobs: ['tires'] }), [], null)?.job).toBe('tires');
    expect(suggestNextReminder(service({ jobs: ['custom'], title: 'החלפת רצועה' }), [], null)?.title).toBe('החלפת רצועה');
  });
  it('offers nothing when the service advanced a reminder or one is already active for the job', () => {
    expect(suggestNextReminder(service({ completedPlanIds: ['p'] }), [], null)).toBeNull();
    expect(suggestNextReminder(service(), [plan()], null)).toBeNull();
    expect(suggestNextReminder(service(), [plan({ active: false })], null)).not.toBeNull();
  });
});
