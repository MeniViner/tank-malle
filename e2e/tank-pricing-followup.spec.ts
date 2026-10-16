import { test, expect } from '@playwright/test';
import { signedInWithData } from './helpers/app';
import { getDocument, seedRegulatedPrice, setDocument } from './helpers/emulator';
test.use({serviceWorkers:'block'});

const car={make:'מבחן',model:'מיכל',tankLiters:50,tankLitersSource:'user' as const,declaredKmPerLiter:15,manualPricePerLiter:8.1};
const DAY=86400000;

test('official price stays live; amount and percent discounts persist without a fixed override',async({page})=>{
 const {uid,vehicleId}=await signedInWithData(page,{vehicle:car,regulatedPrice:7.77});
 await page.goto('/fillup/new');
 await expect(page.getByLabel('מחיר לליטר',{exact:true})).toHaveValue('7.77');
 await seedRegulatedPrice(8);
 await expect(page.getByLabel('מחיר לליטר',{exact:true})).toHaveValue('8');
 await page.goto('/settings');
 await page.getByRole('button',{name:/הנחה מהמחיר הרשמי/}).click();
 await page.getByRole('radio',{name:'אחוזים',exact:true}).click();
 await page.getByLabel('שיעור ההנחה',{exact:true}).fill('5');
 await page.getByRole('dialog').getByRole('button',{name:'שמירה',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 const path=`users/${uid}/vehicles/${vehicleId}`;
 expect((await getDocument(path))?.priceDiscount).toEqual({kind:'percent',value:5});
 expect((await getDocument(path))?.manualPricePerLiter).toBeNull();
 await page.goto('/fillup/new');
 await expect(page.getByLabel('מחיר לליטר',{exact:true})).toHaveValue('7.6');
 await seedRegulatedPrice(7.77);
 await expect(page.getByLabel('מחיר לליטר',{exact:true})).toHaveValue('7.382');
 await page.goto('/settings');
 await page.getByRole('button',{name:/הנחה מהמחיר הרשמי/}).click();
 await page.getByRole('radio',{name:'₪ לליטר',exact:true}).click();
 await page.getByLabel('הנחה לליטר',{exact:true}).fill('0.2');
 await page.getByRole('dialog').getByRole('button',{name:'שמירה',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.goto('/fillup/new');
 await expect(page.getByLabel('מחיר לליטר',{exact:true})).toHaveValue('7.57');
 await page.reload();
 await expect(page.getByLabel('מחיר לליטר',{exact:true})).toHaveValue('7.57');
 // An actual receipt edit is scoped to that receipt and must survive a refresh.
 await page.getByLabel('מחיר לליטר',{exact:true}).fill('7.4');
 await seedRegulatedPrice(8);
 await expect(page.getByLabel('מחיר לליטר',{exact:true})).toHaveValue('7.4');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('learned fuel falls with time, the handle matches its fill, and correction clears the warning',async({page},testInfo)=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 const now=Date.now();
 const {uid,vehicleId}=await signedInWithData(page,{vehicle:car,regulatedPrice:7.77,fillups:[0,1,2,3].map(i=>({id:`h${i}`,date:new Date(now-(3-i)*7*DAY),odometer:10000+i*450,liters:30}))});
 const base=`users/${uid}/vehicles/${vehicleId}`;
 await setDocument(base+'/fillups/h3',{...(await getDocument(base+'/fillups/h3')),tankSchemaVersion:2,fillEndState:'partial',fillEndStateSource:'user-confirmed',isFullTank:false,preFillLevel:.9,preFillLevelSource:'direct-gauge'});
 await expect(page.getByRole('button',{name:'עדכון המיכל',exact:true})).toBeVisible();
 await expect(page.getByTestId('current-tank-level')).toHaveText('כ־100%');
 await page.clock.install({time:new Date(now)});
 await page.clock.setSystemTime(new Date(now+DAY));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect.poll(async()=>Number((await page.getByTestId('current-tank-level').innerText()).replace(/[^0-9]/g,''))).toBeLessThan(100);
 await page.clock.setSystemTime(new Date(now));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByRole('button',{name:'עדכון המיכל',exact:true}).click();
 const slider=page.getByRole('slider');
 await slider.press('Home');
 for(let i=0;i<8;i++)await slider.press('ArrowUp');
 await expect(slider).toHaveAttribute('aria-valuenow','40');
 await expect.poll(() => slider.evaluate(element => {
  const fuel=element.querySelector('[data-testid="tank-gauge-fill"]')!.getBoundingClientRect();
  const handle=element.querySelector('[data-testid="tank-gauge-handle"]')!.getBoundingClientRect();
  return Math.abs(handle.y+handle.height/2-fuel.y);
 })).toBeLessThan(1);
 await page.screenshot({path:testInfo.outputPath('gauge-aligned.png')});
 await page.getByRole('dialog').getByRole('button',{name:'שמירה',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'עדכון המיכל',exact:true})).toHaveCount(0);
 await expect(page.getByTestId('current-tank-level')).toHaveText('כ־40%');
 await page.clock.setSystemTime(new Date(now+DAY));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect.poll(async()=>Number((await page.getByTestId('current-tank-level').innerText()).replace(/[^0-9]/g,''))).toBeLessThan(40);
 await page.clock.setSystemTime(new Date(now+30*DAY));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByTestId('current-tank-level')).toHaveText('לא ידוע');
});

test('RTL price comparison and money cards align their figures to the right',async({page},testInfo)=>{
 const now=Date.now();
 await signedInWithData(page,{vehicle:car,regulatedPrice:7.77,fillups:[0,1,2].map(i=>({id:`s${i}`,date:new Date(now-(2-i)*3*DAY),odometer:10000+i*450,liters:30,pricePerLiter:7.5,stationName:`תחנת בדיקה ${i}`}))});
 await page.goto('/stats');
 await page.getByRole('button',{name:'מחירים',exact:true}).click();
 for(const label of ['מול המחיר הרשמי בתאריכי התדלוקים','התדלוק היקר ביותר']){
  const card=page.getByText(label,{exact:true}).locator('..');
  const number=card.locator('[dir="ltr"]').first();
  const n=await number.boundingBox(), c=await card.boundingBox();
  expect(c!.x+c!.width-n!.x-n!.width).toBeLessThan(22);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('prices-rtl.png'),fullPage:true});
});
