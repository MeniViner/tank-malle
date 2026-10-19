import { JOBS, EXPENSES } from '../../lib/maintenance/model';
import type { OutboxPayload } from '../../lib/outbox';
const labels: Record<string,string> = { title:'שם',day:'תאריך ביצוע',odometer:'קילומטראז׳',costAgorot:'עלות',jobs:'עבודות',garage:'מוסך',notes:'הערות',dueDay:'תאריך יעד',dueOdometer:'יעד ק״מ',intervalKm:'מרווח ק״מ',intervalMonths:'מרווח חודשים',active:'תזכורת פעילה',source:'מקור',basis:'חישוב מועד',category:'סוג הוצאה',job:'סוג טיפול',completedPlanIds:'תזכורות שהושלמו' };
function value(key:string,input:unknown): string {
  if (input===null || input===undefined || input==='') return 'לא הוזן';
  if (key==='costAgorot') return `₪${Number(input)/100}`;
  if (key==='jobs' && Array.isArray(input)) return input.map(v=>JOBS[v as keyof typeof JOBS]??String(v)).join(', ');
  if (key==='completedPlanIds' && Array.isArray(input)) return `${input.length} תזכורות; הבחירה השתנתה בין הגרסאות`;
  if (key==='job') return JOBS[input as keyof typeof JOBS]??String(input);
  if (key==='category') return EXPENSES[input as keyof typeof EXPENSES]??String(input);
  if (key==='active') return input?'כן':'לא';
  if (key==='source') return ({owner:'הגדרה שלי',manufacturer:'יצרן',garage:'מוסך'} as Record<string,string>)[String(input)]??String(input);
  if (key==='basis') return ({completion:'מהטיפול האחרון',fixed:'יעדים קבועים',manual:'חד פעמי'} as Record<string,string>)[String(input)]??String(input);
  return String(input);
}
export function CareConflictDetails({ mine,server }: { mine:OutboxPayload|null;server:OutboxPayload|null }) {
  if (!server) return <p className="text-sm">הרשומה נמחקה בשרת. העותק המקומי נשמר בייצוא הפעולות.</p>;
  return <div className="flex flex-col gap-3 text-sm"><p className="font-semibold">ההבדלים לבדיקה לפני בחירת הגרסה</p>{Object.entries(labels).filter(([key])=>JSON.stringify(mine?.[key])!==JSON.stringify(server[key])).map(([key,label])=><div className="rounded-lg bg-surface-2 p-3" key={key}><b>{label}</b><p className="break-words whitespace-pre-wrap">שלי: {value(key,mine?.[key])}</p><p className="break-words whitespace-pre-wrap">בשרת: {value(key,server[key])}</p></div>)}</div>;
}
