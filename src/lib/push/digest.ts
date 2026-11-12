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
export interface PushItem {
  occurrence: string; vehicleId: string; title: string; body: string; url: string; urgent: boolean;
  /** The car's name when the account has more than one, else ''. */
  vehicleName: string;
  /**
   * A reminder's stage. The in-app occurrence stays the same from "approaching" to "due", but
   * each stage is worth its own push: one that was pushed early must still be pushed on the day.
   */
  stage?: 'soon' | 'due';
}

/**
 * What a push is sent once for: two vehicles can share an occurrence (the same test date), and
 * each gets its own push; a reminder that became due is pushed again. ("soon" keeps the plain key,
 * so reminders pushed before stages existed are not repeated.)
 */
export const pushKey = (item: Pick<PushItem, 'vehicleId' | 'occurrence' | 'stage'>): string => `${item.vehicleId}:${item.occurrence}${item.stage === 'due' ? ':due' : ''}`;

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
  const vehicleName = input.nameVehicle ? name : '';
  const prefix = vehicleName ? `${vehicleName} · ` : '';
  const items: PushItem[] = [];
  for (const doc of vehicleDocumentOccurrences(vehicle, today))
    items.push({ occurrence: doc.occurrence, vehicleId: vehicle.id, vehicleName, title: doc.title, body: prefix + doc.detail, url: notificationLink(vehicle.id, doc.to), urgent: doc.urgent });
  const evidence = mileageEvidence(input.fillups as Fillup[], input.observations as TankObservation[], input.care);
  for (const row of reminderRows(input.care, evidence, today, { days: prefs.leadDays, km: prefs.leadKm })) {
    if (!row.plan.active || (row.status !== 'due' && row.status !== 'soon')) continue;
    items.push({ occurrence: row.occurrence, vehicleId: vehicle.id, vehicleName, stage: row.status, title: row.plan.title,
      body: prefix + (row.status === 'due' ? 'הגיע מועד הטיפול' : 'הטיפול מתקרב'),
      url: notificationLink(vehicle.id, `/vehicle/reminders/${encodeURIComponent(row.plan.id)}`), urgent: row.status === 'due' });
  }
  return items.filter(item => {
    const state = input.states.find(s => s.id === notificationId(item.occurrence) && s.occurrence === item.occurrence);
    // Reading the "approaching" row in the app does not silence the day it becomes due.
    const read = state?.read && item.stage !== 'due';
    return !state || !(state.deleted || state.archived || read || (state.snoozeUntilDay !== null && state.snoozeUntilDay > today));
  });
}
