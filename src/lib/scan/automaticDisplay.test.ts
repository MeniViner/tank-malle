import { expect,it } from 'vitest';
import sharp from 'sharp';
import { recognizeDisplay } from './automaticDisplay';

it('refuses blank and malformed images instead of supplying a guessed value',()=>{
  for(const kind of ['pump','odometer'] as const) {
    expect(recognizeDisplay({width:960,height:1280,data:new Uint8Array(960*1280*4)},kind).status).toBe('unreadable');
    expect(recognizeDisplay({width:100000,height:100000,data:[]},kind).status).toBe('unreadable');
  }
});
// Private calibration photographs remain outside the repository. These are
// regressions for the supplied examples, not a held-out accuracy benchmark.
for(const [kind,env,expected] of [
  ['pump','CARE_PUMP_PHOTO',{total:'202.73',liters:'26.092'}],
  ['odometer','CARE_ODO_PHOTO',{odometer:'171272'}],
] as const) {
  for(const maximum of [960,1280])it.skipIf(!process.env[env])(`reads the supplied ${kind} photograph at ${maximum}px without a crop`,async()=>{
    const {data,info}=await sharp(process.env[env]!).rotate().resize({width:Math.round(maximum*.75),height:maximum,fit:'inside'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const started=performance.now();const result=recognizeDisplay({...info,data},kind);
    console.info(`${kind} recognition: ${Math.round(performance.now()-started)} ms`);
    expect(result).toEqual({status:'read',values:expected});
  });
}

it('reads other seven-segment values from generated whole-display fixtures',async()=>{
  const {demoPhoto}=await import('./fixtures');
  expect(recognizeDisplay(demoPhoto('pump'),'pump')).toEqual({status:'read',values:{total:'287.40',liters:'40.000'}});
  expect(recognizeDisplay(demoPhoto('odometer'),'odometer')).toEqual({status:'read',values:{odometer:'128450'}});
});

it('rejects missing decimals, a lone pump row, and competing odometers',async()=>{
  const {blank,drawDigits}=await import('./fixtures');
  const missing=blank(820,480);drawDigits(missing,'28740',150,95);drawDigits(missing,'40.000',150,285);
  expect(recognizeDisplay(missing,'pump').status).toBe('unreadable');
  const lone=blank(820,480);drawDigits(lone,'287.40',150,95);expect(recognizeDisplay(lone,'pump').status).toBe('unreadable');
  const competing=blank(820,480,[8,15,24]);drawDigits(competing,'128450',130,70,[40,170,255]);drawDigits(competing,'265408',130,290,[40,170,255]);
  expect(recognizeDisplay(competing,'odometer').status).toBe('unreadable');
});
it('decodes alternate values instead of substituting calibration numbers',async()=>{
  const {blank,drawDigits}=await import('./fixtures');
  const pump=blank(820,480);drawDigits(pump,'528.60',150,95);drawDigits(pump,'60.000',150,285);
  expect(recognizeDisplay(pump,'pump')).toEqual({status:'read',values:{total:'528.60',liters:'60.000'}});
  const odo=blank(820,480,[8,15,24]);drawDigits(odo,'265408',130,190,[40,170,255]);
  expect(recognizeDisplay(odo,'odometer')).toEqual({status:'read',values:{odometer:'265408'}});
});
it.skipIf(!process.env.CARE_PUMP_PHOTO||!process.env.CARE_ODO_PHOTO)('reads or refuses transformed calibration photos without changing the numbers',async()=>{
  let read=0,refused=0;
  for(const [kind,path,values] of [
    ['pump',process.env.CARE_PUMP_PHOTO,{total:'202.73',liters:'26.092'}],
    ['odometer',process.env.CARE_ODO_PHOTO,{odometer:'171272'}],
  ] as const)for(const [width,brightness,angle,quality] of [[960,1,0,70],[768,.85,0,80],[960,1.1,2,80],[960,1,-2,80]]) {
    const original=await sharp(path!).rotate().toBuffer();
    const encoded=await sharp(original).rotate(angle,{background:'#444444'}).resize({width,height:Math.round(width*4/3),fit:'inside'}).modulate({brightness}).jpeg({quality}).toBuffer();
    const {data,info}=await sharp(encoded).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const result=recognizeDisplay({...info,data},kind);
    if(result.status==='read'){expect(result.values).toEqual(values);read++;}else refused++;
  }
  console.info(`Transformed calibration samples: ${read} read, ${refused} refused`);
});
