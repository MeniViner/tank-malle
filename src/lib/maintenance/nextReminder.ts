import { addMonths, JOBS, type Job, type MaintenancePlan, type ServiceEvent } from './model';

/** What a reminder sheet opened right after a service starts with. Every value stays editable. */
export interface PlanDefaults {
  title: string;
  job: Job;
  dueDay: string;
  dueOdometer: number | null;
  intervalMonths: number;
  intervalKm: number | null;
}

/** A year or 10,000 km, whichever comes first: a common periodic-service rhythm, offered as a starting point only. */
export const NEXT_REMINDER_MONTHS = 12;
export const NEXT_REMINDER_KM = 10_000;

/**
 * The reminder to offer after a newly saved service, or null when there is nothing to offer:
 * the service already advanced a reminder, or an active reminder for the same job exists.
 */
export function suggestNextReminder(service: ServiceEvent, plans: MaintenancePlan[], latestOdometer: number | null): PlanDefaults | null {
  if (service.completedPlanIds.length > 0) return null;
  const job: Job = service.jobs.includes('periodic') ? 'periodic' : service.jobs[0] ?? 'periodic';
  if (plans.some(plan => plan.active && plan.job === job)) return null;
  const base = service.odometer ?? latestOdometer;
  return {
    title: job === 'custom' && service.title.trim() ? service.title.trim() : JOBS[job],
    job,
    dueDay: addMonths(service.day, NEXT_REMINDER_MONTHS),
    dueOdometer: base === null ? null : base + NEXT_REMINDER_KM,
    intervalMonths: NEXT_REMINDER_MONTHS,
    intervalKm: base === null ? null : NEXT_REMINDER_KM,
  };
}
