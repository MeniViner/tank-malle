import { vehicleDay, vehicleMoney } from "../lib/vehicle/format";
import { Link } from 'react-router-dom';
import { useVehicleData } from '../context/VehicleDataContext';
import { periodSummary } from '../lib/vehicle/derived';
import { EXCLUDED_LABEL } from '../lib/vehicle/ownership';
import { int } from '../lib/format';
import { Fact, FactsStrip } from './FactsStrip';
import { NumericText, NumRun } from './Fmt';

/**
 * Vehicle "כמה עלה" (design v3 §3/§6): the running costs of one period as a
 * facts strip — total, its parts, the two per-km figures on one shared covered
 * interval, and expenses outside vehicle ownership on their own line (never in
 * the total). Values come from `periodSummary`; display via `vehicleMoney`.
 */
export function RunningCosts({from,to,year,ev=false}:{from:string;to:string;year?:string;ev?:boolean}) {
  const v=useVehicleData(),s=periodSummary(v.ledger,v.mileage,from,to,v.incomplete);
  const period=from==='1900-01-01'?`כל התקופה · עד ${vehicleDay(to)}`:`${vehicleDay(from)} — ${vehicleDay(to)}`;
  // periodSummary returns shekels/km. Display agorot/km without changing the
  // shared covered interval or rounding any ledger amount used in the total.
  const rate=(value:number|null)=>value===null?null:int(value*100);
  const coverage=`${s.unknown?`${s.unknown} ${s.unknown===1?'עלות חסרה':'עלויות חסרות'}. `:''}${s.incomplete?'הנתונים עדיין חלקיים.':'סכומים ידועים בלבד, ללא ירידת ערך.'}`;
  return <section className="v-costs" aria-label="עלויות הרכב"><div className="v-section-head"><h2>כמה עלה</h2><Link to={year?`/history?year=${year}`:`/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`}>לרשומות ←</Link></div>
    <FactsStrip label="כמה עלה בתקופה" testId="running-facts">
      <Fact label={<NumericText>{`הוצאות מתועדות · ${period}`}</NumericText>} valueTestId="running-total" value={vehicleMoney(s.total)}
        sub={<NumericText>{`${s.count} ${s.count===1?'רשומה':'רשומות'} · ${coverage}`}</NumericText>} />
      <Fact variant="minor" label={ev ? 'חשמל' : 'רכישות דלק'} value={vehicleMoney(s.fuel)} />
      <Fact variant="minor" label="טיפולים" value={vehicleMoney(s.maintenance)} />
      <Fact variant="minor" label="הוצאות נוספות" value={vehicleMoney(s.other)} />
      <Fact variant="minor" label="החזרים" value={vehicleMoney(-s.refunds)} />
      <Fact label="הכול לק״מ" sub="כל ההוצאות בטווח הקילומטראז׳ המתועד" valueTestId="running-cost-per-km" value={rate(s.costPerKm)} unit="אג׳ לק״מ" />
      <Fact label="רכישות דלק לק״מ" sub="מה ששולם בתדלוקים, באותו טווח" valueTestId="running-fuel-per-km" value={rate(s.fuelPerKm)} unit="אג׳ לק״מ" />
      {s.excludedCount ? <Fact label={EXCLUDED_LABEL} muted valueTestId="running-excluded" value={vehicleMoney(s.excludedAgorot)}
        sub={<><NumRun>{s.excludedCount}</NumRun> {s.excludedCount===1?'רשומה':'רשומות'} · מחוץ לסה״כ ולעלות לק״מ</>} /> : null}
    </FactsStrip>
    <details className="tm-vehicle-disclosure"><summary>איך מחושבות העלויות?</summary><p className="helper"><NumericText>{`${s.distance===null?'אין טווח קילומטראז׳ מספק לחישוב עלות לק״מ.':`שני המדדים מבוססים על אותו מרחק מתועד: ${int(s.distance)} ק״מ, בין ${vehicleDay(s.fromDay!)} ל־${vehicleDay(s.toDay!)}.`}${s.boundaryUnknown?' סדר הרשומות בגבול התקופה אינו ידוע, ולכן לא מוצגת עלות לק״מ.':''}${s.mileageInconsistent?' סדר קריאות הק״מ אינו עקבי; המרחק ועלות לק״מ אינם ידועים.':''}${s.continuityMissing?' קיימת הפסקת רציפות, ולכן עלות לק״מ לא מחושבת.':''}${s.unknown?' עלויות חסרות אינן הופכות לאפס.':''} רכישת דלק אינה מדידת הדלק שנצרך; מדידת הצריכה מופיעה בנפרד בתובנות.${s.excludedCount?` הוצאות שסומנו "${EXCLUDED_LABEL}" נשארות ביומן ואינן נכללות בסה״כ או בעלות לק״מ.`:''}`}</NumericText></p></details>
  </section>;
}
