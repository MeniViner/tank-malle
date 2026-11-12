import { describe, expect, it } from 'vitest';
import type { MaintenancePlan, ServiceEvent } from './model';
import { suggestNextReminder, type SuggestContext } from './nextReminder';

const service = (patch: Partial<ServiceEvent> = {}): ServiceEvent => ({ id: 's', schemaVersion: 1, version: 1, day: '2026-11-11', title: 'טיפול תקופתי',
  jobs: ['periodic', 'oil'], odometer: 170_000, costAgorot: null, garage: '', notes: '', completedPlanIds: [], ...patch });
const plan = (patch: Partial<MaintenancePlan> = {}): MaintenancePlan => ({ id: 'p', schemaVersion: 1, version: 1, title: 'x', job: 'periodic', dueDay: null,
  dueOdometer: 180_000, intervalMonths: null, intervalKm: null, basis: 'manual', source: 'owner', notes: '', active: true, ...patch });
const ctx = (patch: Partial<SuggestContext> = {}): SuggestContext => ({ services: [], latest: null, today: '2026-11-12', ev: false, ...patch });

describe('suggestNextReminder', () => {
  it('offers the periodic job a year and 10,000 km after the service', () => {
    expect(suggestNextReminder(service(), [], ctx())).toEqual({ title: 'טיפול תקופתי', job: 'periodic', dueDay: '2027-11-11',
      dueOdometer: 180_000, intervalMonths: 12, intervalKm: 10_000 });
  });
  it('falls back to the latest reading when it is not older than the service, else a date-only reminder', () => {
    expect(suggestNextReminder(service({ odometer: null }), [], ctx({ latest: { odometer: 171_000, day: '2026-11-10' } }))?.dueOdometer).toBe(181_000);
    expect(suggestNextReminder(service({ odometer: null, day: '2026-06-01' }), [], ctx({ latest: { odometer: 171_000, day: '2026-11-10' } })))
      .toMatchObject({ dueDay: '2027-06-01', dueOdometer: null, intervalKm: null });
    expect(suggestNextReminder(service({ odometer: null }), [], ctx())).toMatchObject({ dueOdometer: null, intervalKm: null, intervalMonths: 12 });
  });
  it('offers only periodic service and oil, in that order whatever order the jobs were ticked', () => {
    expect(suggestNextReminder(service({ jobs: ['tires', 'oil'] }), [], ctx())?.job).toBe('oil');
    expect(suggestNextReminder(service({ jobs: ['oil', 'periodic'] }), [], ctx())?.job).toBe('periodic');
    for (const jobs of [['tires'], ['brakes'], ['battery'], ['repair'], ['custom']] as ServiceEvent['jobs'][]) expect(suggestNextReminder(service({ jobs, title: 'החלפת רצועה' }), [], ctx())).toBeNull();
  });
  it('an electric car is not offered an oil reminder', () => {
    expect(suggestNextReminder(service({ jobs: ['oil'] }), [], ctx({ ev: true }))).toBeNull();
    expect(suggestNextReminder(service({ jobs: ['oil', 'periodic'] }), [], ctx({ ev: true }))?.job).toBe('periodic');
  });
  it('moves to the next job when one already has an active reminder', () => {
    expect(suggestNextReminder(service(), [plan()], ctx())?.job).toBe('oil');
    expect(suggestNextReminder(service(), [plan(), plan({ id: 'q', job: 'oil' })], ctx())).toBeNull();
    expect(suggestNextReminder(service(), [plan({ active: false })], ctx())?.job).toBe('periodic');
  });
  it('offers nothing when the service advanced a reminder', () => {
    expect(suggestNextReminder(service({ completedPlanIds: ['p'] }), [], ctx())).toBeNull();
  });
  it('back-filled history: nothing when the next one would already be due, or a later service of the job exists', () => {
    expect(suggestNextReminder(service({ day: '2024-03-01', odometer: 120_000 }), [], ctx({ latest: { odometer: 171_000, day: '2026-11-10' } }))).toBeNull();
    expect(suggestNextReminder(service({ day: '2026-06-01', odometer: 150_000 }), [], ctx({ latest: { odometer: 171_000, day: '2026-11-10' } }))).toBeNull();
    const later = service({ id: 'later', day: '2026-10-01', jobs: ['periodic'] });
    expect(suggestNextReminder(service({ day: '2026-09-01', jobs: ['periodic'] }), [], ctx({ services: [later] }))).toBeNull();
    expect(suggestNextReminder(later, [], ctx({ services: [later, service({ day: '2026-09-01' })] }))?.job).toBe('periodic');
  });
});
