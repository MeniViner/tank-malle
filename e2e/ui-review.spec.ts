import {test,expect} from '@playwright/test';
import {signedInWithData} from './helpers/app';
import {getDocument,setDocument} from './helpers/emulator';
const DAY=86400000;
const car={make:'רכב',model:'בדיקת ממשק',tankLiters:50,tankLitersSource:'user' as const,declaredKmPerLiter:15};
const records=(n:number)=>Array.from({length:n},(_,i)=>({id:`ui-${i}`,date:new Date(Date.now()-(n-i)*7*DAY),odometer:170000+i*450,liters:30,pricePerLiter:7.77}));

test('a recent gauge with old mileage has one odometer action after every source loads',async({page})=>{
  const {uid,vehicleId}=await signedInWithData(page,{vehicle:car,fillups:[{id:'old-mileage',date:new Date(Date.now()-28*DAY),odometer:100000,liters:40,pricePerLiter:7,totalCost:280}]});
  await setDocument(`users/${uid}/vehicles/${vehicleId}/observations/gauge`,{observedAt:new Date(Date.now()-60000),recordedAt:new Date(),kind:'level',level:0.5,confirmed:true,levelSource:'direct-gauge'});
  await page.goto('/');const overview=page.getByRole('region',{name:'מצב הרכב'});
  await expect(overview).not.toContainText('טוענים');await expect(overview).not.toContainText('חלקי');
  const tank=page.locator('#my-tank');await expect(tank).toBeVisible();
  await expect(tank.getByRole('button',{name:'עדכון קילומטראז׳',exact:true})).toHaveCount(1);
  await tank.getByRole('button',{name:'עדכון קילומטראז׳',exact:true}).click();
  await expect(page.getByRole('dialog').getByLabel('קילומטראז׳ נוכחי')).toBeVisible();
});

test('Home has one compact tank, useful mileage and honest purchase habits',async({page},info)=>{
  const {uid,vehicleId}=await signedInWithData(page,{vehicle:car,fillups:records(2)});
  const base=`users/${uid}/vehicles/${vehicleId}`;
  await setDocument(base+'/maintenancePlans/one',{schemaVersion:1,version:1,title:'החלפת שמן',job:'oil',dueDay:'2026-01-01',dueOdometer:null,intervalMonths:null,intervalKm:null,basis:'manual',source:'owner',notes:'',active:true});
  await page.goto('/');
  const tank=page.locator('#my-tank');await expect(tank).toBeVisible();
  await expect(page.getByRole('region',{name:'מצב הרכב'})).toContainText('170,450');
  await expect(page.getByRole('region',{name:'מצב הרכב'})).toContainText('1 לטיפול');
  await expect(page.getByRole('button',{name:'תכנון נסיעה',exact:true})).toHaveCount(0);
  await expect(tank.getByText('כמה דלק נשאר?',{exact:true})).toHaveCount(0);
  await expect(page.getByTestId('mileage-precision')).toHaveCount(0);
  expect((await tank.boundingBox())!.height).toBeLessThan(380);
  await tank.locator('summary').click();
  await expect(tank.getByText('בדרך כלל מתדלקים כל',{exact:true})).toBeVisible();
  await expect(tank.getByText('תדלוק טיפוסי',{exact:true})).toBeVisible();
  await expect(tank.getByText('עדיין לומדים את התדירות')).toBeVisible();
  await page.screenshot({path:info.outputPath('home-review.png')});
  await page.getByRole('button',{name:'איך המיכל מחושב',exact:true}).click();
  await expect(page.getByRole('button',{name:'יש לי נסיעה מתוכננת',exact:true})).toBeVisible();
});

test('both amount edits recalculate immediately and all tank details share one collapsed section',async({page},info)=>{
  await signedInWithData(page,{vehicle:car,regulatedPrice:7.77});await page.goto('/fillup/new');
  const liters=page.getByLabel('ליטרים',{exact:true}),total=page.getByLabel('סה״כ לתשלום',{exact:true}),price=page.getByLabel('מחיר לליטר',{exact:true});
  await expect(price).toHaveValue('7.77');
  await liters.fill('40');await expect(total).toHaveValue('310.80');
  await total.fill('155.4');await expect(liters).toHaveValue('20');
  await liters.fill('30');await expect(total).toHaveValue('233.10');
  await price.fill('7.5');await expect(total).toHaveValue('225.00');
  await total.fill('300');await expect(liters).toHaveValue('40');
  await total.fill('');await expect(liters).toHaveValue('');
  await price.focus();expect(await price.evaluate(e=>getComputedStyle(e).outlineStyle)).toBe('none');
  expect(await price.evaluate(e=>getComputedStyle(e).boxShadow)).not.toBe('none');
  const full=page.getByRole('button',{name:'מילאתי מיכל מלא',exact:true});await expect(full).toHaveCount(0);
  await page.getByRole('button',{name:'פתיחת מצב המיכל',exact:true}).click();
  await full.click();await expect(page.getByRole('slider',{name:'כמה דלק נשאר לפני התדלוק'})).toBeVisible();
  await expect(page.getByText(/בלי בחירה/)).toHaveCount(0);
  await page.getByRole('button',{name:'סגירת מצב המיכל',exact:true}).click();await expect(full).toHaveCount(0);
  await expect(page.getByText('מלא', {exact:false}).first()).toBeVisible();
  await expect(page.getByText(/מתחילים תקופת מדידה חדשה/)).toBeVisible();
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
  const chart=page.getByRole('heading',{name:'קילומטראז׳ מצטבר',exact:true}).locator('..').locator('..');
  await expect(chart.locator('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value').first()).toHaveText('0');
  await expect(chart).toContainText('הציר מתחיל ב־0');
  for(const strong of await page.locator('.v-statpair strong').all())expect(await strong.evaluate(e=>getComputedStyle(e).textAlign)).toBe('right');
  await expect(page.getByText(/3 מקטעים · 4 תדלוקים/)).toBeVisible();
});

test('care is compact, has no duplicate mileage action and preserves several jobs in a draft',async({page},info)=>{
  await signedInWithData(page,{vehicle:car});await page.goto('/vehicle');
  await expect(page.getByRole('button',{name:'עדכון ק״מ',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'עדכון',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'הוספת טיפול',exact:true}).click();const dialog=page.getByRole('dialog');
  const choices=dialog.locator('.care-choice');await expect(choices).toHaveCount(7);
  for(const item of await choices.all())expect((await item.boundingBox())!.height).toBeLessThanOrEqual(56);
  await dialog.getByRole('button',{name:'צמיגים',exact:true}).click();await dialog.getByRole('button',{name:'בלמים',exact:true}).click();
  await page.screenshot({path:info.outputPath('care-review.png')});
  await dialog.getByRole('button',{name:'המשך לפרטי הטיפול'}).click();await dialog.getByLabel('עלות כוללת',{exact:true}).fill('850');
  await dialog.getByText('עוד פרטים',{exact:true}).click();const notes=dialog.getByLabel('הערות',{exact:true});await notes.fill('לבדוק לחץ אוויר');await notes.focus();
  expect(await notes.evaluate(e=>getComputedStyle(e).direction)).toBe('rtl');expect(await notes.evaluate(e=>getComputedStyle(e).textAlign)).toBe('right');
  expect(await notes.evaluate(e=>getComputedStyle(e).outlineStyle)).toBe('none');expect(await notes.evaluate(e=>getComputedStyle(e).boxShadow)).not.toBe('none');
  await dialog.getByRole('button',{name:'סגירה',exact:true}).click();await page.getByRole('button',{name:'הוספת טיפול',exact:true}).click();
  await expect(dialog.getByLabel('עלות כוללת',{exact:true})).toHaveValue('850');await expect(dialog.getByLabel('שינוי סוג הרשומה')).toContainText('צמיגים · בלמים');
});

test('every setting uses the same compact accessible switch and quick entry persists',async({page})=>{
  const {uid}=await signedInWithData(page,{vehicle:car});await page.goto('/settings');
  const switches=page.getByRole('switch');await expect(switches).toHaveCount(3);
  for(const sw of await switches.all()){
    const target=await sw.boundingBox();expect(target!.width).toBe(40);expect(target!.height).toBe(40);
    const track=await sw.locator('.tm-switch-track').boundingBox();expect(track!.width).toBe(34);expect(track!.height).toBe(20);
  }
  const quick=page.getByRole('switch',{name:'פתח תמיד תדלוק מהיר',exact:true});await quick.click();await expect(quick).toBeChecked();
  await expect(async()=>expect((await getDocument(`users/${uid}`))?.settings).toMatchObject({quickEntry:true})).toPass();await page.reload();await expect(quick).toBeChecked();
  await page.goto('/notifications');await expect(page.getByRole('switch')).toHaveCount(2);await expect(page.getByRole('checkbox')).toHaveCount(0);
});
