import { collection, doc, getDocFromServer, getDocsFromServer, type Firestore } from 'firebase/firestore';
import { VEHICLE_COLLECTIONS, decodeVehicleRecord, validVehicleRecord } from './model';
import { parseFillupDocument } from '../fillupSerializer';
import type { OutboxOperation, OutboxPayload } from '../outbox';
import { carePayloadMatches } from '../maintenance/persistence';
export const BACKUP_VEHICLE_COLLECTIONS=['fillups','observations','tankPlans',...VEHICLE_COLLECTIONS] as const;
export const BACKUP_ACCOUNT_COLLECTIONS=['personalPriceRules','stationPriceReports','importBatches'] as const;
export interface BackupEntry { path:string; data:OutboxPayload }
export interface UnifiedBackup {
  format:'tank-maleh-account'; version:2; owner:string; exportedAt:string; cloud:{confirmed:true;entries:BackupEntry[];settings:Record<string,unknown>};
  local:{pendingOperations:OutboxOperation[];drafts:{key:string;value:string}[];attachmentsIncluded:false};
}
const id=(s:string)=>!!s&&s.length<=128&&!s.includes('/')&&s!=='.'&&s!=='..';
export function backupPath(path:unknown):path is string {
  if(typeof path!=='string')return false;const p=path.split('/');
  return p.every(id) && (p[0]==='vehicles' && (p.length===2 || p.length===4 && (BACKUP_VEHICLE_COLLECTIONS as readonly string[]).includes(p[2])) || p.length===2 && (BACKUP_ACCOUNT_COLLECTIONS as readonly string[]).includes(p[0]));
}
/** Numeric timestamp serialization uses the same import/write codec as existing records. */
export function backupValue(v:unknown):unknown {
  if(v&&typeof v==='object'&&'toMillis' in v&&typeof v.toMillis==='function')return v.toMillis();
  if(Array.isArray(v))return v.map(backupValue);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,v])=>[k,backupValue(v)]));return v;
}
export async function loadUnifiedBackup(db:Firestore,uid:string,pendingOperations:OutboxOperation[]):Promise<UnifiedBackup> {
  const entries:BackupEntry[]=[];const add=(path:string,data:OutboxPayload,pending:boolean)=>{if(pending)throw new Error('יש כתיבה מקומית שטרם אושרה. המתינו לסנכרון לפני גיבוי נתוני הענן. אפשר לייצא את תור הפעולות בנפרד.');entries.push({path,data:backupValue(data) as OutboxPayload});};
  const profile=await getDocFromServer(doc(db,'users',uid));if(profile.metadata.hasPendingWrites)throw new Error('העדפות החשבון טרם סונכרנו.');
  const vehicles=await getDocsFromServer(collection(db,'users',uid,'vehicles'));
  for(const vehicle of vehicles.docs){add(`vehicles/${vehicle.id}`,vehicle.data(),vehicle.metadata.hasPendingWrites);for(const name of BACKUP_VEHICLE_COLLECTIONS){const rows=await getDocsFromServer(collection(vehicle.ref,name));for(const row of rows.docs)add(`vehicles/${vehicle.id}/${name}/${row.id}`,row.data(),row.metadata.hasPendingWrites);}}
  for(const name of BACKUP_ACCOUNT_COLLECTIONS){const rows=await getDocsFromServer(collection(db,'users',uid,name));for(const row of rows.docs)add(`${name}/${row.id}`,row.data(),row.metadata.hasPendingWrites);}
  const drafts:{key:string;value:string}[]=[];
  for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key&&(key.startsWith(`tm.care-draft.v1.${encodeURIComponent(uid)}.`)||key.startsWith(`tm.fillup-draft.v1.${uid}.`))){const value=localStorage.getItem(key);if(value)drafts.push({key,value});}}
  return {format:'tank-maleh-account',version:2,owner:uid,exportedAt:new Date().toISOString(),cloud:{confirmed:true,entries,settings:backupValue(profile.data()?.settings??{}) as Record<string,unknown>},local:{pendingOperations,drafts,attachmentsIncluded:false}};
}
export function readUnifiedBackup(text:string):UnifiedBackup {
  if(text.length>8_000_000)throw new Error('גיבוי גדול מדי (עד 8 MB).');const b=JSON.parse(text) as UnifiedBackup;
  if(b?.format!=='tank-maleh-account'||b.version!==2||typeof b.owner!=='string'||!id(b.owner)||b.cloud?.confirmed!==true||!Array.isArray(b.cloud.entries)||b.cloud.entries.length>5000||!b.cloud.settings||typeof b.cloud.settings!=='object'||Array.isArray(b.cloud.settings)||!b.local||!Array.isArray(b.local.pendingOperations)||!Array.isArray(b.local.drafts)||b.local.attachmentsIncluded!==false)throw new Error('פורמט גיבוי לא נתמך.');
  const paths=new Set<string>();for(const e of b.cloud.entries){if(!backupPath(e.path)||paths.has(e.path)||!e.data||typeof e.data!=='object'||Array.isArray(e.data)||JSON.stringify(e.data).length>900000)throw new Error('נתיב או רשומה לא תקינים בגיבוי.');paths.add(e.path);const p=e.path.split('/');
    if(p.length===4&&(VEHICLE_COLLECTIONS as readonly string[]).includes(p[2])&&!validVehicleRecord(p[2] as typeof VEHICLE_COLLECTIONS[number],decodeVehicleRecord(p[2] as typeof VEHICLE_COLLECTIONS[number],{...e.data,id:p[3]})))throw new Error('רשומת רכב לא תקינה.');
    if(p[2]==='fillups'&&!parseFillupDocument(p[3],e.data).ok)throw new Error('תדלוק לא תקין בגיבוי.');
    if(p[0]==='vehicles'&&p.length===2&&e.data.deletionPending===true)throw new Error('הגיבוי כולל רכב בתהליך מחיקה.');
  }
  if(b.cloud.entries.some(e=>e.path.split('/').length===4&&!paths.has(e.path.split('/').slice(0,2).join('/'))))throw new Error('רשומות רכב ללא רכב מקור.');
  if(b.local.drafts.some(d=>!d||typeof d.key!=='string'||typeof d.value!=='string'||d.value.length>100000||!(d.key.startsWith(`tm.care-draft.v1.${encodeURIComponent(b.owner)}.`)||d.key.startsWith(`tm.fillup-draft.v1.${b.owner}.`))))throw new Error('טיוטה לא תקינה בגיבוי.');
  return b;
}
export function backupPreview(backup:UnifiedBackup,current:BackupEntry[]) {
  const additions:BackupEntry[]=[],conflicts:BackupEntry[]=[],existing=new Map(current.map(e=>[e.path,e.data]));let duplicates=0;
  const content=(d:OutboxPayload)=>Object.fromEntries(Object.entries(d).filter(([k])=>!['version','writeId'].includes(k)));
  for(const entry of backup.cloud.entries){const stored=existing.get(entry.path);if(!stored)additions.push(entry);else if(carePayloadMatches(content(stored),content(entry.data)))duplicates++;else conflicts.push(entry);}
  return {additions,duplicates,conflicts};
}
export function restoreBackupDrafts(backup:UnifiedBackup,uid:string):{restored:number;conflicts:number} {
  let restored=0,conflicts=0;for(const draft of backup.local.drafts){const key=draft.key.replace(`tm.care-draft.v1.${encodeURIComponent(backup.owner)}.`,`tm.care-draft.v1.${encodeURIComponent(uid)}.`).replace(`tm.fillup-draft.v1.${backup.owner}.`,`tm.fillup-draft.v1.${uid}.`);const existing=localStorage.getItem(key);if(existing&&existing!==draft.value){conflicts++;continue;}localStorage.setItem(key,draft.value);restored++;}return {restored,conflicts};
}
