import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { clearNativeReminders, enableNativeReminders, reconcileNativeReminders, reminderCleanupPending } from './reminders';

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    getPending: vi.fn(),
    schedule: vi.fn(),
    cancel: vi.fn(),
    removeAllDeliveredNotifications: vi.fn(),
  },
}));

const route = '/open?vehicle=test&to=%2Fvehicle';
let pending: LocalNotificationSchema[];
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    setItem: (key: string, value: string) => { values.set(key, value); },
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key); },
  });
  vi.stubGlobal('window', new EventTarget());
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T12:00:00'));
  pending = [];
  vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' });
  vi.mocked(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'granted' });
  vi.mocked(LocalNotifications.getPending).mockImplementation(async () => ({ notifications: pending }));
  vi.mocked(LocalNotifications.schedule).mockImplementation(async ({ notifications }) => {
    pending = [...pending, ...notifications];
    return { notifications: notifications.map(({ id }) => ({ id })) };
  });
  vi.mocked(LocalNotifications.cancel).mockImplementation(async ({ notifications }) => {
    pending = pending.filter(item => !notifications.some(removed => removed.id === item.id));
  });
  vi.mocked(LocalNotifications.removeAllDeliveredNotifications).mockResolvedValue();
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

it('schedules once, replaces an edited deadline and cancels on logout', async () => {
  await enableNativeReminders('alice', () => true);
  const item = { key: 'test', day: '2026-11-13', at: new Date('2026-11-13T09:00:00').getTime(), route };
  await reconcileNativeReminders('alice', [item], () => true);
  await reconcileNativeReminders('alice', [item], () => true);
  expect(LocalNotifications.schedule).toHaveBeenCalledTimes(1);
  expect(pending[0].isExactNotification).toBe(false);
  const revised = { ...item, day: '2026-11-14', at: item.at + 86_400_000 };
  await reconcileNativeReminders('alice', [revised], () => true);
  expect(pending).toHaveLength(1);
  expect(pending[0].schedule?.at).toEqual(new Date(revised.at));
  await clearNativeReminders();
  await reconcileNativeReminders('alice', [item], () => true);
  expect(pending).toEqual([]);
  expect(LocalNotifications.removeAllDeliveredNotifications).toHaveBeenCalledTimes(1);
});

it('retries an interrupted cleanup before a new account enables notifications', async () => {
  await enableNativeReminders('alice', () => true);
  await reconcileNativeReminders('alice', [{ key: 'test', day: '2026-11-12', at: Date.now() + 10_000, route }], () => true);
  vi.mocked(LocalNotifications.cancel).mockRejectedValueOnce(new Error('interrupted'));
  await expect(clearNativeReminders()).rejects.toThrow('interrupted');
  expect(reminderCleanupPending()).toBe(true);
  await enableNativeReminders('bob', () => true);
  expect(pending).toEqual([]);
  expect(reminderCleanupPending()).toBe(false);
});
