import { vehicleDay, vehicleMoney } from "../lib/vehicle/format";
import { Link } from 'react-router-dom';
import { useVehicleData } from '../context/VehicleDataContext';
import { periodSummary } from '../lib/vehicle/derived';
import { int } from '../lib/format';
import { NumericText, NumRun } from './Fmt';
export function RunningCosts({from,to,year}:{from:string;to:string;year?:string}) {
  const v=useVehicleData(),s=periodSummary(v.ledger,v.mileage,from,to,v.incomplete);
  const period=from==='1900-01-01'?`כל התקופה · עד ${vehicleDay(to)}`:`${vehicleDay(from)} — ${vehicleDay(to)}`;
  // periodSummary returns shekels/km. Display agorot/km without changing the
  // shared covered interval or rounding any ledger amount used in the total.
  const rate=(value:number|null)=>value===null?'—':int(value*100);
  return <section className="v-costs" aria-label="עלויות הרכב"><div className="v-section-head"><h2>עלויות הרכב</h2><Link to={year?`/history?year=${year}`:`/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`}>לרשומות ←</Link></div>
    <div className="v-cost-total"><small><NumericText>{`הוצאות מתועדות · ${period}`}</NumericText></small><strong data-testid="running-total"><NumRun block>{vehicleMoney(s.total)}</NumRun></strong><p><NumericText>{`${s.unknown?`${s.unknown} ${s.unknown===1?'עלות חסרה':'עלויות חסרות'}. `:''}${s.incomplete?'הנתונים עדיין חלקיים.':'סכומים ידועים בלבד, ללא ירידת ערך.'}`}</NumericText></p></div>
    <dl className="v-group">{[['רכישות דלק',s.fuel],['טיפולים',s.maintenance],['הוצאות נוספות',s.other],['החזרים',-s.refunds]].map(([label,value])=><div className="v-row" key={label}><dt>{label}</dt><dd><NumRun align="trailing">{vehicleMoney(Number(value))}</NumRun></dd></div>)}</dl>
    <div className="v-statpair"><div><small>הכול לק״מ</small><strong data-testid="running-cost-per-km"><NumRun block>{rate(s.costPerKm)}</NumRun></strong><span>אג׳ לק״מ</span></div><div><small>רכישות דלק לק״מ</small><strong data-testid="running-fuel-per-km"><NumRun block>{rate(s.fuelPerKm)}</NumRun></strong><span>אג׳ לק״מ</span></div></div>
    <details className="tm-vehicle-disclosure"><summary>איך מחושבות העלויות?</summary><p className="helper"><NumericText>{`${s.distance===null?'אין טווח קילומטראז׳ מספק לחישוב עלות לק״מ.':`שני המדדים מבוססים על אותו מרחק מתועד: ${int(s.distance)} ק״מ, בין ${vehicleDay(s.fromDay!)} ל־${vehicleDay(s.toDay!)}.`}${s.boundaryUnknown?' סדר הרשומות בגבול התקופה אינו ידוע, ולכן לא מוצגת עלות לק״מ.':''}${s.mileageInconsistent?' סדר קריאות הק״מ אינו עקבי; המרחק ועלות לק״מ אינם ידועים.':''}${s.continuityMissing?' קיימת הפסקת רציפות, ולכן עלות לק״מ לא מחושבת.':''}${s.unknown?' עלויות חסרות אינן הופכות לאפס.':''} רכישת דלק אינה מדידת הדלק שנצרך; מדידת הצריכה מופיעה בנפרד בתובנות.`}</NumericText></p></details>
  </section>;
}
