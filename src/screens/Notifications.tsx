import {Toggle} from "../components/Segmented";
import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useVehicleData } from '../context/VehicleDataContext';
import { useToast } from '../context/ToastContext';
import { useVehicleNotifications, type VehicleNotification } from '../hooks/useVehicleNotifications';
import { VehiclePage } from '../components/VehicleUI';
import { Sheet } from '../components/Sheet';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { validDay } from '../lib/maintenance/model';
import type { NotificationState } from '../lib/vehicle/model';
export function Notifications() {
  const v=useVehicleData(),data=useData(),notes=useVehicleNotifications(),{showToast}=useToast();const [archived,setArchived]=useState(false),[snooze,setSnooze]=useState<VehicleNotification|null>(null),[until,setUntil]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);const scope=useRef(v.scope);useLayoutEffect(()=>{scope.current=v.scope;},[v.scope]);
  async function update(note:VehicleNotification,patch:Partial<NotificationState>,undo=true) {
    if(busy)return;const before=v.extra.notificationStates.find(r=>r.id===note.id);const base:NotificationState=before??{id:note.id,schemaVersion:1,version:0,occurrence:note.occurrence,read:false,archived:false,snoozeUntilDay:null};
    const bound=v.scope,next={...base,...patch,version:base.version+1};setBusy(true);setError('');
    try {const receipt=await data.saveCareRecord(v.vehicleId,'notificationStates',next,before);if(scope.current!==bound)return;setSnooze(null);
      showToast({tone:'info',title:'העדכון נשמר במכשיר — ממתין לסנכרון'});const ok=await receipt.settled;
      if(!ok){setError('העדכון טרם אושר. בדקו פעולות שלא סונכרנו.');return;}if(scope.current!==bound)return;
      if(undo)showToast({tone:'success',title:patch.archived?'ההתראה הועברה לארכיון':patch.snoozeUntilDay?'הופעת ההתראה נדחתה':'ההתראה עודכנה',onUndo:()=>{
        void data.saveCareRecord(v.vehicleId,'notificationStates',{...base,version:next.version+1},next).then(r=>{showToast({tone:'info',title:'בקשת הביטול נשמרה במכשיר'});void r.settled.then(done=>{if(!done)showToast({tone:'error',title:'הביטול לא אושר — בדקו את תור הפעולות'});});}).catch(()=>setError('לא ניתן לבטל; ייתכן שההתראה השתנתה בינתיים.'));
      }});
    }catch(e){setError(e instanceof Error?e.message:'לא ניתן לשמור את ההתראה.');}finally{setBusy(false);}
  }
  const shown=notes.rows.filter(n=>archived?!!n.state?.archived:!n.state?.archived);
  return <VehiclePage title="התראות" subtitle="מה דורש תשומת לב, בזמן שהאפליקציה פתוחה."><div className="v-tabs"><button type="button" aria-pressed={!archived} onClick={()=>setArchived(false)}>פעילות</button><button type="button" aria-pressed={archived} onClick={()=>setArchived(true)}>ארכיון</button></div>
    <div className="v-group">{shown.map(n=><article className={`v-notification ${n.state?.read?'read':'unread'}`} key={n.id}><Link to={n.to}><h2>{n.title}</h2><p>{n.detail}</p></Link>{n.snoozed?<small>תופיע שוב ב־{n.state?.snoozeUntilDay}. מועד הטיפול לא השתנה.</small>:null}<div className="v-inline-actions"><button type="button" disabled={busy} onClick={()=>void update(n,{read:!n.state?.read},false)}>{n.state?.read?'סימון כלא נקרא':'סימון כנקרא'}</button><button type="button" disabled={busy} onClick={()=>void update(n,{archived:!n.state?.archived})}>{n.state?.archived?'החזרה לפעילות':'ארכיון'}</button>{!n.state?.archived?<button type="button" disabled={busy} onClick={()=>{setSnooze(n);setUntil('');}}>דחיית הופעה</button>:null}</div></article>)}</div>
    {!shown.length?<div className="v-empty"><h2>{archived?'הארכיון ריק':'אין כרגע התראות'}</h2><p>מחזור חדש של תזכורת יופיע כהתראה חדשה.</p></div>:null}
    <section><h2 className="v-section-head">מה להציג</h2><div className="v-group">{[['reminderNotifications','תזכורות טיפול'],['issueNotifications','תקלות שסימנתי כחשובות']].map(([key,label])=><div className="v-row" key={key}><span>{label}</span><Toggle ariaLabel={label} checked={data.settings[key as 'reminderNotifications']!==false} onChange={checked=>{void data.updateSettings({[key]:checked}).catch(()=>setError('העדפות ההתראות לא נשמרו.'));}}/></div>)}</div></section>
    <p className="helper">ארכוב חל על המופע הנוכחי בלבד. הוא אינו מוחק טיפול או מבטל פעולת סנכרון. אין שליחת Push אוטומטית כשהאפליקציה סגורה.</p>{error?<p role="alert" className="text-danger">{error}</p>:null}
    <Sheet open={!!snooze} onClose={()=>{if(!busy)setSnooze(null);}} title="מתי להציג שוב?"><form className="vehicle-form" onSubmit={e=>{e.preventDefault();if(!snooze)return;if(!validDay(until)||until<=v.today){setError('בחרו יום עתידי.');return;}void update(snooze,{snoozeUntilDay:until});}}><Field label="יום הופעה מחדש" type="date" required min={v.today} value={until} onChange={e=>setUntil(e.target.value)}/><p className="helper">דחיית ההתראה אינה דוחה את מועד התחזוקה ואינה מסמנת טיפול שבוצע.</p><Button type="submit" disabled={busy} full>דחיית הופעת ההתראה</Button></form></Sheet>
  </VehiclePage>;
}
