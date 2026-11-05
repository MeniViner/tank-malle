import { useMemo, useState } from "react";
import { useData } from "../../context/DataContext";
import { useMarketFuelPrice } from "../../hooks/useMarketFuelPrice";
import { fullDate, heMonthShort, monthYear, price } from "../../lib/format";
import { officialPriceHistory, type OfficialPricePoint } from "../../lib/home/presentation";
import { discountedPrice, vehicleDiscount } from "../../lib/prices/discount";
import { MARKET_PRICE_URL, marketPriceIsStale } from "../../lib/prices/marketSource";
import { officialPriceFor, officialPriceMoment, upcomingOfficialPrice } from "../../lib/prices/regulated";
import { israelMonthKey, publicationDate } from "../../lib/prices/publicSource";
import { type Vehicle } from "../../lib/stats";
import { Button } from "../Button";
import { Pill } from "../DesignPrimitives";
import { FuelDiscountSheet } from "../FuelDiscountSheet";
import { NumericText, NumRun, PricePerLiter } from "../Fmt";
import { TagIcon } from "../icons";
import { Sheet } from "../Sheet";

interface Props { vehicle: Vehicle; now: number; open: boolean; onOpen: () => void; onClose: () => void }
type Lookup = ReturnType<typeof officialPriceFor>;

export function HomeFuelPrice(props: Props) {
  const { prices } = useData();
  const lookup = officialPriceFor(prices, props.vehicle.fuelType, props.now);
  return props.vehicle.fuelType === "98" || props.vehicle.fuelType === "diesel"
    ? <MarketPrice {...props} lookup={lookup} /> : <PriceCard {...props} lookup={lookup} />;
}

function MarketPrice(props: Props & { lookup: Lookup }) {
  const market = useMarketFuelPrice();
  return <PriceCard {...props} market={market} />;
}

function PriceCard({ vehicle, now, open, onOpen, onClose, lookup, market }: Props & {
  lookup: Lookup; market?: ReturnType<typeof useMarketFuelPrice>;
}) {
  const { prices } = useData();
  const [discountOpen, setDiscountOpen] = useState(false);
  const fuel = vehicle.fuelType;
  const marketFuel = fuel === "98" || fuel === "diesel" ? fuel : null;
  const marketValue = marketFuel && market?.reading ? market.reading.prices[marketFuel] : null;
  const value = lookup.price ?? marketValue;
  const fromMarket = lookup.price === null && !!market;
  const current = lookup.effectiveMonth === israelMonthKey(now);
  const name = fuel === "95" ? "בנזין 95" : fuel === "98" ? "בנזין 98" : fuel === "diesel" ? "סולר" : "דלק";
  const label = fromMarket ? `מחירון ${fuel === "98" ? "98" : "סולר"}` : fuel === "other" ? "מחיר הדלק"
    : current ? `${fuel === "diesel" ? "סולר" : fuel} היום` : `מחיר ${fuel === "diesel" ? "סולר" : fuel}`;
  const discount = fuel === "95" ? vehicleDiscount(vehicle) : null;
  const after = lookup.price !== null && discount?.value ? discountedPrice(lookup.price, discount) : null;
  const staleMarket = market?.reading ? marketPriceIsStale(market.reading, now) : false;
  const caption = value === null ? "לא ידוע" : fromMarket ? staleMarket ? "מחירון אחרון" : "מחירון הרשת"
    : !current ? "מחיר אחרון" : lookup.isManual ? "הוזן ידנית" : after !== null ? "לפני ההנחה" : lookup.isRegulated ? "מחיר מרבי" : "מחיר שנשמר";
  const upcoming = fuel === "95" ? upcomingOfficialPrice(prices, now) : null;
  const officialUrl = lookup.sourceUrl && publicationDate(lookup.sourceUrl) !== null ? lookup.sourceUrl : null;
  const history = useMemo(() => fuel === "95" ? officialPriceHistory(prices, now).slice(-6) : [], [fuel, prices, now]);
  return <>
    <button type="button" className="home-trio-cell" onClick={onOpen} data-testid="home-fuel-price">
      <span className="home-trio-label"><NumericText>{label}</NumericText></span>
      <NumRun block className="home-trio-value">{value === null ? "—" : price(value)}</NumRun>
      <span className="home-trio-caption">{caption}</span>
    </button>
    <Sheet open={open} onClose={() => { setDiscountOpen(false); onClose(); }} title={<h2><NumericText>{name}</NumericText></h2>}>
      <div className="home-sheet-stack" data-testid="price-sheet">
        {value === null ? <NumRun block className="home-sheet-price">—</NumRun>
          : <PricePerLiter value={value} className="home-sheet-price" unitClassName="home-sheet-unit" />}
        {fromMarket ? <>
          <p className="home-sheet-note">מחירון דלק · שירות מלא · מחוץ לאילת</p>
          {market?.reading ? <p className="home-sheet-note"><NumericText>{`המחירון בתוקף מ-${fullDate(market.reading.effectiveFrom)}`}</NumericText></p> : null}
          <p className="home-sheet-note">מחירון הרשת; המחיר ששולם בתחנה עשוי להיות שונה.</p>
        </> : <>
          <p className="home-sheet-note"><NumericText>{lookup.price === null ? "אין מחיר עדכני לסוג הדלק הזה" : lookup.isManual ? "מחיר שהוזן ידנית" : lookup.isRegulated ? "מחיר מרבי מפוקח · שירות עצמי" : "מחיר שנשמר"}</NumericText></p>
          {lookup.effectiveFrom ? <p className="home-sheet-note"><NumericText>{`בתוקף מ-${officialPriceMoment(lookup.effectiveFrom)} (שעון ישראל)`}</NumericText></p> : lookup.effectiveMonth ? <p className="home-sheet-note"><NumericText>{`${current ? "מחיר ל" : "המחיר האחרון שנשמר: "}${monthYear(lookup.effectiveMonth)}`}</NumericText></p> : null}
          {lookup.updatedAt ? <p className="home-sheet-note"><NumericText>{`עודכן ${fullDate(lookup.updatedAt)}`}</NumericText></p> : null}
        </>}
        {officialUrl ? <a className="home-text-action" href={officialUrl} target="_blank" rel="noopener noreferrer">להודעת משרד האנרגיה על המחיר הנוכחי</a> : null}
        {upcoming ? <section className="home-sheet-stack" aria-label="עדכון מחיר שפורסם" data-testid="upcoming-official-price">
          <h3>עדכון מחיר שפורסם</h3>
          <PricePerLiter value={upcoming.pricePerLiter} />
          <p className="home-sheet-note"><NumericText>{`ייכנס לתוקף ב-${officialPriceMoment(upcoming.effectiveFrom)} (שעון ישראל). עד אז חל המחיר הנוכחי.`}</NumericText></p>
          {upcoming.publishedOn ? <p className="home-sheet-note"><NumericText>{`תאריך פרסום ההודעה: ${upcoming.publishedOn.split('-').reverse().join('.')}`}</NumericText></p> : null}
          <p className="home-sheet-note"><NumericText>{`נבדק מול המקור ב-${officialPriceMoment(upcoming.retrievedAt)}`}</NumericText></p>
          <a className="home-text-action" href={upcoming.sourceUrl} target="_blank" rel="noopener noreferrer">להודעת משרד האנרגיה על המחיר הבא</a>
        </section> : null}
        {after !== null ? <Pill tone="better"><span>אחרי ההנחה שלך: <NumRun>{price(after)}</NumRun></span></Pill> : null}
        {history.length ? <OfficialHistory points={history} /> : null}
        {fuel === "95" ? <>
          <p className="home-sheet-note">המחיר המרבי של משרד האנרגיה הוא תקרה לבנזין <NumRun>95</NumRun> בשירות עצמי. המחיר ששולם בפועל נשמר בנפרד בכל תדלוק.</p>
          <Button variant="line" size="sm" onClick={() => setDiscountOpen(true)}><TagIcon size={18} />{discount?.value ? "עריכת ההנחה" : "יש לך הנחה בתדלוק?"}</Button>
        </> : null}
        {market ? <div className="home-sheet-stack">
          {!fromMarket ? <><p className="home-sheet-note">מחירון דלק · שירות מלא · מחוץ לאילת</p>
            {marketValue !== null ? <PricePerLiter value={marketValue} /> : <span>המחירון אינו זמין כרגע</span>}
            {market.reading ? <p className="home-sheet-note"><NumericText>{`בתוקף מ-${fullDate(market.reading.effectiveFrom)}`}</NumericText></p> : null}</> : null}
          <a className="home-text-action" href={MARKET_PRICE_URL} target="_blank" rel="noopener noreferrer">למחירון הרשת</a>
          {market.failed ? <p role="status" className="home-sheet-note">{market.reading ? "הרענון לא הצליח; מוצג המחיר האחרון שנקרא." : "המחירון אינו זמין כרגע."}</p>
            : staleMarket ? <p role="status" className="home-sheet-note">מחירון ישן; ממתינים לעדכון מאומת.</p> : null}
          <Button variant="line" size="sm" onClick={market.refresh} disabled={market.refreshing}>{market.refreshing ? "בודקים מחירון…" : "רענון מחירון"}</Button>
        </div> : null}
      </div>
    </Sheet>
    {open && discountOpen && fuel === "95" ? <FuelDiscountSheet key={vehicle.id} vehicle={vehicle} official={lookup.price} onClose={() => setDiscountOpen(false)} /> : null}
  </>;
}

function OfficialHistory({ points }: { points: OfficialPricePoint[] }) {
  const width = 350, height = 136;
  const min = Math.min(...points.map(point => point.value)), max = Math.max(...points.map(point => point.value));
  const spread = Math.max(.2, max - min);
  const positions = points.map((point, index) => ({ ...point,
    x: points.length === 1 ? width / 2 : width - 26 - index * (width - 52) / (points.length - 1),
    y: 30 + (max - point.value) / spread * 64,
  }));
  return <figure className="home-price-history" aria-label="היסטוריית המחיר המרבי שנשמרה" data-testid="price-history">
    <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={positions.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke="var(--ink)" strokeWidth="2.25" />
      {positions.map(point => <circle key={point.month} cx={point.x} cy={point.y} r="4" fill="var(--ink)" />)}
    </svg>
    {positions.map(point => <span key={point.month}>
      <span className="home-price-history-value" style={{ left: `${point.x / width * 100}%`, top: `${(point.y - 10) / height * 100}%` }}><NumRun>{price(point.value)}</NumRun></span>
      <span className="home-price-history-date" style={{ left: `${point.x / width * 100}%` }} aria-label={monthYear(point.month)}>{heMonthShort(Number(point.month.slice(5)))}</span>
    </span>)}
  </figure>;
}
