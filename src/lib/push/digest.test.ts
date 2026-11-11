import { describe, expect, it } from 'vitest';
import { EMPTY_CARE, type MaintenancePlan } from '../maintenance/model';
import { notificationId, type NotificationState } from '../vehicle/model';
import { pushDigest, type PushDigestInput } from './digest';

const plan = (patch: Partial<MaintenancePlan> = {}): MaintenancePlan => ({ id: 'p1', schemaVersion: 1, version: 1, title: 'טיפול תקופתי', job: 'periodic',
  dueDay: '2026-11-15', dueOdometer: null, intervalMonths: null, intervalKm: null, basis: 'manual', source: 'owner', notes: '', active: true, ...patch });
const input = (patch: Partial<PushDigestInput> = {}): PushDigestInput => ({
  vehicle: { id: 'v1', nickname: 'המשפחתית', docs: { test: { due: '2026-11-20' } } },
  care: { ...EMPTY_CARE, maintenancePlans: [plan()] }, fillups: [], observations: [], states: [], settings: {},
  today: '2026-11-11', nameVehicle: false, ...patch,
});
const state = (occurrence: string, patch: Partial<NotificationState> = {}): NotificationState => ({ id: notificationId(occurrence), schemaVersion: 1, version: 1,
  occurrence, read: false, archived: false, snoozeUntilDay: null, ...patch });

describe('pushDigest', () => {
  it('pushes a near test date and a reminder inside the lead time, with their in-app occurrences', () => {
    const items = pushDigest(input());
    expect(items.map(i => i.title)).toEqual(['טסט שנתי · בעוד 9 ימים', 'טיפול תקופתי']);
    expect(items[1]).toMatchObject({ body: 'הטיפול מתקרב', url: '/open?vehicle=v1&to=%2Fvehicle%2Freminders%2Fp1', urgent: false });
    expect(items[0].url).toBe('/open?vehicle=v1&to=%2Fvehicle%3Fdoc%3Dtest%26vehicle%3Dv1');
    expect(items[0].occurrence).toMatch(/^doc:test:2026-11-20:/);
  });
  it('names the car only when the account has several', () => {
    expect(pushDigest(input({ nameVehicle: true }))[1].body).toBe('המשפחתית · הטיפול מתקרב');
  });
  it('respects the reminder preference and the lead time', () => {
    expect(pushDigest(input({ settings: { reminderNotifications: false } }))).toEqual([]);
    expect(pushDigest(input({ settings: { reminderLeadDays: 1 } })).map(i => i.title)).toEqual(['טסט שנתי · בעוד 9 ימים']);
  });
  it('a due reminder is urgent; an inactive one is not pushed', () => {
    expect(pushDigest(input({ care: { ...EMPTY_CARE, maintenancePlans: [plan({ dueDay: '2026-11-01' })] } })).at(-1)).toMatchObject({ body: 'הגיע מועד הטיפול', urgent: true });
    expect(pushDigest(input({ care: { ...EMPTY_CARE, maintenancePlans: [plan({ active: false })] } })).map(i => i.title)).toEqual(['טסט שנתי · בעוד 9 ימים']);
  });
  it('skips what the user already read, archived, deleted or snoozed in the app', () => {
    const [doc, reminder] = pushDigest(input());
    for (const patch of [{ read: true }, { archived: true }, { deleted: true }, { snoozeUntilDay: '2026-11-12' }])
      expect(pushDigest(input({ states: [state(reminder.occurrence, patch)] })).map(i => i.occurrence)).toEqual([doc.occurrence]);
    expect(pushDigest(input({ states: [state(reminder.occurrence, { snoozeUntilDay: '2026-11-11' })] }))).toHaveLength(2);
  });
  it('a reminder by km uses the latest reading from fill-ups', () => {
    const care = { ...EMPTY_CARE, maintenancePlans: [plan({ dueDay: null, dueOdometer: 180_000 })] };
    const fillups = [{ id: 'f', date: Date.UTC(2026, 10, 10, 10), odometer: 179_500 }];
    expect(pushDigest(input({ care, fillups, vehicle: { id: 'v1' } })).map(i => i.body)).toEqual(['הטיפול מתקרב']);
    expect(pushDigest(input({ care, fillups: [], vehicle: { id: 'v1' } }))).toEqual([]);
  });
});
