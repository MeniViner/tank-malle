import { describe, it, expect } from 'vitest';
import type { Fillup, Vehicle } from '../stats';
import { estimateTank } from './index';
import { displayTankLevel } from './display';
import { DEFAULT_TANK_PREFERENCES, type TankObservation } from './types';

const DAY = 86400000;
const NOW = Date.parse('2026-10-16T12:00:00+03:00');
const vehicle: Vehicle = { id:'v', make:'Test', model:'Tank', fuelType:'95', archived:false, priceAdjustment:0, tankLiters:50, tankLitersSource:'user', declaredKmPerLiter:15, declaredSource:'user' };
const history: Fillup[] = [0,1,2,3].map(i => ({ id:`f${i}`, date:NOW-(3-i)*7*DAY, odometer:10000+i*450, liters:30, pricePerLiter:7.77, totalCost:233.1, isFullTank:true, tankSchemaVersion:2, fillEndState:'full', fillEndStateSource:'user-confirmed' }));
const estimate = (now:number, fillups=history, observations:TankObservation[]=[]) => estimateTank({ vehicle, fillups, observations, preferences:DEFAULT_TANK_PREFERENCES, now });

describe('tank follows learned usage', () => {
  it('drops every day and advances the recommendation by exactly the elapsed time', () => {
    const start=estimate(NOW), tomorrow=estimate(NOW+DAY), later=estimate(NOW+3*DAY);
    expect(start.current.level).toBeCloseTo(1);
    const burn=start.mobility.kmPerDay! * start.consumption.litersPerKm!;
    expect(tomorrow.current.liters).toBeCloseTo(50-burn, 3);
    expect(later.current.liters).toBeCloseTo(50-3*burn, 3);
    expect(start.recommendedRefuel.days).not.toBeNull();
    expect(tomorrow.recommendedRefuel.days).toBeCloseTo(start.recommendedRefuel.days!-1, 3);
  });
  it('does not carry impossible excess fuel forward as a permanently full tank', () => {
    const bad: Fillup={...history[3], isFullTank:false, fillEndState:'partial', preFillLevel:.9, preFillLevelSource:'direct-gauge'};
    const records=[...history.slice(0,3),bad];
    const current=estimate(NOW,records), tomorrow=estimate(NOW+DAY,records);
    expect(current.activeNotes.some(n=>n.state==='overCapacity')).toBe(true);
    expect(current.current.level).toBe(1);
    expect(tomorrow.current.level).toBeLessThan(.99);
    const correction:TankObservation={id:'correction',vehicleId:'v',kind:'level',observedAt:NOW+DAY,recordedAt:NOW+DAY,level:.25,levelSource:'direct-gauge',confirmed:true};
    const corrected=estimate(NOW+DAY,records,[correction]);
    expect(corrected.notes.some(n=>n.state==='conflict')).toBe(true);
    expect(corrected.activeNotes).toHaveLength(0);
    expect(corrected.reasons).not.toContain('conflictingObservations');
    expect(corrected.current.level).toBeCloseTo(.25);
    expect(estimate(NOW+2*DAY,records,[correction]).current.level).toBeLessThan(.25);
  });
  it('keeps an actual backward odometer conflict visible after a gauge reading', () => {
    const bad:TankObservation={id:'bad-odo',vehicleId:'v',kind:'both',observedAt:NOW+DAY,recordedAt:NOW+DAY,odometer:9000,level:.8,levelSource:'direct-gauge',confirmed:true};
    const result=estimate(NOW+DAY,history,[bad]);
    expect(result.activeNotes.some(note=>note.state==='conflict' && note.residualLiters===null)).toBe(true);
  });
  it('never jumps back to the old full reading after a projection is exhausted', () => {
    const old=estimate(NOW+30*DAY);
    expect(old.current.rawLevel).toBeLessThan(0);
    expect(old.lastLevelReport?.level).toBe(1);
    expect(displayTankLevel(old)).toBeNull();
  });
});
