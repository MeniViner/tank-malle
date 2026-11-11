import { CARE_COLLECTIONS, EMPTY_CARE, validCareRecord, type CareData } from '../maintenance/model';
import type { UserSettings } from '../types';
import { notificationId, validVehicleRecord, type NotificationState } from '../vehicle/model';
import { pushDigest, pushKey, type PushItem } from './digest';

/** Raw documents as the scheduled sender reads them (Firestore Admin SDK, `id` added). */
export type RawDoc = Record<string, unknown> & { id: string };
export interface PushSubscriptionRow { uid: string; id: string; endpoint: string; p256dh: string; auth: string }
export interface PushStore {
  subscriptions(): Promise<PushSubscriptionRow[]>;
  profile(uid: string): Promise<Record<string, unknown> | null>;
  vehicles(uid: string): Promise<RawDoc[]>;
  collection(uid: string, vehicleId: string, name: string): Promise<RawDoc[]>;
  sentIds(uid: string): Promise<Set<string>>;
  markSent(uid: string, items: { id: string; occurrence: string }[], sentAt: number): Promise<void>;
  removeSubscription(uid: string, id: string): Promise<void>;
}
export interface PushMessage { title: string; body: string; url: string; tag: string; urgent: boolean }
export type SendResult = 'sent' | 'gone' | 'failed';
export type PushSender = (subscription: PushSubscriptionRow, message: PushMessage) => Promise<SendResult>;
export interface PushRunReport { users: number; devices: number; messages: number; occurrences: number; removed: number; failed: number }

/** More new items than this in one run become one summary notification. */
export const MAX_SEPARATE_PUSHES = 3;

const millis = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') return (value as { toMillis: () => number }).toMillis();
  return null;
};

async function vehicleItems(store: PushStore, uid: string, vehicle: RawDoc, settings: Partial<UserSettings>, today: string, nameVehicle: boolean): Promise<PushItem[]> {
  const care: CareData = { ...EMPTY_CARE };
  for (const name of CARE_COLLECTIONS) (care as Record<string, unknown>)[name] = (await store.collection(uid, vehicle.id, name)).filter(row => validCareRecord(name, row));
  const fillups = (await store.collection(uid, vehicle.id, 'fillups')).flatMap(row => {
    const date = millis(row.date), odometer = row.odometer;
    return date !== null && typeof odometer === 'number' && Number.isFinite(odometer) ? [{ id: row.id, date, odometer }] : [];
  });
  const observations = (await store.collection(uid, vehicle.id, 'observations')).flatMap(row => {
    const observedAt = millis(row.observedAt), odometer = row.odometer;
    return observedAt !== null && typeof odometer === 'number' && Number.isFinite(odometer) ? [{ id: row.id, observedAt, odometer }] : [];
  });
  const states = (await store.collection(uid, vehicle.id, 'notificationStates')).filter(row => validVehicleRecord('notificationStates', row)) as unknown as NotificationState[];
  return pushDigest({ vehicle: { id: vehicle.id, nickname: vehicle.nickname as string | undefined, make: vehicle.make as string | undefined,
    model: vehicle.model as string | undefined, docs: vehicle.docs }, care, fillups, observations, states, settings, today, nameVehicle });
}

const sentId = (item: PushItem): string => notificationId(pushKey(item));

/** Each message with the items it stands for: one per item, or one summary for all of them. */
function messagesFor(items: PushItem[]): { message: PushMessage; items: PushItem[] }[] {
  if (items.length <= MAX_SEPARATE_PUSHES) return items.map(item => ({ message: { title: item.title, body: item.body, url: item.url, tag: sentId(item), urgent: item.urgent }, items: [item] }));
  return [{ message: { title: `${items.length} התראות חדשות`, body: items.slice(0, 3).map(item => item.title).join(' · '), url: '/notifications', tag: 'digest', urgent: items.some(item => item.urgent) }, items }];
}

/**
 * One scheduled run: for each account with a registered device, work out the time-driven
 * notifications (pushDigest), drop what was already pushed, and send the rest to every
 * device. A notification is recorded as sent once any device accepted its own message; one
 * that every device failed stays unsent and the next run tries it again, whatever happened
 * to the others. Expired devices are removed.
 */
export async function runPush(store: PushStore, send: PushSender, { today, now, dryRun = false }: { today: string; now: number; dryRun?: boolean }): Promise<PushRunReport> {
  const report: PushRunReport = { users: 0, devices: 0, messages: 0, occurrences: 0, removed: 0, failed: 0 };
  const byUser = new Map<string, PushSubscriptionRow[]>();
  for (const sub of await store.subscriptions()) byUser.set(sub.uid, [...byUser.get(sub.uid) ?? [], sub]);
  for (const [uid, devices] of byUser) {
    const profile = await store.profile(uid);
    if (!profile || profile.deletionPending === true) continue;
    report.users += 1; report.devices += devices.length;
    const settings = (profile.settings && typeof profile.settings === 'object' ? profile.settings : {}) as Partial<UserSettings>;
    const vehicles = (await store.vehicles(uid)).filter(vehicle => vehicle.archived !== true);
    const sent = await store.sentIds(uid);
    const fresh: PushItem[] = [];
    for (const vehicle of vehicles) for (const item of await vehicleItems(store, uid, vehicle, settings, today, vehicles.length > 1))
      if (!sent.has(sentId(item)) && !fresh.some(other => pushKey(other) === pushKey(item))) fresh.push(item);
    if (!fresh.length) continue;
    const messages = messagesFor(fresh);
    if (dryRun) { report.messages += messages.length * devices.length; report.occurrences += fresh.length; continue; }
    const delivered = new Set<PushItem>();
    for (const device of devices) {
      let gone = false;
      for (const { message, items } of messages) {
        const result = await send(device, message);
        if (result === 'gone') { gone = true; break; }
        if (result === 'sent') { for (const item of items) delivered.add(item); report.messages += 1; } else report.failed += 1;
      }
      if (gone) { await store.removeSubscription(uid, device.id); report.removed += 1; }
    }
    if (delivered.size) {
      await store.markSent(uid, [...delivered].map(item => ({ id: sentId(item), occurrence: pushKey(item) })), now);
      report.occurrences += delivered.size;
    }
  }
  return report;
}
