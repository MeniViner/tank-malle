import { addMonths, validDay } from '../maintenance/model';

export type SnoozePresetKey = 'tomorrow' | 'week' | 'month';
export interface SnoozePreset { key: SnoozePresetKey; label: string; day: string }

/** Civil-day arithmetic in UTC noon, so no time zone or DST edge moves the day. */
export function addCivilDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

/**
 * v3 snooze presets (tomorrow / in a week / in a month). Each maps to the
 * existing `snoozeUntilDay` civil day — the same field the free date picker
 * writes — so nothing new is stored and the reminder's due date never moves.
 * "In a month" is the same day next calendar month, clamped to its last day.
 */
export function snoozePresets(today: string): SnoozePreset[] {
  if (!validDay(today)) return [];
  return [
    { key: 'tomorrow', label: 'מחר', day: addCivilDays(today, 1) },
    { key: 'week', label: 'בעוד שבוע', day: addCivilDays(today, 7) },
    { key: 'month', label: 'בעוד חודש', day: addMonths(today, 1) },
  ];
}
