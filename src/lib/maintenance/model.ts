/** Private numeric records only. No images, generated service intervals or inferred costs. */
export const CARE_COLLECTIONS = ['serviceEvents','maintenancePlans','vehicleExpenses','odometerReadings'] as const;
export type CareCollection = typeof CARE_COLLECTIONS[number];
export const JOBS = { periodic: 'טיפול תקופתי', oil: 'שמן ומסננים', tires: 'צמיגים', brakes: 'בלמים', battery: 'מצבר', repair: 'תיקון', custom: 'אחר' } as const;
export const EXPENSES = { insurance: 'ביטוח', registration: 'רישוי וטסט', parking: 'חניה', toll: 'כבישי אגרה', wash: 'שטיפה', other: 'אחר', refund: 'החזר / זיכוי' } as const;
export type Job = keyof typeof JOBS;
export interface CareBase { id: string; schemaVersion: 1; version: number }
export interface ServiceEvent extends CareBase {
  day: string; title: string; jobs: Job[]; odometer: number | null; costAgorot: number | null;
  garage: string; notes: string; completedPlanIds: string[];
}
export interface MaintenancePlan extends CareBase {
  title: string; job: Job; dueDay: string | null; dueOdometer: number | null;
  intervalMonths: number | null; intervalKm: number | null;
  basis: 'completion' | 'fixed' | 'manual'; source: 'manufacturer' | 'garage' | 'owner'; notes: string; active: boolean;
}
export interface VehicleExpense extends CareBase { day: string; category: keyof typeof EXPENSES; title: string; costAgorot: number | null; notes: string }
export interface OdometerReading extends CareBase { day: string; odometer: number; notes: string }
export type CareRecord = ServiceEvent | MaintenancePlan | VehicleExpense | OdometerReading;
export type CareData = { serviceEvents: ServiceEvent[]; maintenancePlans: MaintenancePlan[]; vehicleExpenses: VehicleExpense[]; odometerReadings: OdometerReading[] };
export const EMPTY_CARE: CareData = { serviceEvents: [], maintenancePlans: [], vehicleExpenses: [], odometerReadings: [] };
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2199-12-31') return false;
  const date = new Date(`${value}T12:00:00Z`); return Number.isFinite(+date) && date.toISOString().slice(0,10) === value;
}
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
const integer = (value: unknown, max: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const optionalInt = (value: unknown, max: number) => value === null || integer(value,max);
export function validCareRecord(collection: CareCollection, record: unknown): record is CareRecord {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>;
  const keys: Record<CareCollection,string[]> = {
    serviceEvents: ['id','schemaVersion','version','day','title','jobs','odometer','costAgorot','garage','notes','completedPlanIds'],
    maintenancePlans: ['id','schemaVersion','version','title','job','dueDay','dueOdometer','intervalMonths','intervalKm','basis','source','notes','active'],
    vehicleExpenses: ['id','schemaVersion','version','day','title','category','costAgorot','notes'],
    odometerReadings: ['id','schemaVersion','version','day','odometer','notes'],
  };
  if (!Object.hasOwn(keys,collection) || Object.keys(r).some(key=>!keys[collection].includes(key))) return false;
  if (!text(r.id,64) || !r.id || (r.id as string).includes('/') || r.schemaVersion !== 1 || !integer(r.version, 1e9) || !r.version || !text(r.notes,2000)) return false;
  if (collection === 'maintenancePlans') return text(r.title,120) && (r.title as string).trim().length > 0 && Object.hasOwn(JOBS,String(r.job)) &&
    (r.dueDay === null || validDay(r.dueDay)) && optionalInt(r.dueOdometer,9999999) && (r.dueDay !== null || r.dueOdometer !== null) &&
    optionalInt(r.intervalMonths,120) && (r.intervalMonths === null || (r.intervalMonths as number)>0) && optionalInt(r.intervalKm,1000000) && (r.intervalKm === null || (r.intervalKm as number)>0) &&
    ['completion','fixed','manual'].includes(String(r.basis)) && ['manufacturer','garage','owner'].includes(String(r.source)) && typeof r.active === 'boolean' &&
    (r.intervalMonths === null || r.dueDay !== null) && (r.intervalKm === null || r.dueOdometer !== null);
  if (!validDay(r.day)) return false;
  if (collection === 'odometerReadings') return integer(r.odometer,9999999);
  if (!text(r.title,120) || !(r.title as string).trim() || !optionalInt(r.costAgorot,100000000)) return false;
  if (collection === 'vehicleExpenses') return Object.hasOwn(EXPENSES,String(r.category));
  return optionalInt(r.odometer,9999999) && text(r.garage,160) && Array.isArray(r.jobs) && r.jobs.length>0 && r.jobs.length<=8 && r.jobs.every(j => Object.hasOwn(JOBS,String(j))) &&
    Array.isArray(r.completedPlanIds) && r.completedPlanIds.length<=8 && r.completedPlanIds.every(id => text(id,64) && !!id && !id.includes('/'));
}
export function carePayload(collection: CareCollection, record: CareRecord): Record<string, unknown> {
  if (!validCareRecord(collection, record)) throw new Error('פרטי הרשומה אינם תקינים');
  const { id: _id, ...payload } = record;
  return payload;
}
export function addMonths(day: string, months: number): string {
  const [y,m,d] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y,m-1+months,1,12));
  const last = new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  target.setUTCDate(Math.min(d,last)); return target.toISOString().slice(0,10);
}
export interface Mileage { odometer: number; day: string }
export function latestMileage(readings: Mileage[], today: string): Mileage | null {
  return readings.filter(r => validDay(r.day) && r.day <= today && integer(r.odometer,9999999))
    .sort((a,b) => b.day.localeCompare(a.day) || b.odometer-a.odometer)[0] ?? null;
}
/** Recomputed from completed work: editing/deleting history cannot leave a stale stored deadline. */
export function nextDue(plan: MaintenancePlan, events: ServiceEvent[], asOf = localDay()): { day: string | null; odometer: number | null; completed: boolean; needsMileage?: boolean } {
  const done = events.filter(e => e.day <= asOf && e.completedPlanIds.includes(plan.id)).sort((a,b) => b.day.localeCompare(a.day) || (b.odometer ?? -1)-(a.odometer ?? -1));
  const last = done[0];
  if (!last || plan.basis === 'manual') return { day: plan.dueDay, odometer: plan.dueOdometer, completed: !!last && plan.basis === 'manual' };
  if (plan.intervalMonths === null && plan.intervalKm === null) return { day: null, odometer: null, completed: true };
  let day = plan.dueDay, odometer = plan.dueOdometer;
  if (plan.basis === 'completion') {
    day = plan.intervalMonths === null ? null : addMonths(last.day,plan.intervalMonths);
    odometer = plan.intervalKm === null || last.odometer === null ? null : last.odometer+plan.intervalKm;
  } else {
    if (day && plan.intervalMonths) { let count = 1; while (addMonths(plan.dueDay!,count*plan.intervalMonths) <= last.day && count<3000) count++; day = addMonths(plan.dueDay!,count*plan.intervalMonths); }
    else day = null;
    odometer = plan.dueOdometer !== null && plan.intervalKm && last.odometer !== null ? plan.dueOdometer + Math.max(1,Math.floor((last.odometer-plan.dueOdometer)/plan.intervalKm)+1)*plan.intervalKm : null;
  }
  return { day, odometer, completed: false, ...(plan.intervalKm !== null && last.odometer === null ? { needsMileage: true } : {}) };
}
export function dueStatus(due: ReturnType<typeof nextDue>, mileage: Mileage | null, today: string): 'done'|'due'|'soon'|'unknown'|'later' {
  if (due.completed) return 'done';
  if ((due.day !== null && due.day <= today) || (due.odometer !== null && mileage !== null && mileage.odometer >= due.odometer)) return 'due';
  if (due.needsMileage) return 'unknown';
  const days = due.day ? (Date.parse(`${due.day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`))/86400000 : Infinity;
  if (!due.day && due.odometer === null) return 'unknown';
  if (due.odometer !== null && (!mileage || (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${mileage.day}T12:00:00Z`))/86400000 > 30)) return 'unknown';
  if (days<=30) return 'soon';
  if (due.odometer !== null && mileage !== null && due.odometer-mileage.odometer<=1000) return 'soon';
  return 'later';
}

/** Only compare different calendar days: intra-day order is not known for manual service dates. */
export function mileageIssue(reading: Mileage, others: Mileage[]): string | null {
  const previous = others.filter(r=>r.day < reading.day).sort((a,b)=>b.odometer-a.odometer)[0];
  const next = others.filter(r=>r.day > reading.day).sort((a,b)=>a.odometer-b.odometer)[0];
  if (previous && reading.odometer < previous.odometer) return `הקילומטראז׳ נמוך מקריאה קודמת (${previous.odometer.toLocaleString('he-IL')} ק״מ). בדקו את התאריך או תקנו את הקריאה הקודמת.`;
  if (next && reading.odometer > next.odometer) return `הקילומטראז׳ גבוה מקריאה מאוחרת יותר (${next.odometer.toLocaleString('he-IL')} ק״מ). בדקו את התאריך או הקריאה.`;
  return null;
}

export function serviceJobs(event: ServiceEvent): string { return event.jobs.map(j=>JOBS[j]).join(" · "); }
