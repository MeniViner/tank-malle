import { CARE_COLLECTIONS, validCareRecord, type CareBase, type CareCollection, type CareRecord, validDay } from '../maintenance/model';
export const EXTRA_COLLECTIONS = ['vehicleIssues', 'notificationStates'] as const;
export const VEHICLE_COLLECTIONS = [...CARE_COLLECTIONS, ...EXTRA_COLLECTIONS] as const;
export type VehicleCollection = typeof VEHICLE_COLLECTIONS[number];
export interface VehicleIssue extends CareBase {
  day: string; title: string; symptoms: string; odometer: number | null;
  importance: 'normal' | 'important'; status: 'open' | 'watching' | 'resolved'; notes: string;
  serviceEventIds: string[];
  history: { day: string; status: VehicleIssue['status']; note: string }[];
}
export interface NotificationState extends CareBase {
  occurrence: string; read: boolean; archived: boolean; snoozeUntilDay: string | null;
}
export type VehicleRecord = CareRecord | VehicleIssue | NotificationState;
export interface ExtraData { vehicleIssues: VehicleIssue[]; notificationStates: NotificationState[] }
export const EMPTY_EXTRA: ExtraData = { vehicleIssues: [], notificationStates: [] };
export function validVehicleRecord(name: VehicleCollection, value: unknown): value is VehicleRecord {
  if ((CARE_COLLECTIONS as readonly string[]).includes(name)) return validCareRecord(name as CareCollection, value);
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const string = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
  if (!string(r.id,64) || !r.id || String(r.id).includes('/') || r.schemaVersion !== 1 || !Number.isInteger(r.version) || Number(r.version)<1 || Number(r.version)>1e9) return false;
  const allowed = name === 'vehicleIssues' ? ['id','schemaVersion','version','day','title','symptoms','odometer','importance','status','notes','serviceEventIds','history'] : ['id','schemaVersion','version','occurrence','read','archived','snoozeUntilDay'];
  if (Object.keys(r).some(k=>!allowed.includes(k)) || allowed.some(k=>!Object.hasOwn(r,k))) return false;
  if (name === 'notificationStates') return string(r.occurrence,300) && !!r.occurrence && typeof r.read==='boolean' && typeof r.archived==='boolean' && (r.snoozeUntilDay===null || validDay(r.snoozeUntilDay));
  return validDay(r.day) && string(r.title,120) && !!String(r.title).trim() && string(r.symptoms,2000) && string(r.notes,2000) &&
    (r.odometer===null || (Number.isInteger(r.odometer) && Number(r.odometer)>=0 && Number(r.odometer)<=9999999)) && ['normal','important'].includes(String(r.importance)) && ['open','watching','resolved'].includes(String(r.status)) &&
    Array.isArray(r.serviceEventIds) && r.serviceEventIds.length<=8 && r.serviceEventIds.every(id=>string(id,64) && !!id && !id.includes('/')) && new Set(r.serviceEventIds).size===r.serviceEventIds.length &&
    Array.isArray(r.history) && r.history.length<=10 && r.history.every(h=>h && typeof h==='object' && Object.keys(h).length===3 && validDay(h.day) && ['open','watching','resolved'].includes(h.status) && string(h.note,500));
}
/** History is display-only owner text in storage; JSON strings keep Firestore rules
 * below their expression budget. Decode and validate every field before displaying/editing. */
export function decodeVehicleRecord(name:VehicleCollection,value:unknown):unknown {
  if(name!=='vehicleIssues'||!value||typeof value!=='object')return value;
  const r=value as Record<string,unknown>;
  if(!Array.isArray(r.history))return value;
  try{return {...r,history:r.history.map(h=>typeof h==='string'?JSON.parse(h):h)};}catch{return value;}
}
export function vehiclePayload(name: VehicleCollection, record: VehicleRecord): Record<string, unknown> {
  if (!validVehicleRecord(name,record)) throw new Error('פרטי הרשומה אינם תקינים');
  const {id: _id,...payload}=record;return name==='vehicleIssues'?{...payload,history:(record as VehicleIssue).history.map(h=>JSON.stringify(h))}:payload;
}
/** Deterministic document identity; full occurrence is also compared before applying state. */
export function notificationId(occurrence: string): string {
  let a=2166136261,b=5381; for (const ch of occurrence) { a=Math.imul(a^ch.charCodeAt(0),16777619); b=Math.imul(b,33)^ch.charCodeAt(0); }
  return `note-${(a>>>0).toString(16)}-${(b>>>0).toString(16)}`;
}
