import type { CareData } from '../maintenance/model';
import type { TankObservation } from '../tank/types';
import type { Fillup, UserSettings } from '../types';
import { mileageEvidence, reminderRows } from '../vehicle/derived';
import { vehicleDocumentOccurrences } from '../vehicle/documentNotifications';
import { notificationId, type NotificationState } from '../vehicle/model';
import { notificationPreferences } from '../vehicle/notificationPreferences';
import { notificationLink } from './link';

/**
 * One phone notification. `occurrence` is the identity the in-app list uses inside one vehicle;
 * across an account the identity is the vehicle and the occurrence together (`pushKey`).
 * `url` selects that vehicle before opening the screen.
 */
export interface PushItem { occurrence: string; vehicleId: string; title: string; body: string; url: string; urgent: boolean }

/** What a push is sent once for: two vehicles can share an occurrence (the same test date), and each gets its own push. */
export const pushKey = (item: Pick<PushItem, 'vehicleId' | 'occurrence'>): string => `${item.vehicleId}:${item.occurrence}`;

export interface PushDigestInput {
  vehicle: { id: string; nickname?: string | null; make?: string | null; model?: string | null; docs?: unknown };
  care: CareData;
  fillups: Pick<Fillup, 'id' | 'date' | 'odometer'>[];
  observations: Pick<TankObservation, 'id' | 'observedAt' | 'odometer'>[];
  states: NotificationState[];
  settings: Partial<UserSettings>;
  today: string;
  /** Name the car in the body when the account has more than one. */
  nameVehicle: boolean;
}

/**
 * The time-driven notifications worth a push: vehicle documents (test, insurance) and
 * maintenance reminders that are due or near. It reads the same pure functions as the
 * in-app notifications list, honours the user's preferences, and skips anything the user
 * already read, archived, snoozed or deleted there.
 */
export function pushDigest(input: PushDigestInput): PushItem[] {
  const prefs = notificationPreferences(input.settings);
  if (!prefs.reminders) return [];
  const { vehicle, today } = input;
  const name = (vehicle.nickname || `${vehicle.make ?? ''} ${vehicle.model ?? ''}`).trim();
  const prefix = input.nameVehicle && name ? `${name} · ` : '';
  const items: PushItem[] = [];
  for (const doc of vehicleDocumentOccurrences(vehicle, today))
    items.push({ occurrence: doc.occurrence, vehicleId: vehicle.id, title: doc.title, body: prefix + doc.detail, url: notificationLink(vehicle.id, doc.to), urgent: doc.urgent });
  const evidence = mileageEvidence(input.fillups as Fillup[], input.observations as TankObservation[], input.care);
  for (const row of reminderRows(input.care, evidence, today, { days: prefs.leadDays, km: prefs.leadKm })) {
    if (!row.plan.active || (row.status !== 'due' && row.status !== 'soon')) continue;
    items.push({ occurrence: row.occurrence, vehicleId: vehicle.id, title: row.plan.title,
      body: prefix + (row.status === 'due' ? 'הגיע מועד הטיפול' : 'הטיפול מתקרב'),
      url: notificationLink(vehicle.id, `/vehicle/reminders/${encodeURIComponent(row.plan.id)}`), urgent: row.status === 'due' });
  }
  return items.filter(item => {
    const state = input.states.find(s => s.id === notificationId(item.occurrence) && s.occurrence === item.occurrence);
    return !state || !(state.deleted || state.archived || state.read || (state.snoozeUntilDay !== null && state.snoozeUntilDay > today));
  });
}
