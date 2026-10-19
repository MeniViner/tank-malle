import { CARE_COLLECTIONS, EXPENSES, JOBS, nextDue, validCareRecord, type CareCollection, type CareData, type CareRecord, type MaintenancePlan } from './model';
export interface CareBackup {
  format:'tank-maleh-care'; version:1; currency:'ILS'; vehicle:{id:string;label:string}; exportedAt:string;
  incomplete:boolean; records:CareData;
}
export function careBackup(vehicle:CareBackup['vehicle'],records:CareData,incomplete:boolean): string {
  return JSON.stringify({format:'tank-maleh-care',version:1,currency:'ILS',vehicle,exportedAt:new Date().toISOString(),incomplete,records} satisfies CareBackup,null,2);
}
export function readCareBackup(text:string): CareBackup {
  if (text.length>5_000_000) throw new Error('קובץ הגיבוי גדול מדי (עד 5 MB).');
  const data=JSON.parse(text) as CareBackup;
  if (data?.format!=='tank-maleh-care' || data.version!==1 || data.currency!=='ILS' || !data.vehicle || typeof data.vehicle.id!=='string' || data.vehicle.id.length>64 || typeof data.vehicle.label!=='string' || data.vehicle.label.length>200 || !data.records || typeof data.incomplete!=='boolean') throw new Error('זה אינו גיבוי תחזוקה נתמך של טנק מלא.');
  if (Object.keys(data.records).some(k=>!CARE_COLLECTIONS.includes(k as CareCollection))) throw new Error('הגיבוי כולל סוג רשומה לא נתמך.');
  let total=0;
  for(const name of CARE_COLLECTIONS) {
    const rows=data.records[name];
    if (!Array.isArray(rows) || rows.some(row=>!validCareRecord(name,row)) || new Set(rows.map(row=>row.id)).size!==rows.length) throw new Error('בגיבוי יש רשומה לא תקינה או מזהה כפול. לא יובא דבר.');
    total+=rows.length;
  }
  if (total>5000) throw new Error('אפשר לייבא עד 5,000 רשומות בכל גיבוי.');
  return data;
}
export function importPreview(backup:CareBackup,existing:CareData): { additions:{collection:CareCollection;record:CareRecord}[];duplicates:number;conflicts:number } {
  const additions:{collection:CareCollection;record:CareRecord}[]=[]; let duplicates=0,conflicts=0;
  const content=(r:CareRecord)=>JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='version').sort(([a],[b])=>a.localeCompare(b))));
  for(const collection of CARE_COLLECTIONS) {
    const current=new Map<string,CareRecord>(existing[collection].map(row=>[row.id,row]));
    for(const record of backup.records[collection]) {
      const previous=current.get(record.id);
      if (previous) { if(content(previous)===content(record)) duplicates++;else conflicts++; }
      else additions.push({collection,record:{...record,version:1}});
    }
  }
  return {additions,duplicates,conflicts};
}
/** Spreadsheet formula prefixes must remain literal user text after opening a CSV. */
function cell(value:unknown): string {
  let text=String(value??''); if (typeof value==='string' && /^[\s]*[=+@-]/.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function careCostsCsv(data:CareData): string {
  const rows:unknown[][]=[['סוג','תאריך','שם','קילומטראז׳','עלות בש״ח','עבודות / קטגוריה','מוסך','הערות']];
  const ordered=[...data.serviceEvents.map(r=>['טיפול',r.day,r.title,r.odometer,r.costAgorot===null?'':r.costAgorot/100,r.jobs.map(j=>JOBS[j]).join(', '),r.garage,r.notes]),
    ...data.vehicleExpenses.map(r=>['הוצאה',r.day,r.title,'',r.costAgorot===null?'':r.costAgorot/100*(r.category==='refund'?-1:1),EXPENSES[r.category],'',r.notes])];
  ordered.sort((a,b)=>String(b[1]).localeCompare(String(a[1])));
  return '\uFEFF'+[...rows,...ordered].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
const escapeIcs=(value:string)=>value.replaceAll('\\','\\\\').replaceAll('\r','').replaceAll('\n','\\n').replaceAll(';','\\;').replaceAll(',','\\,');
/** Calendar dates only: mileage cannot honestly become an alarm date. Export is a snapshot, not a subscription. */
export function careCalendar(vehicleId:string,plan:MaintenancePlan,data:CareData,now=new Date()): string | null {
  const due=nextDue(plan,data.serviceEvents);
  if (!plan.active || due.completed || !due.day) return null;
  const stamp=now.toISOString().replaceAll('-','').replaceAll(':','').replace(/\.\d{3}Z$/,'Z');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Tank Maleh//Care//HE','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${encodeURIComponent(vehicleId)}-${encodeURIComponent(plan.id)}@tank-maleh.local`,`DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${due.day.replaceAll('-','')}`,`SUMMARY:${escapeIcs(plan.title)}`,
    `DESCRIPTION:${escapeIcs(`צילום מצב של תאריך היעד בטנק מלא. היומן אינו עוקב אחר קילומטראז׳ או שינויים מאוחרים. ${due.odometer===null?'':`יעד הק״מ באפליקציה: ${due.odometer}. `}יש לבדוק באפליקציה אם המועד השתנה. ${plan.notes}`)}`,'END:VEVENT','END:VCALENDAR'];
  // RFC 5545 line folding counts UTF-8 bytes, not UTF-16 code units (Hebrew).
  return lines.map(line=>{
    let current='',bytes=0;const parts:string[]=[];
    for(const char of line) { const length=new TextEncoder().encode(char).length; if(bytes+length>73){parts.push(current);current=' ';bytes=1;}current+=char;bytes+=length; }
    parts.push(current);return parts.join('\r\n');
  }).join('\r\n')+'\r\n';
}
export function downloadCareFile(text:string,filename:string,type:string): void {
  const url=URL.createObjectURL(new Blob([text],{type}));const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
