import { expect, test } from '@playwright/test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { ALICE, signIn, signOut, signedInWithData } from './helpers/app';
import { PROJECT_ID, resetEmulators, setDocument } from './helpers/emulator';

// These UI tests stub registry responses. Keep the worker from handling those
// requests before Playwright can route them; dedicated PWA tests cover caching.
test.use({ serviceWorkers: 'block' });

test('entry previews, editable plate and registry confirmation remain usable at 320px', async ({page}) => {
  await resetEmulators();
  await page.setViewportSize({width:320,height:740});
  await page.goto('/');
  await expect(page.getByTestId('onboarding-slide')).toHaveAttribute('data-slide','1');
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-slide')).toHaveAttribute('data-slide','2');
  await expect(page.getByTestId('onboarding-art')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-slide')).toHaveAttribute('data-slide','3');
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('signin-consent')).not.toBeChecked();
  await signIn(page, ALICE);
  let registryRequests = 0;
  await page.route('**/data.gov.il/**', route => { registryRequests += 1; return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,result:{records:[{mispar_rechev:12345678,tozeret_nm:'מאזדה יפן',kinuy_mishari:'3',shnat_yitzur:2018,sug_delek_nm:'בנזין'}]}})}); });
  const plate = page.getByRole('textbox',{name:'מספר רכב'});
  await plate.fill('123-45-678');
  await plate.press('Enter');
  await expect(page.getByTestId('wizard-make-value')).toHaveText('מאזדה');
  expect(registryRequests).toBeGreaterThan(0);
  await expect(page.getByTestId('wizard-make')).toHaveCount(0);
  await page.getByTestId('wizard-correct').click();
  await page.getByLabel('דגם',{exact:true}).fill('3 Active');
  await page.getByTestId('wizard-confirm-next').click();
  await expect(page.getByLabel('איך קוראים לרכב?',{exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('imported layout, real values and logo assets fit phone, tablet and desktop in both themes', async ({page}) => {
  test.setTimeout(120_000);
  await signedInWithData(page,{regulatedPrice:7.77,vehicle:{make:'יונדאי',model:'i20',tankLiters:45,tankLitersSource:'user'},fillups:[
    {id:'a',date:new Date('2026-10-01T09:00:00Z'),odometer:100000,liters:40,stationName:'פז תל אביב'},
    {id:'b',date:new Date('2026-10-08T09:00:00Z'),odometer:100500,liters:40,stationName:'סונול רעננה'},
  ]});
  for (const theme of ['בהיר','כהה']) {
    await page.goto('/settings');
    await page.getByRole('button',{name:/^מראה/}).click();
    await page.getByRole('radio',{name:theme,exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'סגירה',exact:true}).click();
    for (const width of [320,360,390,430,600,820,1024,1366,1440,1920]) {
      await page.setViewportSize({width,height:844});
      for (const path of ['/','/history','/stats','/fillup/new','/settings']) {
        await page.goto(path);
        await expect(page.locator('main')).toBeVisible();
        // Assert populated surfaces, so a narrow loading skeleton cannot pass.
        if (path === '/') await expect(page.getByTestId('consumption-chart')).toBeVisible();
        if (path === '/history') await expect(page.getByRole('region', {name:'סיכום היומן המסונן'})).toContainText('₪560');
        if (path === '/stats') {
          await page.getByTestId('insights-tab-spend').click();
          await expect(page.getByTestId('running-total')).toContainText('₪560');
        }
        if (path === '/fillup/new') await expect(page.getByLabel('מחיר לליטר', {exact:true})).toHaveValue('7.77');
        if (path === '/settings') await expect(page.getByTestId('account-discount')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width} ${path}`).toBe(true);
      }
    }
  }
  await page.goto('/history');
  await expect(page.getByRole('region', {name:'סיכום היומן המסונן'})).toContainText('₪560');
  await page.goto('/');
  await expect(page.getByTestId('consumption-chart').getByRole('img')).toHaveAccessibleName(/12.5 קמ״ל/);
  await page.getByTestId("tank-hero").click();
  await expect(page.getByTestId("tank-gauge")).toBeVisible();
  await page.keyboard.press("Escape");
  const logo = page.getByTestId('recent-fillups-timeline').locator('img').first();
  await expect(logo).toHaveAttribute('src','/brands/sonol.svg');
  expect(await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test('sheet choices support keyboard navigation and feedback preserves the chosen category', async ({page}) => {
  await signedInWithData(page);
  await page.goto('/settings');
  await page.getByRole('button',{name:/^יחידת צריכה/}).click();
  await page.getByRole('radio',{name:'ק״מ לליטר',exact:true}).press('ArrowDown');
  await expect(page.getByRole('radio',{name:'ליטר ל-100 ק״מ',exact:true})).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/feedback');
  await page.getByRole('radio',{name:'רעיון',exact:true}).press('ArrowLeft');
  await expect(page.getByRole('radio',{name:'תקלה',exact:true})).toBeChecked();
  await expect(page.getByPlaceholder('מה נשבר, ואיפה בדיוק?')).toBeVisible();
});

test('admin feedback filters and detail sheet show the full message at phone width', async ({page}) => {
  await page.setViewportSize({width:320,height:740});
  const {uid} = await signedInWithData(page);
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${process.env.CARE_AUTH_PORT??'9099'}`;
  const app = initializeApp({projectId:PROJECT_ID},`design-${Date.now()}`);
  await getAuth(app).setCustomUserClaims(uid,{admin:true});
  await deleteApp(app);
  const long = 'בדיקה מקומית. '.repeat(30) + 'סוף הודעה';
  await setDocument('feedback/design-bug',{uid,displayName:'בדיקת תקלה',message:long,sentiment:'bug',createdAt:new Date()});
  await setDocument('feedback/design-idea',{uid,displayName:'בדיקת רעיון',message:'רעיון מקומי',sentiment:'idea',createdAt:new Date()});
  await signOut(page); await signIn(page,ALICE);
  await page.goto('/admin');
  await page.getByRole('button',{name:'משוב',exact:true}).click();
  await page.getByRole('radio',{name:'תקלות',exact:true}).click();
  await expect(page.getByText('בדיקת רעיון',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/בדיקת תקלה/}).click();
  await expect(page.getByRole('dialog').getByText(long,{exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
