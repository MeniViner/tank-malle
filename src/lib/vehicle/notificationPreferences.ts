import type { UserSettings } from '../types';
export const REMINDER_LEAD_DAYS = [1, 3, 7, 14] as const;
export const REMINDER_LEAD_KM = [500, 1000, 2000] as const;
export function notificationPreferences(settings: Partial<UserSettings>) {
  return {
    reminders: settings.reminderNotifications !== false,
    issues: settings.issueNotifications !== false,
    sync: settings.syncNotifications !== false,
    prices: settings.priceNotifications !== false,
    leadDays: REMINDER_LEAD_DAYS.includes(settings.reminderLeadDays as typeof REMINDER_LEAD_DAYS[number]) ? settings.reminderLeadDays! : 7,
    leadKm: REMINDER_LEAD_KM.includes(settings.reminderLeadKm as typeof REMINDER_LEAD_KM[number]) ? settings.reminderLeadKm! : 1000,
  };
}
