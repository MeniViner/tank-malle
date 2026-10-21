import {PumpIcon, GaugeIcon, WarningIcon} from "../components/icons";
import {CareGlyph} from "../components/maintenance/CareGlyph";
import {consumption,num} from "../lib/format";
import {resolveEndState} from "../lib/tank/observations";
import {buildRange,rangeDates} from "../lib/periods";
import {localDay,validDay} from "../lib/maintenance/model";
import { vehicleMoney, vehicleDay } from "../lib/vehicle/format";
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useVehicleData } from '../context/VehicleDataContext';
import { useStats } from '../hooks/useStats';
import { useToast } from '../context/ToastContext';
import { VehiclePage, VehicleAddBar, CoverageNotice } from '../components/VehicleUI';
import { Button } from '../components/Button';
import { ConfirmDialog, Sheet } from '../components/Sheet';
import { periodSummary, type LedgerRow } from '../lib/vehicle/derived';
import type { VehicleRecord } from '../lib/vehicle/model';
import type { Fillup } from '../lib/types';
const KINDS=[['all','הכול'],['fuel','תדלוקים'],['service','טיפולים'],['expense','הוצאות'],['odometer','ק״מ'],['issue','תקלות']];
export function History() {
  const v=useVehicleData(),data=useData(),stats=useStats(),{showToast}=useToast(),navigate=useNavigate();const [params,setParams]=useSearchParams();
  const [query,setQuery]=useState(''),[limit,setLimit]=useState(50),[selected,setSelected]=useState<LedgerRow|null>(null),[deleting,setDeleting]=useState<LedgerRow|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [periodNow,setPeriodNow]=useState(()=>Date.now());
  const year=params.get('year'),period=params.get('period')??'all',kind=params.get('kind')??'all',plan=params.get('plan');
  const rangeFrom=params.get('from'),rangeTo=params.get('to');
  const explicitRange=validDay(rangeFrom)&&validDay(rangeTo)&&rangeFrom!<=rangeTo!;
  const calendarRange=buildRange(period==='month'?'thisMonth':period==='year'?'ytd':period==='3m'?'3m':'all',periodNow);
  const from=explicitRange?rangeFrom!:year&&/^\d{4}$/.test(year)?year+'-01-01':period==='month'?v.today.slice(0,7)+'-01':period==='year'?v.today.slice(0,4)+'-01-01':calendarRange.from===null?'1900-01-01':localDay(new Date(calendarRange.from));
  const to=explicitRange?rangeTo!:year&&/^\d{4}$/.test(year)?year+'-12-31':v.today;
  const rangeLabel=explicitRange?`${vehicleDay(from)} — ${vehicleDay(to)}`:year?`שנת ${year}`:rangeDates(calendarRange);
  const flagged=useMemo(()=>new Set(stats.anomalies.map(a=>a.fillupId)),[stats.anomalies]);
  const rows=useMemo(()=>v.ledger.filter(r=>r.day>=from&&r.day<=to&&(kind==='all'||r.kind===kind)&&(!plan||r.collection==='serviceEvents'&&'completedPlanIds' in r.record&&r.record.completedPlanIds.includes(plan))&&(!params.has('flagged')||r.collection==='fillups'&&flagged.has(r.id))&&`${r.title} ${r.notes} ${r.day}`.toLocaleLowerCase('he-IL').includes(query.toLocaleLowerCase('he-IL'))),[v.ledger,from,to,kind,plan,params,query,flagged]);
  const segmentValues=new Map(stats.segments.map(s=>[s.endId,s.kmPerLiter]));
  const visibleKeys=new Set(rows.slice(0,limit).map(r=>r.key));
  const summary=periodSummary(rows,v.mileage,from,to,v.incomplete);
  const groups=new Map<string,LedgerRow[]>();for(const row of rows){const month=row.day.slice(0,7);groups.set(month,[...(groups.get(month)??[]),row]);}
  const change=(key:string,value:string)=>{const next=new URLSearchParams(params);if(value==='all')next.delete(key);else next.set(key,value);if(key==='period'){next.delete('year');next.delete('from');next.delete('to');}setPeriodNow(Date.now());setParams(next);setLimit(50);};
  const inspect=(row:LedgerRow)=>row.collection==='fillups'?navigate(`/fillup/${encodeURIComponent(row.id)}`):setSelected(row);
  return <VehiclePage title="יומן" subtitle="כל מה שנרשם לרכב, במקום אחד."><VehicleAddBar/>
    <div className="v-filter-line"><label>תקופה<select aria-label="תקופת היומן" value={explicitRange?'selected-range':year?'selected-year':period} onChange={e=>change('period',e.target.value)}><option value="all">כל התקופה</option><option value="month">החודש</option><option value="year">השנה</option><option value="3m">3 חודשים</option>{year?<option value="selected-year">שנת {year}</option>:null}{explicitRange?<option value="selected-range">התקופה שנבחרה</option>:null}</select></label><input aria-label="חיפוש ביומן" placeholder="חיפוש ברשומות" value={query} onChange={e=>{setQuery(e.target.value);setLimit(50);}}/></div>
    <div className="v-chips" aria-label="סוג רשומה">{KINDS.map(([value,label])=><button type="button" key={value} aria-pressed={kind===value} onClick={()=>change('kind',value)}>{label}</button>)}</div>
    {plan||year||params.has('flagged')?<div className="v-filter-summary"><span>{year?`שנת ${year}`:plan?'טיפולים המקושרים לתזכורת':'תדלוקים לבדיקה'}</span><button type="button" onClick={()=>setParams({})}>ניקוי סינון</button></div>:null}
    {flagged.size&&!params.has('flagged')?<button className="v-text-button" type="button" onClick={()=>{const p=new URLSearchParams(params);p.set('flagged','1');p.set('kind','fuel');setParams(p);}}>תדלוקים שכדאי לבדוק ({flagged.size})</button>:null}
    <section className="v-statpair" aria-label="סיכום היומן המסונן"><div><small>סך הכול בתקופה</small><strong data-testid="ledger-total">{vehicleMoney(summary.total)}</strong><span>{summary.unknown?`${summary.unknown} עלויות חסרות`:`${rows.length} רשומות`}</span></div><div><small>מתוכו רכישות דלק</small><strong>{vehicleMoney(summary.fuel)}</strong><span>סכומים ידועים בלבד</span></div></section><p className="helper" data-testid="ledger-range">{rows.length} רשומות מוצגות · {rows.filter(r=>r.kind==='fuel').length} תדלוקים · {rangeLabel}</p><CoverageNotice/>
    {data.outbox.some(o=>o.vehicleId===v.vehicleId)?<Link data-history-unsynced className="v-group v-row" to="/settings/unsynced">יש פעולות שלא סונכרנו · בדיקה ותיקון ←</Link>:null}
    {data.fillupsError||data.malformedFillups.length||v.care.errors.length||v.care.malformed?<p role="alert">חלק מהרשומות אינן זמינות לקריאה. אין כאן היסטוריה מלאה.</p>:null}
    {!rows.length?<div className="v-empty"><h2>{query?'לא נמצאו רשומות':'היומן מתחיל כאן'}</h2><p>תדלוקים, טיפולים, הוצאות ועדכוני ק״מ יופיעו כאן.</p><Link to="/fillup/new">תדלוק חדש ←</Link></div>:null}
    {[...groups].map(([month,group])=>{const visible=group.filter(r=>visibleKeys.has(r.key));return visible.length?<section className="v-ledger-month" key={month}><div className="v-section-head"><h2>{new Intl.DateTimeFormat('he-IL',{month:'long',year:'numeric'}).format(new Date(month+'-01T12:00:00'))}</h2><bdi dir="ltr">{vehicleMoney(group.reduce((s,r)=>s+(r.amountAgorot??0),0))}</bdi></div><div className="v-group">{visible.map(r=><button className="v-row ledger-row" data-collection={r.collection} type="button" key={r.key} onClick={()=>inspect(r)}><span className={`ledger-mark ${r.kind}`} aria-hidden="true">{r.kind==='fuel'?<PumpIcon size={21}/>:r.kind==='service'?<CareGlyph kind="periodic" size={21}/>:r.kind==='expense'?<CareGlyph kind="expense" size={21}/>:r.kind==='issue'?<WarningIcon size={21}/>:<GaugeIcon size={21}/>}</span><span className="v-row-main"><h3>{r.title}</h3><small>{vehicleDay(r.day)}{r.at===null?' · יום בלבד':''}{r.odometer!==null?` · ${r.odometer.toLocaleString('he-IL')} ק״מ`:''}</small>{r.kind==='fuel'&&(r.record as Fillup).continuityBreakBefore?<small className="text-warning-ink">התחלת תקופה חדשה</small>:null}{r.kind==='fuel'?<FuelMeta fillup={r.record as Fillup} value={segmentValues.get(r.id)} units={data.settings.units}/>:null}{data.outbox.some(o=>o.docId===r.id&&o.vehicleId===v.vehicleId)?<small>ממתין לסנכרון</small>:null}{r.kind==='fuel'&&flagged.has(r.id)?<small className="text-warning-ink">כדאי לבדוק</small>:null}</span><bdi dir="ltr" className="ledger-amount">{r.financial?vehicleMoney(r.amountAgorot):'←'}</bdi></button>)}</div></section>:null;})}
    {rows.length>limit?<Button variant="ghost" onClick={()=>setLimit(l=>l+50)}>הצגת רשומות נוספות</Button>:null}
    {selected?<Sheet open title={selected.title} onClose={()=>setSelected(null)}><div className="vehicle-form"><p>{vehicleDay(selected.day)}{selected.at===null?' · שעת האירוע לא תועדה':''}</p>{selected.financial?<strong>{vehicleMoney(selected.amountAgorot)}</strong>:null}<p className="whitespace-pre-wrap">{selected.notes}</p>{selected.collection!=='observations'?<Button onClick={()=>{v.edit({collection:selected.collection as 'serviceEvents',record:selected.record as VehicleRecord});setSelected(null);}}>עריכה</Button>:null}<Button variant="danger" onClick={()=>{setDeleting(selected);setSelected(null);}}>מחיקת רשומה</Button></div></Sheet>:null}
    <ConfirmDialog open={!!deleting} title="מחיקת הרשומה?" body="היומן, העלויות והתזכורות יחושבו מחדש. ניתן לשחזר רשומת תחזוקה לאחר אישור המחיקה מהשרת." confirmLabel={busy?'מוחקים…':'מחיקת הרשומה'} onCancel={()=>{if(!busy)setDeleting(null);}} onConfirm={()=>{if(!deleting||busy)return;const row=deleting;setBusy(true);setError('');
      void (async()=>{if(row.collection==='observations'){await data.deleteObservation(row.id);showToast({tone:'info',title:'בקשת המחיקה נשלחה. מצב האישור מופיע בתור הפעולות.'});}else if(row.collection==='fillups'){await data.deleteFillup(row.record as Fillup);}else {const record=row.record as VehicleRecord;const receipt=await data.deleteCareRecord(v.vehicleId,row.collection,record);setDeleting(null);const ok=await receipt.settled;
        if(ok)showToast({tone:'success',title:'הרשומה נמחקה',onUndo:()=>{void data.saveCareRecord(v.vehicleId,row.collection as 'serviceEvents',{...record,version:1}).then(restored=>{showToast({tone:'info',title:'בקשת השחזור נשמרה במכשיר'});void restored.settled.then(done=>{if(!done)showToast({tone:'error',title:'השחזור לא אושר — בדקו את תור הפעולות'});});}).catch(()=>showToast({tone:'error',title:'לא ניתן לשחזר את הרשומה'}));}});else showToast({tone:'error',title:'המחיקה טרם אושרה. בדקו פעולות שלא סונכרנו.'});}
      setDeleting(null);})().catch(()=>setError('המחיקה לא הושלמה. הפרטים נשמרו בתור הפעולות.')).finally(()=>setBusy(false));}}/>{error?<p role="alert">{error}</p>:null}
  </VehiclePage>;
}

function FuelMeta({fillup,value,units}:{fillup:Fillup;value:number|undefined;units:'kmPerLiter'|'litersPer100'}) {
  const measured=value===undefined?null:consumption(value,units);const end=resolveEndState(fillup);
  return <small><bdi dir="ltr">{num(fillup.liters,1)}</bdi> ל׳ · {measured?<><bdi dir="ltr">{measured.value}</bdi> {measured.unit}</>:end.state==='partial'?'תדלוק חלקי':end.state==='unknown'?'מצב מיכל לא תועד':'נקודת פתיחה למדידה'}</small>;
}
