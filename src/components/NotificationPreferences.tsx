import { useState } from 'react';
import { useData } from '../context/DataContext';
import type { UserSettings } from '../lib/types';
import { notificationPreferences } from '../lib/vehicle/notificationPreferences';
import { Sheet } from './Sheet';
import { Segmented, Toggle } from './Segmented';

export function NotificationPreferences({open,onClose}:{open:boolean;onClose:()=>void}) {
  const {settings,updateSettings}=useData(),prefs=notificationPreferences(settings);
  const [error,setError]=useState('');
  const save=(patch:Partial<UserSettings>)=>{setError('');void updateSettings(patch).catch(()=>setError('לא ניתן לשמור את ההעדפות. נסו שוב כשהאחסון והחיבור זמינים.'));};
  return <Sheet open={open} onClose={onClose} title="העדפות התראות"><div className="flex flex-col gap-6">
    <div className="v-group">{([
      ['reminderNotifications','תזכורות טיפול',prefs.reminders],
      ['syncNotifications','פעולות שלא סונכרנו',prefs.sync],
      ['priceNotifications','עדכון מחיר דלק',prefs.prices],
      ['issueNotifications','תקלות שסימנתי כחשובות',prefs.issues],
    ] as const).map(([key,label,checked])=><div className="v-row" key={key}><span>{label}</span><Toggle ariaLabel={label} checked={checked} onChange={value=>save({[key]:value})}/></div>)}</div>
    <section className="flex flex-col gap-3"><h3 className="text-[15px] font-semibold">כמה זמן מראש?</h3><Segmented size="sm" ariaLabel="זמן התראה מראש" value={String(prefs.leadDays)} onChange={value=>save({reminderLeadDays:Number(value)})} options={[{value:'1',label:'יום'},{value:'3',label:'3 ימים'},{value:'7',label:'שבוע'},{value:'14',label:'שבועיים'}]}/></section>
    <section className="flex flex-col gap-3"><h3 className="text-[15px] font-semibold">כמה קילומטרים מראש?</h3><Segmented size="sm" ariaLabel="מרחק התראה מראש" value={String(prefs.leadKm)} onChange={value=>save({reminderLeadKm:Number(value)})} options={[{value:'500',label:'500 ק״מ'},{value:'1000',label:'1,000 ק״מ'},{value:'2000',label:'2,000 ק״מ'}]}/></section>
    <p className="helper">ההעדפה משנה מתי תזכורת נחשבת מתקרבת. היא אינה משנה את מועד הטיפול, את המחזור או את רשומות היומן. הסתרת התראות סנכרון אינה מבטלת פעולות שממתינות לשליחה.</p>
    <p className="helper">ההתראות מוצגות כשהאפליקציה פתוחה. אין שליחת Push אוטומטית כשהיא סגורה.</p>
    {error?<p role="alert" className="text-[14px] text-danger">{error}</p>:null}
  </div></Sheet>;
}
