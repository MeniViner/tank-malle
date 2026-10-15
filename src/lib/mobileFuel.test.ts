import { matchDeclared } from "./declaredCatalog";
import { describe, expect, it, vi, afterEach } from 'vitest';
import { authDomainFor, authErrorMessage } from './authFlow';
import { publicationDate, publicationLinks } from './prices/publicSource';
import { regulatedMaxPrice, withPublicPrice } from './prices/regulated';
import { manufacturerTank } from './manufacturerSpecs';
import { fetchVehicleSpecs } from './vehicleSpecs';
import { usageInsights } from './tank/usageInsights';
import type { Fillup } from './stats';
const first = Date.parse('2026-09-30T21:00:00Z');
const fifth = Date.parse('2026-10-04T21:00:00Z');
afterEach(() => vi.unstubAllGlobals());
describe('mobile fuel release regressions', () => {
  it('does not invent an OAuth redirect not registered at Google', () => {
    expect(authDomainFor('tank-malle.web.app', 'tank-malle', 'tank-malle.firebaseapp.com')).toBe('tank-malle.firebaseapp.com');
    expect(authErrorMessage('auth/popup-blocked')).toContain('חלון');
    expect(authErrorMessage('auth/popup-closed-by-user')).toBeNull();
  });
  it('orders effective dates, ignores future or foreign publications, and handles winter time', () => {
    const links = publicationLinks('https://evil.example/fuel-october-10-2026 https://www.gov.il/he/pages/fuel-november-2026 https://www.gov.il/he/pages/fuel-october-2026 https://www.gov.il/he/pages/fuel-october-5-2026', fifth + 1000);
    expect(links).toHaveLength(2);
    expect(links[0]).toContain('october-5');
    expect(publicationDate('https://www.gov.il/he/pages/fuel-november-2026')).toBe(Date.parse('2026-10-31T22:00:00Z'));
    expect(publicationDate('https://www.gov.il/he/pages/fuel-february-31-2026')).toBeNull();
  });
  it('preserves early-month history and never rolls back to an older publication', () => {
    const old = { byFuelType: { '95': { self: { history: { '2026-10': 8.27 }, scheduledHistory: { '2026-10': 8.27 }, source: 'scheduled' as const, current: { pricePerLiter: 8.27, effectiveFrom: first } } } } };
    const reading = { price: 7.77, month: '2026-10', effectiveFrom: fifth, readAt: fifth + 1000, url: 'https://www.gov.il/he/pages/fuel-october-5-2026' };
    const next = withPublicPrice(old, reading);
    expect(regulatedMaxPrice(next, '95', first + 1000).price).toBe(8.27);
    expect(regulatedMaxPrice(next, '95', fifth + 1000).price).toBe(7.77);
    expect(regulatedMaxPrice(withPublicPrice(next, { ...reading, effectiveFrom: first, price: 8.27 }), '95', fifth + 1000).price).toBe(7.77);
    expect(regulatedMaxPrice(next, 'diesel', fifth).price).toBeNull();
  });
  it('matches a sourced capacity without applying it to another generation or fuel', () => {
    expect(manufacturerTank('יונדאי', 'I20 INSPIRE', 2012)?.liters).toBe(45);
    expect(manufacturerTank('יונדאי', 'I20', 2020)).toBeNull();
    expect(manufacturerTank('יונדאי', 'I20', 2012, 'other')).toBeNull();
  });
  it('preserves month-start history when a stale current pointer is from the previous month', () => {
    const old = { byFuelType: { '95': { self: { history: { '2026-09': 8.25, '2026-10': 8.27 }, scheduledHistory: { '2026-09': 8.25, '2026-10': 8.27 }, source: 'scheduled' as const, current: { pricePerLiter: 8.25, effectiveFrom: Date.parse('2026-09-01T00:00:00Z') } } } } };
    const next = withPublicPrice(old, { price: 7.77, month: '2026-10', effectiveFrom: fifth, readAt: fifth + 1000, url: 'https://www.gov.il/he/pages/fuel-october-5-2026' });
    expect(regulatedMaxPrice(next, '95', Date.parse('2026-09-15T00:00:00Z')).price).toBe(8.25);
    expect(regulatedMaxPrice(next, '95', first + 1000).price).toBe(8.27);
    expect(regulatedMaxPrice(next, '95', fifth + 1000).price).toBe(7.77);
  });
  it('requires the same test year, emissions, fuel, power and transmission for declared economy', () => {
    const row: import('./declaredCatalog').DeclaredRow = [2012, 'HYUNDAI', 'I20', 'ES', 0, 114, 62, 4.9];
    const params = { make:'יונדאי', model:'I20', year:2012, co2:114, automatic:0, powerKw:62.5, fuel:'ES' };
    expect(matchDeclared([row], params)).toBe(20.4);
    expect(matchDeclared([row], {...params, automatic:1})).toBeNull();
    expect(matchDeclared([row], {...params, year:2014})).toBeNull();
    expect(matchDeclared([row], {...params, powerKw:74})).toBeNull();
    expect(matchDeclared([row, [...row.slice(0,7), 5.0] as typeof row], params)).toBeNull();
  });
  it('retains manufacturer capacity when the public registry is offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect((await fetchVehicleSpecs({ make: 'יונדאי', model: 'I20', year: 2012 })).trustedTankLiters).toBe(45);
  });
  it('does not claim ambiguous named variants as exact consumption', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { records: [
      { tozar: 'יונדאי', kamut_CO2: 133 }, { tozar: 'יונדאי', kamut_CO2: 146 },
    ] } }))));
    const result = await fetchVehicleSpecs({ make: 'יונדאי', model: 'I20', year: 2012 });
    expect(result.declaredKmPerLiter).toBeNull();
    expect(result.trustedTankLiters).toBe(45);
  });
  it('learns purchase cadence from legacy records without fabricating fuel levels', () => {
    const now = Date.now();
    const fills = [0, 7, 14, 21].map((d, i) => ({ id: String(i), date: now - (21-d)*86400000, odometer: i*300, liters: 30+i, isFullTank: true, totalCost: 240, pricePerLiter: 8 } satisfies Fillup));
    expect(usageInsights(fills, now)).toEqual({count: 4, typicalLiters: 31.5, cadenceDays: 7});
    expect(usageInsights(fills.map((f,i) => ({...f, continuityBreakBefore:i===2})), now).cadenceDays).toBeNull();
  });
});
