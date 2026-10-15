import { expect, test } from '@playwright/test';
import { signedInWithData } from './helpers/app';
import { getDocument, setDocument } from './helpers/emulator';
test.use({ serviceWorkers: 'block' });

test('installed app signs in through a popup, persists across reload and a new window', async ({page, context}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await signedInWithData(page, { vehicle: { make: 'מבחן', model: 'ספארי', tankLiters: 45, tankLitersSource: 'user', declaredKmPerLiter: 15 } });
  await page.reload();
  await expect(page.getByText('מבחן ספארי', {exact:false}).first()).toBeVisible();
  await expect(page.getByRole('button', {name:/Google/})).toHaveCount(0);
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.getByText('מבחן ספארי', {exact:false}).first()).toBeVisible();
  await expect(reopened.getByRole('button', {name:/Google/})).toHaveCount(0);
  await reopened.close();
});

test('missing specs are filled without Functions, with source labels and preserved user values', async ({page}) => {
  await page.route('https://data.gov.il/**', route => route.fulfill({json:{result:{records:[{
    tozeret_cd:502, degem_cd:81, tozeret_nm:'יונדאי הודו', tozar:'יונדאי', shnat_yitzur:2012,
    kamut_CO2:146, nefah_manoa:1396, merkav:"הצ'בק", kinuy_mishari:'I20',
  }]}}}));
  const {uid, vehicleId} = await signedInWithData(page, { vehicle: { make:'יונדאי', model:'I20 INSPIRE', year:2012 } });
  const path = `users/${uid}/vehicles/${vehicleId}`;
  await expect.poll(async () => (await getDocument(path))?.tankLiters).toBe(45);
  await expect.poll(async () => (await getDocument(path))?.declaredSource).toBe('co2-estimate');
  expect((await getDocument(path))?.tankLitersSource).toBe('trusted');
  await setDocument(path, { tankLiters:47, tankLitersSource:'user', declaredKmPerLiter:14.8, declaredSource:'user' });
  await page.reload();
  await expect(page.getByText('המיכל שלי', {exact:true})).toBeVisible();
  expect((await getDocument(path))?.tankLiters).toBe(47);
  expect((await getDocument(path))?.declaredKmPerLiter).toBe(14.8);
});

test('history learning and rounded money fit a small mobile screen', async ({page}) => {
  await page.setViewportSize({width:360,height:780});
  const today = Date.now();
  await signedInWithData(page, { vehicle:{make:'מבחן',model:'למידה',tankLiters:50,tankLitersSource:'user',declaredKmPerLiter:15}, fillups:[0,7,14,21].map((days,i)=>({
    id:`history-${i}`,date:new Date(today-(21-days)*86400000),odometer:10000+i*450,liters:30+i,pricePerLiter:7.77,totalCost:233.1+i*7.77,
  })) });
  await expect(page.getByLabel('מה למדנו מהשימוש שלך')).toContainText('בדרך כלל מתדלקים כל');
  await expect(page.getByRole('button',{name:'תכנון נסיעה',exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/history');
  await expect(page.getByText('₪233',{exact:true}).first()).toBeVisible();
  await expect(page.getByText('₪233.10',{exact:true})).toHaveCount(0);
});
