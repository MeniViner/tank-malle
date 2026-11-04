import { Gauge, Pill, PumpDisplay } from "../DesignPrimitives";
import { ConsumptionValue, Money, NumericText, NumRun } from "../Fmt";

export function OnboardingArt({ index }: { index: number }) {
  return <div className="entry-art" data-testid="onboarding-art">
    {index === 0 ? <PumpDisplay className="entry-pump-art">
      <div className="tm-pump-row"><div className="tm-pump-line"><span className="tm-pump-label">סכום</span><span className="entry-pump-value"><Money value={218}/></span></div></div>
      <div className="tm-pump-row"><div className="tm-pump-line"><span className="tm-pump-label">קילומטראז׳</span><span className="entry-pump-value"><NumRun>170,344</NumRun></span></div></div>
    </PumpDisplay> : index === 1 ? <div className="entry-consumption-art">
      <span className="entry-art-label">צריכת הדלק שלכם</span>
      <ConsumptionValue kmPerLiter={12.8} units="kmPerLiter" className="entry-consumption-number" block/>
      <Pill tone="better"><NumericText>5% פחות דלק לק״מ מהרגיל</NumericText></Pill>
    </div> : <div className="entry-refuel-art">
      <span className="entry-art-label">התדלוק הבא</span>
      <div className="entry-refuel-time">בעוד <NumRun>4</NumRun> ימים</div>
      <Gauge value={0.45} habit={0.3} label="דוגמה למחוון הדלק"/>
    </div>}
    <span className="entry-example">נתונים לדוגמה</span>
  </div>;
}
