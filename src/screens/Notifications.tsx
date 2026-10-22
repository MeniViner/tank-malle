import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useVehicleData } from '../context/VehicleDataContext';
import { useToast } from '../context/ToastContext';
import { useVehicleNotifications, type VehicleNotification } from '../hooks/useVehicleNotifications';
import { Sheet } from '../components/Sheet';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { ArchiveIcon, TrashIcon, RestoreIcon, BellIcon, ChevronStart, PumpIcon, WarningIcon, CloudOffIcon } from '../components/icons';
import { validDay } from '../lib/maintenance/model';
import type { NotificationState } from '../lib/vehicle/model';

export function Notifications() {
  const v=useVehicleData(),data=useData(),notes=useVehicleNotifications(),{showToast}=useToast(),navigate=useNavigate();
  const [selected,setSelected]=useState<{scope:string;note:VehicleNotification}|null>(null),[until,setUntil]=useState('');
  const [errorState,setErrorState]=useState({scope:'',message:''});
  const [working,setWorking]=useState<{scope:string}|null>(null),[priceInfo,setPriceInfo]=useState(false);
  const scope=useRef(v.scope);useLayoutEffect(()=>{scope.current=v.scope;},[v.scope]);
  const busy=working?.scope===v.scope,error=errorState.scope===v.scope?errorState.message:'',snooze=selected?.scope===v.scope?selected.note:null;
  const setError=(message:string)=>setErrorState({scope:v.scope,message});
  const live=notes.rows.filter(n=>!n.state?.archived),archived=notes.rows.filter(n=>n.state?.archived);
  const unread=live.filter(n=>!n.state?.read&&!n.snoozed),read=live.filter(n=>n.state?.read&&!n.snoozed),deferred=live.filter(n=>n.snoozed);

  async function update(note:VehicleNotification,patch:Partial<NotificationState>,undo=true) {
    if(busy)return;
    const before=v.extra.notificationStates.find(r=>r.id===note.id),base:NotificationState=before??{id:note.id,schemaVersion:1,version:0,occurrence:note.occurrence,read:false,archived:false,snoozeUntilDay:null};
    const token={scope:v.scope},bound=v.scope,next={...base,...patch,version:base.version+1};setWorking(token);setError('');
    try {
      const receipt=await data.saveCareRecord(v.vehicleId,'notificationStates',next,before);
      if(scope.current!==bound)return;
      setSelected(null);showToast({tone:'info',title:'העדכון נשמר במכשיר — ממתין לסנכרון'});
      void receipt.settled.then(ok=>{
        if(scope.current!==bound)return;
        if(!ok){setError('העדכון טרם אושר. בדקו פעולות שלא סונכרנו.');showToast({tone:'error',title:'העדכון לא סונכרן — הקלט נשמר בתור הפעולות'});return;}
        if(undo)showToast({tone:'success',title:patch.deleted?'ההתראה נמחקה':patch.archived?'ההתראה הועברה לארכיון':patch.snoozeUntilDay?'הופעת ההתראה נדחתה':'ההתראה עודכנה',onUndo:()=>{
          if(scope.current!==bound)return;
          void data.saveCareRecord(v.vehicleId,'notificationStates',{...base,version:next.version+1},next).then(r=>{showToast({tone:'info',title:'בקשת הביטול נשמרה במכשיר'});void r.settled.then(done=>{if(!done&&scope.current===bound)showToast({tone:'error',title:'הביטול לא אושר — בדקו את תור הפעולות'});});}).catch(()=>{if(scope.current===bound)setError('לא ניתן לבטל; ייתכן שההתראה השתנתה בינתיים.');});
        }});
      });
    }catch(e){if(scope.current===bound)setError(e instanceof Error?e.message:'לא ניתן לשמור את ההתראה.');}
    finally{setWorking(current=>current===token?null:current);}
  }
  async function markRead() {
    if(busy||!unread.length)return;const bound=v.scope,token={scope:bound};setWorking(token);setError('');
    try {
      const receipts=[];
      for(const note of unread){
        if(scope.current!==bound)return;
        const before=note.state,base=before??{id:note.id,schemaVersion:1,version:0,occurrence:note.occurrence,read:false,archived:false,snoozeUntilDay:null};
        receipts.push(await data.saveCareRecord(v.vehicleId,'notificationStates',{...base,read:true,version:base.version+1},before??undefined));
      }
      if(scope.current!==bound)return;
      showToast({tone:'info',title:'סימון הקריאה נשמר במכשיר'});
      void Promise.all(receipts.map(r=>r.settled)).then(results=>{if(scope.current===bound&&results.some(ok=>!ok))setError('חלק מהסימונים טרם אושרו. בדקו פעולות שלא סונכרנו.');});
    }catch(e){if(scope.current===bound)setError(e instanceof Error?e.message:'לא ניתן לסמן את ההתראות.');}
    finally{setWorking(current=>current===token?null:current);}
  }
  function group(rows:VehicleNotification[],title:string) {
    if(!rows.length)return null;
    return <section aria-label={title} className={`notes-section ${title==='בארכיון'?'notes-archived':''}`}><div className="notes-group-head"><h2>{title}</h2>{title==='בארכיון'?<small>נשמר עד שתמחקו</small>:null}</div><div className="notes-group">{rows.map(n=>{
      const pending=data.outbox.some(op=>op.path.endsWith('/notificationStates/'+n.id)&&op.status==='pending');
      const Icon=n.kind==='price'?PumpIcon:n.kind==='sync'?CloudOffIcon:n.urgent?WarningIcon:BellIcon;
      return <article key={n.id} className="notes-row" data-urgent={n.urgent}><Icon size={19} className="notes-glyph"/><div className="notes-main"><Link to={n.to} onClick={event=>{if(n.kind==='price'){event.preventDefault();setPriceInfo(true);}if(!n.state?.read&&!pending)void update(n,{read:true},false);}}><h3>{!n.state?.read?<span className="notes-unread" aria-hidden="true"/>:null}{n.title}</h3><p>{n.detail}</p></Link>{n.snoozed?<small>תופיע שוב ב־{n.state?.snoozeUntilDay}. מועד הטיפול לא השתנה.</small>:null}{!n.state?.archived&&n.kind==='reminder'?<div className="flex flex-wrap gap-x-4"><button type="button" className="notes-text-action" onClick={()=>{const row=v.reminders.find(r=>r.occurrence===n.occurrence);if(row)v.edit({collection:'serviceEvents',completePlan:row.plan});}}>רישום טיפול</button><button type="button" className="notes-text-action" disabled={busy||pending} onClick={()=>{setSelected({scope:v.scope,note:n});setUntil('');}}>דחיית הופעה</button></div>:null}{!n.state?.archived&&n.kind==='price'?<button type="button" className="notes-text-action" onClick={()=>{setPriceInfo(true);if(!n.state?.read&&!pending)void update(n,{read:true},false);}}>מה זה משנה</button>:null}{n.state?.archived?<button type="button" className="notes-text-action" disabled={busy||pending} onClick={()=>void update(n,{archived:false})}><RestoreIcon size={14}/>החזרה לפעילות</button>:null}</div><button type="button" className="notes-mini" disabled={busy||pending} aria-label={`${n.state?.archived?'מחיקת התראה':'העברה לארכיון'} · ${n.title}`} onClick={()=>void update(n,n.state?.archived?{deleted:true,read:true}:{archived:true,read:true})}>{n.state?.archived?<TrashIcon size={18}/>:<ArchiveIcon size={18}/>}</button></article>;
    })}</div></section>;
  }
  return <main className="notes-page pb-safe pt-safe">
    <header className="notes-header"><button type="button" aria-label="חזרה לבית" onClick={()=>navigate('/')}><ChevronStart size={22} className="rotate-180"/></button><h1>התראות</h1><button type="button" disabled={busy||!unread.length} onClick={()=>void markRead()}>סימון כנקרא</button></header>
    <div className="notes-content">
      {group(unread,'חדש')}{group(read,'נקרא')}{group(deferred,'להמשך')}
      {!live.length?<div className="v-empty"><BellIcon size={26}/><h2>{v.incomplete?'מעדכנים את ההתראות':'אין התראות'}</h2><p>{v.incomplete?'הנתונים חלקיים או ממתינים לשרת.':'נודיע כשתזכורת תגיע, כשמחיר הדלק יתעדכן או כשמשהו ימתין לסנכרון.'}</p></div>:null}
      {group(archived,'בארכיון')}
      {error?<p role="alert" className="text-[14px] text-danger">{error}</p>:null}
      {archived.length?<p className="helper">מחיקה מסירה את ההתראה הזו בלבד. היא אינה מוחקת טיפול, משנה תזכורת או מבטלת פעולת סנכרון.</p>:null}
    </div>
    <Sheet open={!!snooze} onClose={()=>{if(!busy)setSelected(null);}} title="מתי להציג שוב?"><form className="vehicle-form" onSubmit={event=>{event.preventDefault();if(!snooze)return;if(!validDay(until)||until<=v.today){setError('בחרו יום עתידי.');return;}void update(snooze,{snoozeUntilDay:until});}}><Field label="יום הופעה מחדש" type="date" required min={v.today} value={until} onChange={event=>setUntil(event.target.value)}/><p className="helper">דחיית ההתראה אינה דוחה את מועד התחזוקה ואינה מסמנת טיפול שבוצע.</p><Button type="submit" disabled={busy} full>דחיית הופעת ההתראה</Button></form></Sheet>
    <Sheet open={priceInfo} onClose={()=>setPriceInfo(false)} title="מה שינוי המחיר אומר?"><p className="text-[16px] leading-relaxed">המחיר השמור משמש כברירת מחדל לתדלוקים חדשים ולקו ההשוואה בגרף. הוא אינו משנה את המחירים ששילמתם או את ההיסטוריה שכבר שמרתם.</p><Link className="tm-text-action mt-4" to="/settings">למחיר ולהנחה האישית</Link></Sheet>
  </main>;
}
