import { useVehicleData } from '../context/VehicleDataContext';
import { useData } from '../context/DataContext';
import { notificationId, type NotificationState } from '../lib/vehicle/model';
export interface VehicleNotification { occurrence:string; id:string; title:string; detail:string; to:string; urgent:boolean; state:NotificationState|null; snoozed:boolean }
export function useVehicleNotifications() {
  const v=useVehicleData(),data=useData();
  const apply=(occurrence:string,title:string,detail:string,to:string,urgent:boolean):VehicleNotification=>{const id=notificationId(occurrence),state=v.extra.notificationStates.find(r=>r.id===id&&r.occurrence===occurrence)??null;
    return {id,occurrence,title,detail,to,urgent,state,snoozed:!!state?.snoozeUntilDay&&state.snoozeUntilDay>v.today};};
  const rows:VehicleNotification[]=[];
  if(data.settings.reminderNotifications!==false)for(const r of v.reminders)if(r.plan.active&&['due','soon'].includes(r.status))rows.push(apply(r.occurrence,r.plan.title,r.status==='due'?'הגיע מועד הטיפול':'הטיפול מתקרב',`/vehicle/reminders/${encodeURIComponent(r.plan.id)}`,r.status==='due'));
  if(data.settings.issueNotifications!==false)for(const issue of v.extra.vehicleIssues)if(issue.status!=='resolved'&&issue.importance==='important')rows.push(apply(`issue:${issue.id}:${issue.status}:${issue.day}`,issue.title,'תקלה שסימנתם כחשובה',`/vehicle/issues/${encodeURIComponent(issue.id)}`,true));
  for(const op of data.outbox.filter(o=>o.status!=='pending'&&(!o.vehicleId||o.vehicleId===v.vehicleId)))rows.push(apply(`sync:${op.opId}:${op.version}`, 'פעולה דורשת בדיקה', 'המידע נשמר בתור הפעולות. ארכיון אינו מבטל כתיבה.', '/settings/unsynced',true));
  if(data.outboxReady&&data.outboxHealth.state!=='ok')rows.push(apply('sync:storage','לא ניתן לאמת את תור הפעולות','יש לבדוק את אחסון המכשיר.','/settings/unsynced',true));
  return {rows,active:rows.filter(r=>!r.state?.archived&&!r.snoozed),unread:rows.filter(r=>!r.state?.archived&&!r.snoozed&&!r.state?.read).length};
}
