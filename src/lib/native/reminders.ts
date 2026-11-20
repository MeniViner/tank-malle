import { LocalNotifications } from '@capacitor/local-notifications';
import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import type { ReminderCandidate } from './reminderPlan';

const OWNER = 'tm.native.reminders.owner';
const STATE = 'tm.native.reminders.state';
const CLEANUP = 'tm.native.reminders.cleanup';
const MAX_PENDING = 32;
export const REMINDERS_CHANGED = 'tank-malle-reminders-changed';

interface ScheduledReminder extends ReminderCandidate { id: number }
interface ReminderState { uid: string; nextId: number; items: ScheduledReminder[] }

let queue = Promise.resolve();
function serialize<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run);
  queue = result.then(() => {}, () => {});
  return result;
}

export function reminderOwner(): string | null {
  return localStorage.getItem(OWNER);
}

export function reminderCleanupPending(): boolean {
  return localStorage.getItem(CLEANUP) === '1';
}

export async function nativeReminderStatus(uid?: string | null): Promise<'on' | 'off' | 'denied'> {
  const { display } = await LocalNotifications.checkPermissions();
  if (display === 'denied') return 'denied';
  return display === 'granted' && uid && reminderOwner() === uid ? 'on' : 'off';
}

export async function enableNativeReminders(uid: string, current: () => boolean) {
  const { display } = await LocalNotifications.requestPermissions();
  if (!current()) return 'off';
  if (display !== 'granted') return display === 'denied' ? 'denied' : 'off';
  if (reminderCleanupPending()) await clearNativeReminders();
  if (!current()) return 'off';
  localStorage.setItem(OWNER, uid);
  window.dispatchEvent(new Event(REMINDERS_CHANGED));
  return 'on';
}

export function clearNativeReminders(): Promise<void> {
  const changed = reminderOwner() !== null;
  localStorage.removeItem(OWNER);
  localStorage.setItem(CLEANUP, '1');
  if (changed) window.dispatchEvent(new Event(REMINDERS_CHANGED));
  return serialize(async () => {
    const { notifications } = await LocalNotifications.getPending();
    if (notifications.length) await LocalNotifications.cancel({ notifications });
    await LocalNotifications.removeAllDeliveredNotifications();
    localStorage.removeItem(STATE);
    localStorage.removeItem(CLEANUP);
  });
}

function readState(uid: string): ReminderState {
  try {
    const stored: ReminderState = JSON.parse(localStorage.getItem(STATE) ?? 'null');
    if (stored?.uid === uid && Array.isArray(stored.items) && Number.isInteger(stored.nextId)) return stored;
  } catch { /* Recover the current schedule from the operating system below. */ }
  return { uid, nextId: 1, items: [] };
}

export function reconcileNativeReminders(uid: string, candidates: ReminderCandidate[], current: () => boolean): Promise<void> {
  return serialize(async () => {
    const allowed = () => current() && reminderOwner() === uid;
    if (!allowed() || (await LocalNotifications.checkPermissions()).display !== 'granted' || !allowed()) return;

    const { notifications: pending } = await LocalNotifications.getPending();
    if (!allowed()) return;
    const state = readState(uid);
    const previous = new Map(state.items.map(item => [item.key, item]));
    const pendingIds = new Set(pending.map(item => item.id));
    for (const item of pending) {
      const extra = item.extra;
      if (extra?.uid === uid && typeof extra.key === 'string' && Number.isFinite(extra.at)) {
        previous.set(extra.key, { id: item.id, key: extra.key, day: extra.day, at: extra.at, route: extra.route });
      }
    }
    let nextId = Math.max(state.nextId, ...pending.map(item => item.id + 1));
    const now = Date.now();
    const keep = new Set<number>();
    const schedule: LocalNotificationSchema[] = [];
    const records: ScheduledReminder[] = [];
    for (const candidate of candidates) {
      const old = previous.get(candidate.key);
      const waiting = old && pendingIds.has(old.id);
      if (old && old.at <= now && !waiting) {
        records.push(old);
        continue;
      }
      if (keep.size + schedule.length >= MAX_PENDING) continue;
      if (waiting && old.day === candidate.day && old.route === candidate.route &&
          (old.at === candidate.at || old.at <= now || candidate.at - now <= 10_000)) {
        keep.add(old.id);
        records.push(old);
        continue;
      }
      const record = { ...candidate, id: nextId++ };
      records.push(record);
      schedule.push({
        id: record.id, title: 'טנק מלא', body: 'יש תזכורת חדשה לרכב שלך',
        isExactNotification: false,
        schedule: { at: new Date(Math.max(record.at, Date.now() + 500)) },
        extra: { uid, ...candidate },
      });
    }
    const cancel = pending.filter(item => !keep.has(item.id));
    if (cancel.length) await LocalNotifications.cancel({ notifications: cancel });
    if (!allowed()) return;
    if (schedule.length) await LocalNotifications.schedule({ notifications: schedule });
    localStorage.setItem(STATE, JSON.stringify({ uid, nextId, items: records }));
  });
}
