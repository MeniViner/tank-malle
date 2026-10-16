import { describe, it, expect } from 'vitest';
import { suggestPricePerLiter } from './regulated';
import { validFuelDiscount, vehicleDiscount } from './discount';
const at=Date.parse('2026-10-16T12:00:00+03:00');
const car={fuelType:'95' as const, priceAdjustment:0, manualPricePerLiter:8.1};
const config=(price:number)=>({current:{pricePerLiter:price,updatedAt:at},history:{'2026-10':price},source:'gov.il'});
describe('discount from the official price',()=>{
 it('ignores the old fixed 8.1 and follows subsequent official changes',()=>{
  expect(suggestPricePerLiter(at,car,config(7.77)).price).toBe(7.77);
  expect(suggestPricePerLiter(at,car,config(7.55)).price).toBe(7.55);
 });
 it('applies the percentage or amount anew at each price change',()=>{
  const percent={...car,priceDiscount:{kind:'percent' as const,value:5}};
  const amount={...car,priceDiscount:{kind:'amount' as const,value:.2}};
  expect(suggestPricePerLiter(at,percent,config(7.77)).price).toBe(7.382);
  expect(suggestPricePerLiter(at,percent,config(8)).price).toBe(7.6);
  expect(suggestPricePerLiter(at,amount,config(7.77)).price).toBe(7.57);
  expect(suggestPricePerLiter(at,amount,config(8)).price).toBe(7.8);
 });
 it('can explicitly remove an old relative discount and never invents one from an absolute price',()=>{
  expect(vehicleDiscount({...car,priceAdjustment:-.2,priceDiscount:null})).toBeNull();
  expect(vehicleDiscount(car)).toBeNull();
  expect(vehicleDiscount({...car,priceAdjustment:-.2})).toEqual({kind:'amount',value:.2});
 });
 it('rejects malformed, negative and unbounded rules',()=>{
  for(const value of [{kind:'percent',value:101},{kind:'amount',value:-1},{kind:'amount',value:Infinity},{kind:'fixed',value:8.1}])expect(validFuelDiscount(value)).toBe(false);
 });
});
