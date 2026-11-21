import { expect, it } from 'vitest';
import { EMPTY_CARE, type MaintenancePlan } from '../maintenance/model';
import type { PushDigestInput } from '../push/digest';
import { notificationId } from '../vehicle/model';
import { planReminders } from './reminderPlan';

const maintenance: MaintenancePlan = {
  id: 'service', schemaVersion: 1, version: 1, title: 'טיפול תקופתי', job: 'periodic',
  dueDay: '2026-12-23', dueOdometer: null, intervalMonths: null, intervalKm: null,
  basis: 'manual', source: 'owner', notes: '', active: true,
};
const input: PushDigestInput = {
  vehicle: { id: 'vehicle', docs: { test: { due: '2026-12-20' } } },
  care: { ...EMPTY_CARE, maintenancePlans: [maintenance] }, fillups: [], observations: [],
  states: [], settings: {}, today: '2026-11-12', nameVehicle: false,
};
const now = new Date('2026-11-12T12:00:00');

it('plans future document and maintenance dates while the app is closed', () => {
  const planned = planReminders(input, now);
  expect(planned.map(item => item.day)).toEqual(['2026-11-20', '2026-12-13', '2026-12-16', '2026-12-21', '2026-12-23']);
  expect(planned.at(-1)?.route).toBe('/open?vehicle=vehicle&to=%2Fvehicle%2Freminders%2Fservice');
  expect(new Set(planned.map(item => item.key)).size).toBe(planned.length);
});

it('honors the device account reminder preferences, snooze and archive', () => {
  const occurrence = 'doc:test:2026-12-20:month';
  const id = notificationId(occurrence);
  const states = [{ id, occurrence, schemaVersion: 1 as const, version: 1, read: false, archived: false, snoozeUntilDay: '2026-11-28' }];
  expect(planReminders({ ...input, states }, now)[0].day).toBe('2026-11-28');
  expect(planReminders({ ...input, states: [{ ...states[0], archived: true }] }, now)[0].day).toBe('2026-12-13');
  expect(planReminders({ ...input, settings: { reminderNotifications: false } }, now)).toEqual([]);
});

it('uses a confirmed odometer reading for a mileage-only reminder', () => {
  const care = { ...EMPTY_CARE, maintenancePlans: [{ ...maintenance, dueDay: null, dueOdometer: 180_000 }] };
  expect(planReminders({ ...input, vehicle: { id: 'vehicle' }, care }, now)).toEqual([]);
  const fillups = [{ id: 'f1', date: new Date('2026-11-11T12:00:00').getTime(), odometer: 179_500 }];
  const planned = planReminders({ ...input, vehicle: { id: 'vehicle' }, care, fillups }, now);
  expect(planned).toHaveLength(1);
  expect(planned[0].at).toBe(now.getTime() + 10_000);
});
