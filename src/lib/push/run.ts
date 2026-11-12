import { EMPTY_CARE, validCareRecord, type CareCollection, type CareData } from '../maintenance/model';
import type { UserSettings } from '../types';
import { vehicleDocumentOccurrences } from '../vehicle/documentNotifications';
import { notificationId, validVehicleRecord, type NotificationState } from '../vehicle/model';
import { notificationPreferences } from '../vehicle/notificationPreferences';
import { pushDigest, pushKey, type PushItem } from './digest';
import { notificationLink } from './link';

/** Raw documents as the scheduled sender reads them (Firestore Admin SDK, `id` added). */
export type RawDoc = Record<string, unknown> & { id: string };
export interface PushSubscriptionRow { uid: string; id: string; endpoint: string; p256dh: string; auth: string; createdAt?: number | null }
export interface PushStore {
  subscriptions(): Promise<PushSubscriptionRow[]>;
  profile(uid: string): Promise<Record<string, unknown> | null>;
  vehicles(uid: string): Promise<RawDoc[]>;
  collection(uid: string, vehicleId: string, name: string): Promise<RawDoc[]>;
  /**
   * The newest documents of a collection by a time field that `keep` accepts, up to `limit`: the
   * current odometer needs only the last readings. Rows `keep` rejects (a tank level without an
   * odometer) do not count toward the limit, so they cannot hide an older reading.
   */
  latest(uid: string, vehicleId: string, name: string, field: string, limit: number, keep: (row: RawDoc) => boolean): Promise<RawDoc[]>;
  /** Which of these ids were already pushed. */
  sentIds(uid: string, ids: string[]): Promise<Set<string>>;
  markSent(uid: string, items: { id: string; occurrence: string }[], sentAt: number): Promise<void>;
  removeSubscription(uid: string, id: string): Promise<void>;
}
export interface PushMessage { title: string; body: string; url: string; tag: string; urgent: boolean }
export type SendResult = 'sent' | 'gone' | 'failed';
export type PushSender = (subscription: PushSubscriptionRow, message: PushMessage) => Promise<SendResult>;
/** `errors`: accounts whose run stopped on an unexpected error; the others were still served. */
export interface PushRunReport { users: number; devices: number; messages: number; occurrences: number; removed: number; failed: number; errors: number }

/** More new items than this in one run become a summary notification per vehicle. */
export const MAX_SEPARATE_PUSHES = 3;
/** Devices served per account, newest first: a phone, a tablet, a computer or two. More is not a real account's use. */
export const MAX_DEVICES = 10;

const millis = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') return (value as { toMillis: () => number }).toMillis();
  return null;
};

/** Readings kept per vehicle for the current odometer. */
const LATEST_READINGS = 10;

/**
 * One vehicle's notifications, reading as little as the answer needs: every read here is
 * repeated daily for every subscribed account, against a free quota the live app shares.
 * Documents come from the vehicle itself; history is read only when an active reminder exists.
 */
async function vehicleItems(store: PushStore, uid: string, vehicle: RawDoc, settings: Partial<UserSettings>, today: string, nameVehicle: boolean): Promise<PushItem[]> {
  const care: CareData = { ...EMPTY_CARE };
  const read = async (name: CareCollection) => { (care as Record<string, unknown>)[name] = (await store.collection(uid, vehicle.id, name)).filter(row => validCareRecord(name, row)); };
  await read('maintenancePlans');
  const reminders = care.maintenancePlans.some(plan => plan.active);
  const shape = { id: vehicle.id, nickname: vehicle.nickname as string | undefined, make: vehicle.make as string | undefined, model: vehicle.model as string | undefined, docs: vehicle.docs };
  if (!reminders && !vehicleDocumentOccurrences(shape, today).length) return [];
  let fillups: { id: string; date: number; odometer: number }[] = [], observations: { id: string; observedAt: number; odometer: number }[] = [];
  if (reminders) {
    await read('serviceEvents'); await read('odometerReadings');
    const reading = (field: string) => (row: RawDoc) => millis(row[field]) !== null && typeof row.odometer === 'number' && Number.isFinite(row.odometer);
    fillups = (await store.latest(uid, vehicle.id, 'fillups', 'date', LATEST_READINGS, reading('date'))).filter(reading('date'))
      .map(row => ({ id: row.id, date: millis(row.date)!, odometer: row.odometer as number }));
    observations = (await store.latest(uid, vehicle.id, 'observations', 'observedAt', LATEST_READINGS, reading('observedAt'))).filter(reading('observedAt'))
      .map(row => ({ id: row.id, observedAt: millis(row.observedAt)!, odometer: row.odometer as number }));
  }
  const states = (await store.collection(uid, vehicle.id, 'notificationStates')).filter(row => validVehicleRecord('notificationStates', row)) as unknown as NotificationState[];
  return pushDigest({ vehicle: shape, care, fillups, observations, states, settings, today, nameVehicle });
}

const sentId = (item: PushItem): string => notificationId(pushKey(item));

const single = (item: PushItem) => ({ message: { title: item.title, body: item.body, url: item.url, tag: sentId(item), urgent: item.urgent }, items: [item] });

/**
 * Each message with the items it stands for: one per item, or, when there are many, one summary
 * per vehicle. The app's list shows one vehicle at a time, so a summary opens that vehicle's list.
 */
function messagesFor(items: PushItem[]): { message: PushMessage; items: PushItem[] }[] {
  if (items.length <= MAX_SEPARATE_PUSHES) return items.map(single);
  const byVehicle = new Map<string, PushItem[]>();
  for (const item of items) byVehicle.set(item.vehicleId, [...byVehicle.get(item.vehicleId) ?? [], item]);
  return [...byVehicle].map(([vehicleId, group]) => group.length === 1 ? single(group[0]) : {
    message: {
      title: `${group.length} התראות חדשות${group[0].vehicleName ? ` · ${group[0].vehicleName}` : ''}`,
      body: group.slice(0, 3).map(item => item.title).join(' · '),
      url: notificationLink(vehicleId, '/notifications'), tag: `digest:${vehicleId}`, urgent: group.some(item => item.urgent),
    },
    items: group,
  });
}

/**
 * One scheduled run: for each account with a registered device, work out the time-driven
 * notifications (pushDigest), drop what was already pushed, and send the rest to every
 * device. A notification is recorded as sent once any device accepted its own message; one
 * that every device failed stays unsent and the next run tries it again, whatever happened
 * to the others. Expired devices are removed.
 */
export async function runPush(store: PushStore, send: PushSender, { today, now, dryRun = false, warn = () => {} }: { today: string; now: number; dryRun?: boolean; warn?: (message: string) => void }): Promise<PushRunReport> {
  const report: PushRunReport = { users: 0, devices: 0, messages: 0, occurrences: 0, removed: 0, failed: 0, errors: 0 };
  const byUser = new Map<string, PushSubscriptionRow[]>();
  for (const sub of await store.subscriptions()) byUser.set(sub.uid, [...byUser.get(sub.uid) ?? [], sub]);
  // One account's failure (a refused read, a quota error) must not cost the others their reminders.
  for (const [uid, all] of byUser) {
    // Newest devices first, capped: a flood of registrations cannot stretch the run for everyone else.
    const devices = [...all].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, MAX_DEVICES);
    try { await runUser(store, send, uid, devices, report, { today, now, dryRun }); } catch (error) { report.errors += 1; warn(`push run failed for one account: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return report;
}

async function runUser(store: PushStore, send: PushSender, uid: string, devices: PushSubscriptionRow[], report: PushRunReport, { today, now, dryRun }: { today: string; now: number; dryRun: boolean }): Promise<void> {
  const profile = await store.profile(uid);
  if (!profile || profile.deletionPending === true) return;
  report.users += 1; report.devices += devices.length;
  const settings = (profile.settings && typeof profile.settings === 'object' ? profile.settings : {}) as Partial<UserSettings>;
  if (!notificationPreferences(settings).reminders) return;
  const vehicles = (await store.vehicles(uid)).filter(vehicle => vehicle.archived !== true && vehicle.deletionPending !== true);
  const candidates: PushItem[] = [];
  for (const vehicle of vehicles) for (const item of await vehicleItems(store, uid, vehicle, settings, today, vehicles.length > 1))
    if (!candidates.some(other => pushKey(other) === pushKey(item))) candidates.push(item);
  if (!candidates.length) return;
  const sent = await store.sentIds(uid, candidates.map(sentId));
  const fresh = candidates.filter(item => !sent.has(sentId(item)));
  if (!fresh.length) return;
  const messages = messagesFor(fresh);
  if (dryRun) { report.messages += messages.length * devices.length; report.occurrences += fresh.length; return; }
  const delivered = new Set<PushItem>();
  try {
    for (const device of devices) {
      let gone = false;
      for (const { message, items } of messages) {
        const result = await send(device, message);
        if (result === 'gone') { gone = true; break; }
        if (result === 'sent') { for (const item of items) delivered.add(item); report.messages += 1; } else report.failed += 1;
      }
      if (gone) { await store.removeSubscription(uid, device.id); report.removed += 1; }
    }
  } finally {
    // Whatever interrupted the loop, record what a device already accepted, so it is not pushed twice.
    if (delivered.size) {
      await store.markSent(uid, [...delivered].map(item => ({ id: sentId(item), occurrence: pushKey(item) })), now);
      report.occurrences += delivered.size;
    }
  }
}
