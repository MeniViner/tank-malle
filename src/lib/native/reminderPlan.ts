import { localDay } from '../maintenance/model';
import { pushDigest, pushKey, type PushDigestInput } from '../push/digest';
import { reminderRows, mileageEvidence } from '../vehicle/derived';
import { readVehicleDocument, VEHICLE_DOC_KEYS } from '../vehicle/documents';
import { notificationPreferences } from '../vehicle/notificationPreferences';

export interface ReminderCandidate {
  key: string;
  day: string;
  at: number;
  route: string;
}

function before(day: string, days: number): string {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function planReminders(input: PushDigestInput, now: Date): ReminderCandidate[] {
  const { today, vehicle, care, settings } = input;
  const preferences = notificationPreferences(settings);
  if (!preferences.reminders) return [];

  const days = new Set([today]);
  for (const key of VEHICLE_DOC_KEYS) {
    const document = readVehicleDocument(vehicle.docs, key, today);
    if (!document.due || document.state !== 'ready') continue;
    for (const offset of [30, 7, -1]) days.add(before(document.due, offset));
  }
  const evidence = mileageEvidence(input.fillups as Parameters<typeof mileageEvidence>[0], input.observations as Parameters<typeof mileageEvidence>[1], care);
  for (const row of reminderRows(care, evidence, today, { days: preferences.leadDays, km: preferences.leadKm })) {
    if (!row.plan.active || row.due.completed || !row.due.day) continue;
    days.add(before(row.due.day, preferences.leadDays));
    days.add(row.due.day);
  }
  for (const state of input.states) {
    if (state.snoozeUntilDay) days.add(state.snoozeUntilDay);
  }

  const first = new Map<string, ReminderCandidate>();
  for (const day of [...days].filter(day => day >= today).sort()) {
    const morning = new Date(day + 'T09:00:00').getTime();
    const at = Math.max(morning, now.getTime() + 10_000);
    for (const item of pushDigest({ ...input, today: day })) {
      const key = pushKey(item);
      if (!first.has(key)) first.set(key, { key, day: localDay(new Date(at)), at, route: item.url });
    }
  }
  return [...first.values()];
}
