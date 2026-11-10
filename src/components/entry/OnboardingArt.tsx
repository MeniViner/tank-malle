import { Chip } from "../Card";
import { Pill, PumpDisplay } from "../DesignPrimitives";
import { ConsumptionValue, Money, NumericText, NumRun } from "../Fmt";
import { CoinIcon, DocumentIcon, PumpIcon, WrenchIcon } from "../icons";
import { SpotlightCard } from "../SpotlightCard";
import { TcoCard } from "../TcoBlock";
import { TankHero, type TankHeroEstimate } from "../tank/TankHero";
import { int, price, shekel } from "../../lib/format";
import type { TcoResult } from "../../lib/tco";

const noop = () => {};
/** React 18 has no `inert` prop; set the attribute directly so nothing inside can take focus. */
const makeInert = (element: HTMLDivElement | null) => { element?.setAttribute("inert", ""); };

/** Static demo data, in the engine's own shapes. Nothing here is computed or stored. */
const DEMO_TCO: TcoResult = {
  parts: [
    { id: "fuel", label: "דלק", value: 1180, knownValue: 1180 },
    { id: "service", label: "טיפולים ותיקונים", value: 175, knownValue: 175 },
    { id: "mandatory", label: "ביטוח חובה", value: 105, knownValue: 105, docKey: "mandatory" },
    { id: "coverage", label: "ביטוח מקיף", value: 158, knownValue: 158, docKey: "coverage" },
    { id: "test", label: "טסט ואגרת רישוי", value: 118, knownValue: 118, docKey: "test" },
    { id: "other", label: "חניה, אגרות ושאר", value: 41, knownValue: 41 },
  ],
  month: 1777, year: 1777 * 12, missing: [], window: 12, windowStart: "2025-12-01",
  perKm: 1.46, complete: true, lowerBound: true, fuelThisMonth: 940, excluded: { monthly: 0, count: 0 },
};

const DEMO_TANK: TankHeroEstimate = {
  available: true,
  current: { level: 0.45, rawLevel: 0.45, asOf: 0 },
  lastLevelReport: null,
  reserveLevel: 0.15,
  habit: { canClaim: true, overridden: false, typicalLevel: 0.3, mixed: false, low: 0.25, high: 0.35 },
  expectedRefuel: { status: "withinHorizon", days: 4, daysLow: 4, daysHigh: 4, km: 210, targetLevel: 0.3 },
  rangeToReserveKm: 210,
  reasons: ["recentConfirmedFullAnchor"],
};

/** What each artwork shows, for assistive technology (the artwork itself is hidden from it). */
const ONBOARDING_ART_TEXT = [
  `נתונים לדוגמה: הרכב עולה לך ${shekel(DEMO_TCO.month!)} בחודש, מחולק לדלק, טיפולים, ביטוח חובה, ביטוח מקיף, טסט ואגרה, וחניה ושאר.`,
  `נתונים לדוגמה: צג משאבה עם סכום ${shekel(218)} וקילומטראז׳ ${int(170344)}, ורישום מהיר של תדלוק, טיפול או הוצאה.`,
  `נתונים לדוגמה: צריכה בתדלוק האחרון 12.8 ק״מ לליטר, 5% פחות דלק לק״מ מהרגיל, ${price(0.68)} לק״מ.`,
  "נתונים לדוגמה: תזכורת שהטסט בעוד 22 ימים, והתדלוק הבא בעוד 4 ימים.",
];

/**
 * Onboarding artwork built from the app's own components fed with static demo
 * data. It is decoration: `inert` and aria-hidden, so none of the real
 * controls inside can be focused or announced; the slide text and
 * ONBOARDING_ART_TEXT carry the meaning.
 */
export function OnboardingArt({ index }: { index: number }) {
  return <div className="entry-art" data-testid="onboarding-art" data-art={index + 1}>
    <div className="entry-art-frame" aria-hidden="true" ref={makeInert} data-testid="onboarding-art-demo">
      {index === 0 ? <TcoCard tco={DEMO_TCO} period="month" onPeriod={noop} onOpen={noop} />
        : index === 1 ? <div className="entry-record-art">
          <PumpDisplay className="entry-pump-art">
            <div className="tm-pump-row"><div className="tm-pump-line"><span className="tm-pump-label">סכום</span><span className="entry-pump-value"><Money value={218}/></span></div></div>
            <div className="tm-pump-row"><div className="tm-pump-line"><span className="tm-pump-label">קילומטראז׳</span><span className="entry-pump-value"><NumRun>170,344</NumRun></span></div></div>
          </PumpDisplay>
          <div className="entry-record-kinds">
            <Chip><PumpIcon size={16}/>תדלוק</Chip>
            <Chip><WrenchIcon size={16}/>טיפול</Chip>
            <Chip><CoinIcon size={16}/>הוצאה</Chip>
          </div>
        </div>
        : index === 2 ? <div className="entry-consumption-art">
          <span className="entry-art-label">צריכה בתדלוק האחרון</span>
          <ConsumptionValue kmPerLiter={12.8} units="kmPerLiter" className="entry-consumption-number" block/>
          <Pill tone="better"><NumericText>5% פחות דלק לק״מ מהרגיל</NumericText></Pill>
          <span className="entry-art-note"><NumRun>{price(0.68)}</NumRun> לק״מ · <NumericText>3% פחות מנהגים עם אותו דגם</NumericText></span>
        </div>
        : <div className="entry-care-art">
          <SpotlightCard id="onboarding-test" tone="warn" icon={<DocumentIcon size={20}/>}
            title={<NumericText>הטסט בעוד 22 ימים</NumericText>} body="כדאי לקבוע תור למכון הרישוי." onOpen={noop}/>
          <TankHero estimate={DEMO_TANK} onOpen={noop}/>
        </div>}
    </div>
    <span className="entry-example" aria-hidden="true">נתונים לדוגמה</span>
    <p className="sr-only" data-testid="onboarding-art-text">{ONBOARDING_ART_TEXT[index]}</p>
  </div>;
}
