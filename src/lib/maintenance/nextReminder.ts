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
 * The jobs that rhythm fits, in the order they are offered. Tires, brakes and a battery last
 * years and depend on wear, a repair does not repeat, and an electric car has no oil to change.
 */
const OFFERED: Job[] = ['periodic', 'oil'];

export interface SuggestContext {
  /** Every service of the vehicle, the new one included or not. */
  services: ServiceEvent[];
  /** The latest known reading and its day, or null. */
  latest: { odometer: number; day: string } | null;
  today: string;
  ev: boolean;
}

/**
 * The reminder to offer after a newly saved service, or null when there is nothing worth
 * offering: the service already advanced a reminder, its job does not repeat on this rhythm, an
 * active reminder for the job exists, a later service of the job is already recorded, or the
 * service is old enough that the next one would already be due (back-filled history).
 */
export function suggestNextReminder(service: ServiceEvent, plans: MaintenancePlan[], { services, latest, today, ev }: SuggestContext): PlanDefaults | null {
  if (service.completedPlanIds.length > 0) return null;
  const job = OFFERED.find(candidate => service.jobs.includes(candidate) && !(ev && candidate === 'oil') && !plans.some(plan => plan.active && plan.job === candidate));
  if (!job) return null;
  if (services.some(other => other.id !== service.id && other.jobs.includes(job) && other.day > service.day)) return null;
  // The latest reading stands in for a missing odometer only if it is not older than the service.
  const base = service.odometer ?? (latest && latest.day <= service.day ? latest.odometer : null);
  const dueDay = addMonths(service.day, NEXT_REMINDER_MONTHS);
  const dueOdometer = base === null ? null : base + NEXT_REMINDER_KM;
  if (dueDay <= today || (dueOdometer !== null && latest && dueOdometer <= latest.odometer)) return null;
  return { title: JOBS[job], job, dueDay, dueOdometer, intervalMonths: NEXT_REMINDER_MONTHS, intervalKm: base === null ? null : NEXT_REMINDER_KM };
}
