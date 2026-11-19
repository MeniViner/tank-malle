import { num, price, shekel } from '../format';
import { latestOfficialPriceChange, officialPriceFor, upcomingOfficialPrice, type RegulatedPriceConfig } from '../prices/regulated';
import { isTankCapacityTrusted, type Vehicle } from '../stats';
import type { SpotlightItem } from './spotlight';

/** "5 בנובמבר" in Israel time, plus the hour only when the price does not start at midnight. */
function priceDay(at: number): string {
  const day = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long' }).format(at);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  return time === '00:00' ? day : `${day} ב-${time}`;
}

/** One short sentence for a small screen; the price sheet has the full dates and sources. */
function quantityDifference(vehicle: Vehicle, delta: number): string {
  if (!isTankCapacityTrusted(vehicle)) return '';
  const liters = vehicle.tankLiters!;
  const amount = Math.abs(delta) * liters;
  const quantity = num(liters, Number.isInteger(liters) ? 0 : 1);
  return Math.round(amount) === 0 ? ` ${quantity} ליטר: ההפרש קטן משקל.`
    : ` ${quantity} ליטר: כ-${shekel(amount)} ${delta < 0 ? 'פחות' : 'יותר'}.`;
}

/** Quantity examples use a trusted capacity, not a claim about the user's next fill-up or month. */
export function priceSpotlights(prices: RegulatedPriceConfig | null, vehicle: Vehicle, now: number): SpotlightItem[] {
  if (vehicle.fuelType !== '95') return [];
  const upcoming = upcomingOfficialPrice(prices, now);
  const current = officialPriceFor(prices, '95', now);
  if (upcoming && !(current.isRegulated && current.price === upcoming.pricePerLiter)) {
    const change = upcoming.change;
    return [{ id: `price:95:upcoming:${upcoming.effectiveFrom}:${upcoming.pricePerLiter}`, tone: 'info', icon: 'coin',
      title: change ? `בנזין 95 ${change.delta < 0 ? 'יוזל' : 'יתייקר'} ב-${price(Math.abs(change.delta))} לליטר` : 'פורסם מחיר חדש לבנזין 95',
      body: `${price(upcoming.pricePerLiter)} לליטר, מ-${priceDay(upcoming.effectiveFrom)}.${change ? quantityDifference(vehicle, change.delta) : ''}`,
      target: { kind: 'price' },
    }];
  }
  const change = latestOfficialPriceChange(prices, now);
  if (!change) return [];
  return [{ id: `price:95:active:${change.effectiveFrom}:${change.previousPrice}:${change.price}`, tone: 'info', icon: 'coin',
    title: `בנזין 95 ${change.delta < 0 ? 'ירד' : 'עלה'} ב-${price(Math.abs(change.delta))} לליטר`,
    body: `${price(change.price)} לליטר, מ-${priceDay(change.effectiveFrom)}.${quantityDifference(vehicle, change.delta)}`,
    target: { kind: 'price' },
  }];
}
