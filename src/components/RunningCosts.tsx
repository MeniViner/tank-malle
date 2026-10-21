import { vehicleMoney } from "../lib/vehicle/format";
import { Link } from 'react-router-dom';
import { useVehicleData } from '../context/VehicleDataContext';
import { periodSummary } from '../lib/vehicle/derived';
export function RunningCosts({from,to,year}:{from:string;to:string;year?:string}) {
  const v=useVehicleData(),s=periodSummary(v.ledger,v.mileage,from,to,v.incomplete);
  return <section className="v-costs" aria-label="עלויות הרכב"><div className="v-section-head"><h2>עלויות הרכב</h2><Link to={year?`/history?year=${year}`:`/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`}>לרשומות ←</Link></div>
    <div className="v-cost-total"><small>הוצאות מתועדות · {from} — {to}</small><strong data-testid="running-total">{vehicleMoney(s.total)}</strong><p>{s.unknown?`${s.unknown} רשומות ללא עלות. `:''}{s.incomplete?'הנתונים עדיין חלקיים.':'סכומים ידועים בלבד, ללא ירידת ערך.'}</p></div>
    <dl className="v-group">{[['רכישות דלק',s.fuel],['טיפולים',s.maintenance],['הוצאות נוספות',s.other],['החזרים',-s.refunds]].map(([label,value])=><div className="v-row" key={label}><dt>{label}</dt><dd><bdi>{vehicleMoney(Number(value))}</bdi></dd></div>)}</dl>
    <div className="v-statpair"><div><small>הכול לק״מ</small><strong>{s.costPerKm===null?'—':vehicleMoney(Math.round(s.costPerKm*100))}</strong></div><div><small>רכישות דלק לק״מ</small><strong>{s.fuelPerKm===null?'—':vehicleMoney(Math.round(s.fuelPerKm*100))}</strong></div></div>
    <p className="helper">{s.distance===null?'אין טווח קילומטראז׳ מספק לחישוב עלות לק״מ.':`שני המדדים מבוססים על אותו מרחק מתועד: ${s.distance.toLocaleString('he-IL')} ק״מ, בין ${s.fromDay} ל־${s.toDay}.`}{s.boundaryUnknown?' סדר הרשומות בגבול התקופה אינו ידוע, ולכן לא מוצגת עלות לק״מ.':''}{s.mileageInconsistent?' סדר קריאות הק״מ אינו עקבי; המרחק ועלות לק״מ אינם ידועים.':''}{s.continuityMissing?" קיימת הפסקת רציפות, ולכן עלות לק״מ לא מחושבת.":""}{s.unknown?" עלויות חסרות אינן הופכות לאפס.":""} רכישת דלק אינה מדידת הדלק שנצרך; מדידת הצריכה מופיעה בנפרד בתובנות.</p>
  </section>;
}
