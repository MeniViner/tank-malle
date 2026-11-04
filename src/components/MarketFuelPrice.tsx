import { useMarketFuelPrice } from '../hooks/useMarketFuelPrice';
import { FUEL_TYPE_SHORT, price } from '../lib/format';
import { MARKET_PRICE_URL, marketPriceIsStale, type MarketFuelType } from '../lib/prices/marketSource';
import type { FuelType } from '../lib/types';
import { Num } from './Num';

/** 95 keeps its existing official-price path. No cross-fuel fallback. */
export function MarketFuelPrice({ fuelType, compact = false }: { fuelType: FuelType; compact?: boolean }) {
  if (fuelType !== '98' && fuelType !== 'diesel') return null;
  return <MarketFuelReading fuelType={fuelType} compact={compact} />;
}

function MarketFuelReading({ fuelType, compact }: { fuelType: MarketFuelType; compact: boolean }) {
  const { reading, refreshing, failed, refresh } = useMarketFuelPrice();
  const stale = reading && marketPriceIsStale(reading);
  const date = reading ? new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long', year: 'numeric' }).format(reading.effectiveFrom) : null;
  return <section aria-label={`מחירון ${FUEL_TYPE_SHORT[fuelType]}`} className={`flex min-w-0 flex-col gap-1 ${compact ? 'text-[12px]' : 'text-sm'}`}>
    <span className="text-muted">מחירון דלק · שירות מלא</span>
    <p><Num className={compact ? 'text-[24px] font-semibold' : 'text-[28px] font-semibold'}>{reading ? price(reading.prices[fuelType]) : '—'}</Num> <span className="text-muted">לליטר</span></p>
    <span>{FUEL_TYPE_SHORT[fuelType]} · מחוץ לאילת</span>
    <a href={MARKET_PRICE_URL} target="_blank" rel="noopener noreferrer" className="min-h-10 w-fit content-center text-ink underline">{date ? `מחירון מתאריך ${date}` : 'למחירון הרשת'}</a>
    <p className="text-muted">מחירון הרשת; המחיר ששולם בתחנה עשוי להיות שונה.</p>
    {failed ? <p role="status" className="text-muted">{reading ? 'הרענון לא הצליח; מוצג המחיר האחרון שנקרא.' : 'המחירון אינו זמין כרגע.'}</p> : stale ? <p role="status" className="text-muted">מחירון ישן; ממתינים לעדכון מאומת.</p> : null}
    <button type="button" className="min-h-10 w-fit text-start font-semibold text-ink" disabled={refreshing} onClick={refresh}>{refreshing ? 'בודקים מחירון…' : 'רענון מחירון'}</button>
  </section>;
}
