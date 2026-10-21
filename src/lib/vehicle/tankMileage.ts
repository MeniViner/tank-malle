import type { TankModelFit } from '../tank';
import { localParts, startOfLocalDay, addLocalDays } from '../tank/calendar';
import type { MileageEvidence } from './derived';
const dayInZone=(at:number,zone:string)=>{const p=localParts(at,zone);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;};
/** Read-only adapter. Calendar boundaries are calculation bounds, never persisted event times. */
export function bridgeTankMileage(fit:TankModelFit, evidence:MileageEvidence[], now:number):{fit:TankModelFit;note:string|null} {
  const today=dayInZone(now,fit.timeZone), rows=evidence.filter(r=>r.day<=today);
  const dated=rows.filter(r=>r.at===null);if(!dated.length)return {fit,note:null};
  const days=[...new Set(rows.map(r=>r.day))].sort();
  const points=days.map(day=>{const same=rows.filter(r=>r.day===day);return {day,min:Math.min(...same.map(r=>r.odometer)),max:Math.max(...same.map(r=>r.odometer))};});
  // Conservative calendar model: one interval per pair of days. Ambiguous endpoints
  // are omitted; a day-only observation can never teach an hourly/weekday pattern.
  const intervals=points.slice(1).flatMap((p,i)=>{const prev=points[i],days=(Date.parse(p.day)-Date.parse(prev.day))/86400000,km=p.max-prev.max;
    if(p.min!==p.max||prev.min!==prev.max||days<2||km<0)return [];
    if(fit.events.some(e=>e.kind==='fillup'&&e.continuityBreakBefore&&dayInZone(e.at,fit.timeZone)>prev.day&&dayInZone(e.at,fit.timeZone)<=p.day))return [];
    return [{km,days}];});
  const km=intervals.reduce((s,r)=>s+r.km,0),duration=intervals.reduce((s,r)=>s+r.days,0);
  const mobility=duration>0?{...fit.mobility,kmPerDay:km/duration,sd:Math.max(fit.mobility.sd??0,km/duration),rung:'robustAverage' as const,kmPerWeekday:null,intervalCount:intervals.length,identifiable:false}:fit.mobility;
  let next={...fit,mobility};const latest=dated.toSorted((a,b)=>b.day.localeCompare(a.day)||b.odometer-a.odometer)[0];
  const lastEventDay=fit.events.at(-1)?dayInZone(fit.events.at(-1)!.at,fit.timeZone):null;
  if ((!lastEventDay||lastEventDay<=latest.day) && new Set(rows.filter(r=>r.day===latest.day).map(r=>r.odometer)).size>1) return {fit:next,note:'יש קריאות ק״מ באותו יום ללא סדר ידוע. מצב המיכל אינו מניח שהטיפול קרה לפני או אחרי התדלוק.'};
  if ((!lastEventDay || latest.day>lastEventDay) && (!fit.balance.lastOdometer||latest.odometer>=fit.balance.lastOdometer.value)) {
    // Upper bound of the recorded day: the current estimate uses a full day's
    // travel uncertainty. This is explicitly marked as a bound, not a capture time.
    const noon=Date.parse(latest.day+'T12:00:00Z');const end=addLocalDays(startOfLocalDay(noon,fit.timeZone),1,fit.timeZone);const bound=Math.min(now,end);
    const base=fit.balance.measured,rate=fit.consumption.litersPerKm;
    const delta=base?latest.odometer-base.odometer:0;
    const measured=base&&rate!==null&&delta>=0?{...base,liters:Math.max(0,base.liters-delta*rate),sd:Math.hypot(base.sd,delta*(fit.consumption.sd??rate*0.25),(mobility.kmPerDay??0)*rate),odometer:latest.odometer,at:bound,precision:'day' as const,day:latest.day}:null;
    next={...next,balance:{...fit.balance,measured,lastOdometer:{value:latest.odometer,at:bound,precision:'day' as const,day:latest.day}}};
    return {fit:next,note:`מד־דרך משותף מעדכון ביום ${latest.day}; שעת האירוע אינה ידועה. התחזית כוללת אי־ודאות של יום.`};
  }
  return {fit:next,note:'הלמידה כוללת קילומטראז׳ מטיפולים ועדכונים יומיים; שעות שלא תועדו אינן מוסקות.'};
}
