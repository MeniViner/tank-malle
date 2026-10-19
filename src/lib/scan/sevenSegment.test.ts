import { describe, expect, it } from 'vitest';
import { recognizeLine } from './sevenSegment';
import { lineFixture, blank, drawDigits } from './fixtures';
import { reviewedScan } from './draft';

describe('deterministic scan pixels',()=>{
  for (const text of ['287.40','40.000','10.25','888.88','600.00']) for(const options of [{},{blue:true},{light:true},{scale:.6}]) {
    it(`reads ${text} ${JSON.stringify(options)}`,()=>{ expect(recognizeLine(lineFixture(text,options))).toMatchObject({status:'candidate',text,requiresConfirmation:true}); });
  }
  for(const text of ['128450','999999','111111','0']) it(`reads odometer ${text}`,()=>{expect(recognizeLine(lineFixture(text,{blue:true}),{kind:'odometer'})).toMatchObject({status:'candidate',text});});
  it('refuses a missing decimal instead of guessing the amount',()=>expect(recognizeLine(lineFixture('28740')).status).toBe('unreadable'));
  it('refuses decimal trip mileage',()=>expect(recognizeLine(lineFixture('450.2'),{kind:'odometer'}).status).toBe('unreadable'));
  it('refuses blank images and two rows',()=>{
    expect(recognizeLine(blank(300,120)).status).toBe('unreadable'); const image=blank(650,320); drawDigits(image,'287.40',20,15);drawDigits(image,'40.000',20,200);
    expect(recognizeLine(image).status).toBe('unreadable');
  });
  it('applies reviewed measurements atomically and derives paid price',()=>{
    expect(reviewedScan({total:'287.40',liters:'40',odometer:'128450'})).toEqual({odometer:'128450',receipt:{totalCost:'287.4',liters:'40',pricePerLiter:'7.185',authored:['totalCost','liters']}});
    expect(reviewedScan({total:'20',liters:'0',odometer:'200'})).toBeNull();
    expect(reviewedScan({total:'20',liters:'4',odometer:'200.5'})).toBeNull();
  });
});
