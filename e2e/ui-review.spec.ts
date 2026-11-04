import {openFillupMore} from "./helpers/fillup";
import {test,expect,type Locator} from '@playwright/test';
import {signedInWithData} from './helpers/app';
import {getDocument,setDocument} from './helpers/emulator';
import {openInsightFuelDetail,selectInsight} from './helpers/insights';
const DAY=86400000;
const car={make:'רכב',model:'בדיקת ממשק',tankLiters:50,tankLitersSource:'user' as const,declaredKmPerLiter:15};
const records=(n:number)=>Array.from({length:n},(_,i)=>({id:`ui-${i}`,date:new Date(Date.now()-(n-i)*7*DAY),odometer:170000+i*450,liters:30,pricePerLiter:7.77}));

test('a recent gauge with old mileage has one odometer action after every source loads',async({page})=>{
  const {uid,vehicleId}=await signedInWithData(page,{vehicle:car,fillups:[{id:'old-mileage',date:new Date(Date.now()-28*DAY),odometer:100000,liters:40,pricePerLiter:7,totalCost:280}]});
  await setDocument(`users/${uid}/vehicles/${vehicleId}/observations/gauge`,{observedAt:new Date(Date.now()-60000),recordedAt:new Date(),kind:'level',level:0.5,confirmed:true,levelSource:'direct-gauge'});
  await page.goto('/');
  const tank=page.getByTestId('tank-hero');await expect(tank).toBeVisible();
  await tank.click();
  await expect(page.getByTestId('tank-open-odometer')).toHaveCount(1);
  await expect(page.getByTestId('tank-open-odometer')).toContainText('100,000');
  await page.getByTestId('tank-open-odometer').click();
  await expect(page.getByRole('dialog',{name:'עדכון קילומטראז׳',exact:true}).getByLabel('קילומטראז׳ נוכחי')).toBeVisible();
});

test('Home keeps a compact tank and moves measured mileage and honest habit details into its sheet',async({page},info)=>{
  const {uid,vehicleId}=await signedInWithData(page,{vehicle:car,fillups:records(2)});
  const base=`users/${uid}/vehicles/${vehicleId}`;
  await setDocument(base+'/maintenancePlans/one',{schemaVersion:1,version:1,title:'החלפת שמן',job:'oil',dueDay:'2026-01-01',dueOdometer:null,intervalMonths:null,intervalKm:null,basis:'manual',source:'owner',notes:'',active:true});
  await page.goto('/');
  const tank=page.getByTestId('tank-hero');await expect(tank).toBeVisible();
  await expect(page.getByTestId('vehicle-alert-count')).toHaveText('1');
  await expect(page.getByRole('button',{name:'תכנון נסיעה',exact:true})).toHaveCount(0);
  await expect(page.getByTestId('mileage-precision')).toHaveCount(0);
  expect((await tank.boundingBox())!.height).toBeLessThan(380);
  await expect(page.getByTestId('tank-headline')).toHaveText('כמה דלק יש עכשיו?');
  await expect(tank).toHaveAccessibleDescription(/כמות הדלק לא ידועה.*מחוון/);
  await expect(tank).not.toContainText('בדרך כלל אתה מתדלק');
  // Two odometer records support a latest reading, but only one travel
  // interval: the canonical mobility model still withholds a daily rate.
  await expect(page.getByTestId('home-km-day')).toContainText('—');
  await expect(page.getByTestId('home-km-day')).toContainText('אחרי כמה רישומים');
  await page.screenshot({path:info.outputPath('home-review.png')});
  await tank.click();
  await expect(page.getByTestId('tank-open-odometer')).toContainText('170,450');
  await expect(page.getByTestId('tank-open-trip')).toBeVisible();
  await expect(page.getByTestId('tank-open-habit')).toContainText('עוד לומדים');
  expect((await getDocument(base+'/maintenancePlans/one'))?.active).toBe(true);
});

test('authored pump figures stay fixed and optional tank controls never choose an endpoint',async({page},info)=>{
  await signedInWithData(page,{vehicle:car,regulatedPrice:7.77});await page.goto('/fillup/new');
  const liters=page.getByTestId('fillup-liters'),total=page.getByTestId('fillup-total'),price=page.getByTestId('fillup-price');
  await expect(price).toHaveValue('7.77');
  await liters.fill('40');await expect(total).toHaveValue('310.80');
  await total.fill('155.4');await expect(liters).toHaveValue('40');await expect(price).toHaveValue('3.885');
  await liters.fill('30');await expect(total).toHaveValue('155.4');await expect(price).toHaveValue('5.18');
  await price.fill('7.5');await expect(total).toHaveValue('155.4');await expect(liters).toHaveValue('30');
  await expect(page.getByTestId('fillup-receipt-conflict')).toBeVisible();
  await total.fill('300');await expect(liters).toHaveValue('30');await expect(price).toHaveValue('7.5');
  // Only deliberately clearing total releases its ownership. Neither of the
  // other authored figures moves; the next price edit derives total again.
  await total.fill('');await expect(liters).toHaveValue('30');await expect(price).toHaveValue('7.5');
  await price.fill('7.6');await expect(total).toHaveValue('228.00');
  await page.getByTestId('fillup-odometer').fill('100000');
  const full=page.getByRole('radio',{name:'מילאתי עד הסוף',exact:true});await expect(full).toBeVisible();await expect(full).toHaveAttribute('aria-checked','false');
  await openFillupMore(page);
  await expect(page.getByRole('slider',{name:'כמה דלק נשאר לפני התדלוק'})).toHaveAttribute('aria-valuetext','עדיין לא סומן');
  await expect(full).toHaveAttribute('aria-checked','false');
  await full.click();await expect(page.getByTestId('fillup-live-preview')).toContainText('טנק מלא ראשון');
  await page.getByTestId('fillup-more-toggle').click();
  await expect(page.getByRole('slider',{name:'כמה דלק נשאר לפני התדלוק'})).toHaveCount(0);await expect(full).toHaveAttribute('aria-checked','true');
  await page.screenshot({path:info.outputPath('fillup-review.png')});
});

test('period lists select full rows, return focus and keep standalone money aligned right',async({page},info)=>{
  await signedInWithData(page,{vehicle:car,fillups:records(4)});await page.goto('/history');
  const period=page.getByRole('button',{name:'תקופת היומן',exact:true});
  await period.click();const dialog=page.getByRole('dialog');const all=dialog.getByRole('button',{name:'כל התקופה',exact:true});
  await expect(all).toHaveAttribute('aria-pressed','true');
  expect((await all.boundingBox())!.width).toBeGreaterThan(250);
  expect(await all.evaluate(e=>getComputedStyle(e).borderWidth)).toBe('0px');
  await page.keyboard.press('Escape');await expect(period).toBeFocused();
  await period.click();await dialog.getByRole('button',{name:'החודש',exact:true}).click();await expect(page).toHaveURL(/period=month/);
  const search=page.getByRole('searchbox',{name:'חיפוש ביומן'});expect((await search.boundingBox())!.x).toBeGreaterThan((await period.boundingBox())!.x);
  for(const strong of await page.locator('.v-statpair strong').all())expect(await strong.evaluate(e=>getComputedStyle(e).textAlign)).toBe('right');
  await page.screenshot({path:info.outputPath('ledger-review.png')});
  await page.goto('/stats');await page.getByRole('button',{name:'6 חודשים אחרונים',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'6 חודשים אחרונים',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:info.outputPath('period-review.png')});
  await dialog.getByRole('button',{name:'כל התקופה',exact:true}).click();
  await selectInsight(page,'spend');await openInsightFuelDetail(page);
  const chart=page.getByTestId('insights-odometer-chart');
  await expect(chart.locator('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value').first()).toHaveText('0');
  await expect(chart).toHaveAccessibleName('קילומטראז׳ מצטבר, כולל הפסקות רציפות');
  const leading=page.locator('.insights-kpi strong');expect(await leading.count()).toBeGreaterThan(0);
  for(const strong of await leading.all())expect(await strong.evaluate(e=>getComputedStyle(e).textAlign)).toBe('right');
  await expect(page.getByTestId('insights-period-summary')).toContainText('4 תדלוקים · 3 מקטעים');
});

test('care is compact, has no duplicate mileage action and preserves several jobs in a draft',async({page},info)=>{
  await signedInWithData(page,{vehicle:car});await page.goto('/vehicle');
  await expect(page.getByRole('button',{name:'עדכון ק״מ',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'עדכון',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'הוספת טיפול',exact:true}).click();const dialog=page.getByRole('dialog');
  const choices=dialog.locator('.care-choice');await expect(choices).toHaveCount(7);
  for(const item of await choices.all()){
    const box=await item.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  await dialog.getByRole('button',{name:'צמיגים',exact:true}).click();await dialog.getByRole('button',{name:'בלמים',exact:true}).click();
  await page.screenshot({path:info.outputPath('care-review.png')});
  await dialog.getByRole('button',{name:'המשך לפרטי הטיפול'}).click();await dialog.getByLabel('עלות כוללת',{exact:true}).fill('850');
  const notes=dialog.getByTestId('care-notes');await notes.fill('לבדוק לחץ אוויר');await notes.focus();
  expect(await notes.evaluate(e=>getComputedStyle(e).direction)).toBe('rtl');expect(await notes.evaluate(e=>getComputedStyle(e).textAlign)).toBe('right');
  expect(await notes.evaluate(e=>{const style=getComputedStyle(e);return style.outlineStyle!=='none'||style.boxShadow!=='none';})).toBe(true);
  await dialog.getByRole('button',{name:'סגירה',exact:true}).click();await page.getByRole('button',{name:'הוספת טיפול',exact:true}).click();
  await expect(dialog.getByLabel('עלות כוללת',{exact:true})).toHaveValue('850');await expect(dialog.getByRole('heading',{name:'צמיגים · בלמים',exact:true})).toBeVisible();
});

test('every setting uses the same compact accessible switch and quick entry persists',async({page})=>{
  const {uid}=await signedInWithData(page,{vehicle:car});await page.goto('/settings');
  const checkSwitches=async(switches:Locator,count:number)=>{await expect(switches).toHaveCount(count);for(const sw of await switches.all()){
    const target=await sw.boundingBox();expect(target!.width).toBeCloseTo(52,3);expect(target!.height).toBeCloseTo(44,3);
    const track=await sw.locator('.tm-switch-track').boundingBox();expect(track!.width).toBeCloseTo(52,3);expect(track!.height).toBeCloseTo(32,3);
  }};
  await checkSwitches(page.getByRole('switch'),5);
  for(const label of ['טסט, ביטוח וטיפולים','שינוי במחיר הדלק','שיתוף סיכום דלק להשוואה','שיתוף סיכום עלות הרכב'])await expect(page.getByRole('switch',{name:label,exact:true})).toBeVisible();
  const quick=page.getByRole('switch',{name:'כפתור תדלקתי פותח מצלמה',exact:true});await quick.click();await expect(quick).toBeChecked();
  await expect(async()=>expect((await getDocument(`users/${uid}`))?.settings).toMatchObject({quickEntry:true})).toPass();await page.reload();await expect(quick).toBeChecked();
  await page.goto('/vehicle?tab=prefs');await checkSwitches(page.getByRole('switch'),1);await expect(page.getByRole('switch',{name:'התאמה אישית אוטומטית',exact:true})).toBeVisible();
  await page.goto('/settings');await page.getByTestId('account-notification-preferences').click();
  const preferences=page.getByRole('dialog',{name:'העדפות התראות',exact:true});
  await checkSwitches(preferences.getByRole('switch'),3);
  for(const label of ['תזכורות טיפול','עדכון מחיר דלק','תקלות שסימנתי כחשובות'])await expect(preferences.getByRole('switch',{name:label,exact:true})).toBeVisible();
  await expect(preferences.getByRole('switch',{name:/סנכרון/})).toHaveCount(0);
  await preferences.getByRole('button',{name:'סגירה',exact:true}).click();
  await page.goto('/notifications');await expect(page.getByRole('switch')).toHaveCount(0);await expect(page.getByRole('checkbox')).toHaveCount(0);
});
