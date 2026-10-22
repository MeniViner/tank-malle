import { useVehicleData } from '../context/VehicleDataContext';
import { useData } from '../context/DataContext';
import { notificationId, type NotificationState } from '../lib/vehicle/model';
import { regulatedMaxPrice, priceMonthLabel } from '../lib/prices/regulated';
import { price } from '../lib/format';
export interface VehicleNotification { occurrence:string; id:string; title:string; detail:string; to:string; urgent:boolean; state:NotificationState|null; snoozed:boolean; kind:'reminder'|'issue'|'sync'|'price' }
export function useVehicleNotifications() {
  const v=useVehicleData(),data=useData();
  const apply=(kind:VehicleNotification['kind'],occurrence:string,title:string,detail:string,to:string,urgent:boolean):VehicleNotification=>{
    const id=notificationId(occurrence),state=v.extra.notificationStates.find(r=>r.id===id&&r.occurrence===occurrence)??null;
    return {kind,id,occurrence,title,detail,to,urgent,state,snoozed:!!state?.snoozeUntilDay&&state.snoozeUntilDay>v.today};
  };
  const rows:VehicleNotification[]=[];
  if(v.notifications.reminders)for(const r of v.reminders)if(r.plan.active&&['due','soon'].includes(r.status))rows.push(apply('reminder',r.occurrence,r.plan.title,r.status==='due'?'הגיע מועד הטיפול':'הטיפול מתקרב',`/vehicle/reminders/${encodeURIComponent(r.plan.id)}`,r.status==='due'));
  if(v.notifications.issues)for(const issue of v.extra.vehicleIssues)if(issue.status!=='resolved'&&issue.importance==='important')rows.push(apply('issue',`issue:${issue.id}:${issue.status}:${issue.day}`,issue.title,'תקלה שסימנתם כחשובה',`/vehicle/issues/${encodeURIComponent(issue.id)}`,true));
  if(v.notifications.sync){
    for(const op of data.outbox.filter(o=>o.status!=='pending'&&(!o.vehicleId||o.vehicleId===v.vehicleId)))rows.push(apply('sync',`sync:${op.opId}:${op.version}`,'פעולה דורשת בדיקה','המידע נשמר בתור הפעולות. ארכיון אינו מבטל כתיבה.','/settings/unsynced',true));
    if(data.outboxReady&&data.outboxHealth.state!=='ok')rows.push(apply('sync','sync:storage','לא ניתן לאמת את תור הפעולות','יש לבדוק את אחסון המכשיר.','/settings/unsynced',true));
  }
  if(v.notifications.prices&&data.activeVehicle){
    const fuel=data.activeVehicle.fuelType,lookup=regulatedMaxPrice(data.prices,fuel,v.now);
    if(lookup.price!==null&&lookup.effectiveMonth){
      const label=fuel==='95'?'בנזין 95':fuel==='98'?'בנזין 98':fuel==='diesel'?'סולר':'דלק';
      rows.push(apply('price',`price:${fuel}:${lookup.effectiveMonth}:${lookup.price}`,`מחיר ${label} · ${priceMonthLabel(lookup.effectiveMonth,v.now)}`,`${price(lookup.price)} לליטר · ${lookup.isManual?'מחיר שהוזן ידנית':'המחיר הרשמי שנשמר'}`,'/settings',false));
    }
  }
  const visible=rows.filter(r=>!r.state?.deleted);
  return {rows:visible,active:visible.filter(r=>!r.state?.archived&&!r.snoozed),unread:visible.filter(r=>!r.state?.archived&&!r.snoozed&&!r.state?.read).length};
}
