import { expect, test } from '@playwright/test';
import { signedInWithData } from './helpers/app';
import { getDocument, setDocument } from './helpers/emulator';
import { outboxCount } from './helpers/pwa';
import type { Outbox } from '../src/lib/outbox';
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
  await setDocument(path, { ...(await getDocument(path)), tankLiters:47, tankLitersSource:'user', declaredKmPerLiter:14.8, declaredSource:'user' });
  await page.reload();
  await expect(page.getByTestId("home-first-fillup")).toBeVisible();
  expect((await getDocument(path))?.tankLiters).toBe(47);
  expect((await getDocument(path))?.declaredKmPerLiter).toBe(14.8);
});

test('a same-identity listener refresh cannot cancel and acknowledge a gated missing-spec proposal', async ({ page }) => {
  await page.route('https://data.gov.il/**', route => route.fulfill({ json: { result: { records: [{
    tozeret_cd: 502, degem_cd: 81, tozeret_nm: 'יונדאי הודו', tozar: 'יונדאי', shnat_yitzur: 2012,
    kamut_CO2: 146, nefah_manoa: 1396, merkav: "הצ'בק", kinuy_mishari: 'I20',
  }] } } }));
  const { uid, vehicleId } = await signedInWithData(page, { vehicle: {
    make: 'יונדאי', model: 'I20 INSPIRE', year: 2012,
    tankLiters: 50, tankLitersSource: 'trusted', declaredKmPerLiter: 15, declaredSource: 'exact-year',
  } });
  const path = `users/${uid}/vehicles/${vehicleId}`;
  const original = (await getDocument(path))!;
  let held = false;
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const batchGet = /\/documents:batchGet(?:\?|$)/;
  await page.route(batchGet, async route => {
    const url = new URL(route.request().url());
    if (!held && url.hostname === '127.0.0.1' && url.pathname.includes('/projects/demo-tankmaleh/')
      && route.request().postData()?.includes(path)) {
      held = true;
      await gate;
    }
    await route.continue();
  });
  try {
    const missing = { ...original, tankLiters: null, tankLitersSource: null, declaredKmPerLiter: null, declaredSource: null };
    await setDocument(path, missing);
    await expect.poll(() => held).toBe(true);
    await setDocument(path, { ...missing, nickname: 'אותו רכב עם תווית חדשה' });
    await expect(page.getByTestId('home-first-fillup')).toContainText('אותו רכב עם תווית חדשה');
    expect((await getDocument(path))?.tankLiters).toBeNull();
    release();
    await expect.poll(async () => (await getDocument(path))?.tankLiters).toBe(45);
    expect((await getDocument(path))?.tankLitersSource).toBe('trusted');
    await expect.poll(async () => (await getDocument(path))?.declaredSource).toBe('co2-estimate');
    await expect.poll(() => outboxCount(page, uid)).toBe(0);
  } finally {
    release();
    await page.unroute(batchGet);
  }
});

test('delayed automatic specs cannot overwrite another device’s manual values after offline recovery and reload', async ({ page, context }) => {
  let releaseLookup = () => {};
  const lookupGate = new Promise<void>(resolve => { releaseLookup = resolve; });
  let requested = 0;
  await page.route('https://data.gov.il/**', async route => {
    requested += 1;
    await lookupGate;
    await route.fulfill({ json: { result: { records: [{
      tozeret_cd: 502, degem_cd: 81, tozeret_nm: 'יונדאי הודו', tozar: 'יונדאי', shnat_yitzur: 2012,
      kamut_CO2: 146, nefah_manoa: 1396, merkav: "הצ'בק", kinuy_mishari: 'I20',
    }] } } });
  });
  try {
    const { uid, vehicleId } = await signedInWithData(page, {
      vehicle: { make: 'יונדאי', model: 'I20 INSPIRE', year: 2012 },
    });
    const path = `users/${uid}/vehicles/${vehicleId}`;
    await expect.poll(() => requested).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'עדכון המחוון', exact: true }).click();
    const enriching = page.getByText('משלים מפרט רכב…', { exact: true });
    await expect(enriching).toBeVisible();
    expect((await getDocument(path))?.tankLiters ?? null).toBeNull();

    // The browser retains the incomplete vehicle while the other device saves
    // authoritative values. Releasing the lookup must not author a stale edit.
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    const manual = { tankLiters: 47, tankLitersSource: 'user', declaredKmPerLiter: 14.8, declaredSource: 'user' };
    await setDocument(path, { ...(await getDocument(path)), ...manual });
    releaseLookup();
    await expect(enriching).toHaveCount(0);

    await context.setOffline(false);
    await page.reload();
    await expect(page.getByTestId('home-first-fillup')).toBeVisible();
    await expect.poll(() => outboxCount(page, uid)).toBe(0);
    expect(await getDocument(path)).toMatchObject(manual);
    // A second mount also cannot recover/retry a generated proposal over them.
    await page.reload();
    await expect(page.getByTestId('home-first-fillup')).toBeVisible();
    await expect.poll(() => outboxCount(page, uid)).toBe(0);
    expect(await getDocument(path)).toMatchObject(manual);
  } finally {
    releaseLookup();
    await context.setOffline(false);
  }
});

test('recovered automatic specs keep their original base through Unsynced retry and conflict overwrite', async ({ page, context }) => {
  const manual = { tankLiters: 47, tankLitersSource: 'user' as const, declaredKmPerLiter: 14.8, declaredSource: 'user' as const };
  const { uid, vehicleId } = await signedInWithData(page, {
    vehicle: { make: 'יונדאי', model: 'I20 INSPIRE', year: 2012, ...manual },
  });
  await page.goto('/settings/unsynced');
  const path = `users/${uid}/vehicles/${vehicleId}`;
  const initial = await getDocument(path);
  if (!initial) throw new Error('Missing vehicle fixture');
  const createdAt = new Date(Number(initial.createdAt));
  // Capture the actual original document before another device fills its specs.
  await setDocument(path, { ...initial, createdAt, tankLiters: null, tankLitersSource: null, declaredKmPerLiter: null, declaredSource: null });
  const beforeImage = await getDocument(path);
  await setDocument(path, { ...initial, createdAt, ...manual });
  const serverImage = await getDocument(path);
  expect(serverImage).toMatchObject(manual);
  const payload = {
    tankLiters: 45, tankLitersSource: 'trusted',
    tankSourceUrl: 'https://news.cision.com/hyundai-motor-company/r/hyundai-motor-unveils-all-new-i20-at-the-geneva-motor-show,c9228003',
    declaredKmPerLiter: 16.4, declaredSource: 'co2-estimate',
    specSourceUrl: 'https://data.gov.il/dataset/degamim-rechev-wltp',
  };
  const listenPattern = '**/google.firestore.v1.Firestore/Listen/**';
  // Retain the recovered journal row until its real UI action is clicked.
  // Transactions still read/commit through the unblocked REST endpoints.
  await page.route(listenPattern, route => route.abort('internetdisconnected'));
  try {
    for (const status of ['failed', 'conflict'] as const) {
      await context.setOffline(true);
      const opId = await page.evaluate(async ({ uid, vehicleId, path, payload, beforeImage, serverImage, status }) => {
        const hook = (window as unknown as { __tankMalleTest: { openOutbox: (uid: string) => Promise<Outbox> } }).__tankMalleTest;
        const outbox = await hook.openOutbox(uid);
        const op = await outbox.enqueue({ kind: 'vehicle.update', opType: 'update', vehicleId, path, payload, beforeImage });
        if (status === 'failed') await outbox.fail(op.opId, op.version, { code: 'unconfirmed', message: 'הצעת מפרט ששוחזרה', at: Date.now() });
        else await outbox.markConflict(op.opId, op.version, serverImage);
        return op.opId;
      }, { uid, vehicleId, path, payload, beforeImage, serverImage, status });
      await context.setOffline(false);
      await page.reload();
      const row = page.locator(`[data-outbox-op="${opId}"]`);
      await expect(row).toHaveAttribute('data-outbox-status', status);
      const recovered = await page.evaluate(async ({ uid, opId }) => {
        const hook = (window as unknown as { __tankMalleTest: { openOutbox: (uid: string) => Promise<Outbox> } }).__tankMalleTest;
        return (await hook.openOutbox(uid)).get(opId);
      }, { uid, opId });
      expect(recovered?.beforeImage).toEqual(beforeImage);
      expect(recovered?.payload).toEqual(payload);
      await row.getByRole('button', { name: status === 'failed' ? 'ניסיון חוזר' : 'לדרוס עם הגרסה שלי', exact: true }).click();
      await expect(row).toHaveCount(0);
      await expect.poll(() => outboxCount(page, uid)).toBe(0);
      expect(await getDocument(path)).toEqual(serverImage);
    }
  } finally {
    await context.setOffline(false);
    await page.unroute(listenPattern);
  }
});

test('history learning and whole-shekel displays fit a small mobile screen', async ({page}) => {
  await page.setViewportSize({width:360,height:780});
  const today = Date.now();
  await signedInWithData(page, { vehicle:{make:'מבחן',model:'למידה',tankLiters:50,tankLitersSource:'user',declaredKmPerLiter:15}, fillups:[0,7,14,21].map((days,i)=>({
    id:`history-${i}`,date:new Date(today-(21-days)*86400000),odometer:10000+i*450,liters:30+i,pricePerLiter:7.77,totalCost:233.1+i*7.77,
  })) });
  await expect(page.getByTestId('home-km-day')).not.toContainText('—');
  await expect(page.getByTestId('consumption-chart')).toBeVisible();
  await expect(page.getByRole('button',{name:'תכנון נסיעה',exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByTestId('tank-hero').click();
  await page.getByRole('slider',{name:'כמה דלק יש עכשיו במיכל',exact:true}).press('End');
  await page.getByTestId('tank-save-gauge').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('tank-hero').click();
  await page.getByTestId('tank-open-trip').click();
  await page.getByLabel('מרחק צפוי',{exact:true}).fill('600');
  await page.getByRole('radio',{name:'היום',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'שמירה',exact:true}).click();
  await expect(page.getByTestId('tank-recommended')).toContainText('כדאי לתדלק לפני הנסיעה המתוכננת');
  await page.goto('/history');
  await expect(page.getByText('233\u202F₪',{exact:true}).first()).toBeVisible();
  await expect(page.locator('.ledger-row[data-collection=fillups]').filter({hasText:'233\u202F₪'})).toHaveCount(1);
});
