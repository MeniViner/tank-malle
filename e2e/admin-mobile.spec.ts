import { expect, test } from '@playwright/test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { ALICE, signIn, signOut, signedInWithData } from './helpers/app';
import { PROJECT_ID, getDocument } from './helpers/emulator';

async function admin(page: import('@playwright/test').Page) {
  const account = await signedInWithData(page, { regulatedPrice: 7.31 });
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  const app = initializeApp({projectId:PROJECT_ID}, `admin-mobile-${Date.now()}`);
  await getAuth(app).setCustomUserClaims(account.uid, {admin:true});
  await deleteApp(app);
  await signOut(page);
  await signIn(page, ALICE);
  await page.goto('/admin');
  await page.getByRole('button', {name:'נתונים',exact:true}).click();
  await expect(page.getByRole('button', {name:'משיכת מחיר מהדפדפן'})).toBeVisible();
  return account;
}

for (const width of [320, 360, 393]) {
  test(`admin prices fit ${width}px and browser pull runs only on click`, async ({page}, testInfo) => {
    await page.setViewportSize({width,height:780});
    const requests: string[] = [];
    await page.route('https://www.gov.il/**', route => { requests.push(route.request().url()); return route.abort('failed'); });
    await page.route('https://r.jina.ai/**', route => {requests.push(route.request().url()); return route.fulfill({body:'בשירות עצמי לא יעלה על 8.27 שקלים. באילת בשירות עצמי לא יעלה על 7.01 שקלים.',contentType:'text/plain'});});
    await admin(page);
    expect(requests).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', {name:'משיכת מחיר מהדפדפן'}).click();
    await expect(page.getByText('₪8.27', {exact:false}).first()).toBeVisible();
    expect(requests).toHaveLength(2);
    if (width === 360) await page.screenshot({path:testInfo.outputPath("admin-mobile-360.png"),fullPage:true});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Pulling is read-only: the stored current value remains intact.
    const config = await getDocument('appConfig/fuelPrices');
    expect(config?.current && (config.current as Record<string,unknown>).pricePerLiter).toBe(7.31);
  });
}

test('admin save survives backend-only outage and reload, then syncs to the fill-up form', async ({page}) => {
  const {uid} = await admin(page);
  const input = page.getByLabel('מחיר חדש לליטר · בנזין 95');
  await page.route('**/127.0.0.1:8080/**', route => route.abort('failed'));
  await input.fill('8.19');
  await input.locator('xpath=../..').getByRole('button',{name:'שמירה',exact:true}).click();
  await expect(page.getByText('נשמר במכשיר · ממתין לאישור השרת').first()).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'נתונים',exact:true}).click();
  await expect(input).toHaveValue('8.19');
  await expect(page.getByText('נשמר במכשיר · ממתין לאישור השרת').first()).toBeVisible();
  await page.unroute('**/127.0.0.1:8080/**');
  await expect(async () => {
    const config = await getDocument('appConfig/fuelPrices');
    const series = ((config?.byFuelType as Record<string,Record<string,Record<string,unknown>>> | undefined)?.['95']?.self);
    expect((series?.current as Record<string,unknown>)?.pricePerLiter).toBe(8.19);
  }).toPass({timeout:30000});
  await page.goto('/fillup/new');
  await expect(page.getByLabel('מחיר לליטר')).toHaveValue('8.19');
  expect(uid).toBeTruthy();
});

test('rejected admin save retains draft through reload and can be retried safely', async ({page}) => {
  const {installRules, DENY_ALL_RULES, restoreRules} = await import('./helpers/emulator');
  await admin(page);
  await installRules(DENY_ALL_RULES);
  try {
    const input = page.getByLabel('מחיר חדש לליטר · בנזין 95');
    await input.fill('8.11');
    await input.locator('xpath=../..').getByRole('button',{name:'שמירה',exact:true}).click();
    await expect(page.getByText('לא סונכרן · הקלט נשמר במכשיר')).toBeVisible();
    await page.reload();
    await page.getByRole('button',{name:'נתונים',exact:true}).click();
    await expect(input).toHaveValue('8.11');
    await expect(page.getByText('לא סונכרן · הקלט נשמר במכשיר')).toBeVisible();
    await restoreRules();
    await page.getByRole('button',{name:'ניסיון שמירה נוסף',exact:true}).click();
    await expect(page.getByText('המחיר מאושר בשרת').first()).toBeVisible();
    await expect(page.getByText('לא סונכרן · הקלט נשמר במכשיר')).toHaveCount(0);
    const config = await getDocument('appConfig/fuelPrices');
    expect((((config?.byFuelType as Record<string,Record<string,Record<string,unknown>>>)?.['95']?.self?.current) as Record<string,unknown>)?.pricePerLiter).toBe(8.11);
  } finally { await restoreRules(); }
});

test('small fill-up page and date sheet keep all controls within the viewport', async ({page}) => {
  await page.setViewportSize({width:360,height:740});
  await signedInWithData(page,{regulatedPrice:7.31});
  await page.goto('/fillup/new');
  await expect(page.getByLabel('ליטרים',{exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button',{name:/תאריך ושעה/}).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(740);
  await page.getByRole('button',{name:'אישור',exact:true}).click();
  await page.getByLabel(/^קילומטראז׳/).fill('101000');
  await page.getByLabel('ליטרים',{exact:true}).fill('40');
  await page.getByLabel('הערה',{exact:true}).fill('x'.repeat(501));
  await expect(page.getByLabel('הערה',{exact:true})).toHaveValue('x'.repeat(501));
  await expect(page.getByRole('button',{name:'שמירת תדלוק'})).toBeDisabled();
});

test('an ordinary connected client receives the admin price through stored configuration', async ({page,browser}) => {
  const {BOB,uidOf} = await import('./helpers/app');
  const {seedVehicle,setActiveVehicle} = await import('./helpers/emulator');
  await admin(page);
  const input = page.getByLabel('מחיר חדש לליטר · בנזין 95');
  await input.fill('8.17');
  await input.locator('xpath=../..').getByRole('button',{name:'שמירה',exact:true}).click();
  await expect(page.getByText('המחיר מאושר בשרת').first()).toBeVisible();
  await expect(async () => {
    const config = await getDocument('appConfig/fuelPrices');
    expect((((config?.byFuelType as Record<string,Record<string,Record<string,unknown>>>)?.['95']?.self?.current) as Record<string,unknown>)?.pricePerLiter).toBe(8.17);
  }).toPass();
  const context = await browser.newContext({baseURL:'http://127.0.0.1:5273',locale:'he-IL',timezoneId:'Asia/Jerusalem'});
  try {
    const ordinary = await context.newPage();
    await signIn(ordinary, BOB);
    const uid = await uidOf(BOB);
    await seedVehicle(uid,'v1',{make:'מאזדה',model:'3'});
    await setActiveVehicle(uid,'v1');
    await ordinary.goto('/fillup/new');
    await expect(ordinary.getByLabel('מחיר לליטר')).toHaveValue('8.17');
    await expect(ordinary.getByText(/מחיר שהוזן ידנית/)).toBeVisible();
  } finally {await context.close();}
});
