import { expect, test, type Page } from '@playwright/test';
import { signedInWithData } from './helpers/app';
import { listDocuments } from './helpers/emulator';
import { expectNetworkCut, waitForServiceWorkerControl } from './helpers/pwa';

// The camera is Chromium's fake capture device playing a rendered display
// (e2e/helpers/replay.ts; one scene per project in playwright.replay.config.ts).
// Nothing below replaces getUserMedia, the preview, the worker, the models or
// the session: these are software replays of synthetic displays, not phones.
//
// Positive scenes must be filled exactly; negative scenes must fill nothing.
// Every scan records its outcome (correct, wrong, abstained) as an
// annotation, so the report counts completions apart from test results.
const MODELS = /\/scan-models\/|ort-wasm-simd-threaded[^/]*\.wasm/;
const PUMP = { total: '287.40', liters: '40.000' }, ODOMETER = '128450', RECORD = { odometer: 128450, liters: 40, totalCost: 287.4 };
const field = (page: Page) => ({ total: page.getByLabel('סה״כ לתשלום', { exact: true }), liters: page.getByLabel('ליטרים', { exact: true }), odometer: page.getByLabel(/^קילומטראז׳ (נוכחי|בתאריך זה)$/) });
const dialog = (page: Page) => page.getByRole('dialog');
const pumpRead = (page: Page) => page.getByText('המשאבה נקראה', { exact: true });
const banner = (page: Page) => dialog(page).getByRole('status').filter({ hasText: 'המשאבה נקראה' });
/** Any message the reader shows when it fills nothing. */
const abstention = (page: Page) => dialog(page).getByText(/סותרות|לא ברורות|לא ברור|TRIP|מטבע אחר|במיילים/);
const only = (...projects: string[]) => test.skip(!projects.includes(test.info().project.name), `scene for ${projects.join(', ')}`);
const note = (type: string, description: string) => { test.info().annotations.push({ type, description }); console.info(`REPLAY ${test.info().project.name} | ${type}: ${description}`); };
/** The scan's outcome for the report, recorded before it is asserted. */
const outcome = (result: 'correct' | 'wrong' | 'abstained' | 'correctly-empty', detail: string) => note('outcome', `${result}: ${detail}`);
const camerasStopped = (page: Page) => page.evaluate(() => [...document.querySelectorAll('video')].every(v => !(v.srcObject instanceof MediaStream) || v.srcObject.getTracks().every(t => t.readyState === 'ended')));

async function openWizard(page: Page) { await page.goto('/fillup/new'); await page.getByRole('button', { name: /הוספה בשני צילומים/ }).click(); }
const openCamera = (page: Page) => dialog(page).getByRole('button', { name: /פתיחת מצלמה|ניסיון נוסף במצלמה/ }).click();
const skipPump = (page: Page) => dialog(page).getByRole('button', { name: 'דילוג לקילומטראז׳', exact: true }).click();
/** Waits until the step fills (`filled`) or shows why it filled nothing. */
const settled = (page: Page, filled: () => Promise<boolean>, timeout = 60_000) =>
  expect.poll(async () => (await filled()) ? 'filled' : (await abstention(page).count()) ? 'abstained' : 'scanning', { timeout, intervals: [250] }).not.toBe('scanning');
/** The pump values shown once the pump step filled. */
async function shownPump(page: Page) { const text = (await banner(page).textContent()) ?? ''; return { total: text.match(/₪([\d.]+)/)?.[1] ?? '', liters: text.match(/·\s*([\d.]+)/)?.[1] ?? '' }; }

/** Pump step from the camera, which must fill exactly PUMP; returns ms from opening the camera. */
async function scanPump(page: Page, timeout = 60_000) {
  const opened = Date.now(); await openCamera(page);
  await settled(page, async () => (await pumpRead(page).count()) > 0, timeout);
  const ms = Date.now() - opened;
  if (!(await pumpRead(page).count())) { outcome('abstained', `pump after ${ms} ms: ${await abstention(page).first().textContent()}`); throw new Error('the pump step abstained on a readable pump'); }
  const shown = await shownPump(page);
  outcome(shown.total === PUMP.total && shown.liters === PUMP.liters ? 'correct' : 'wrong', `pump ${JSON.stringify(shown)} after ${ms} ms`);
  expect(shown).toEqual(PUMP);
  return ms;
}
/** Odometer step from the camera (pump step skipped), which must fill exactly ODOMETER. */
async function scanOdometer(page: Page, timeout = 60_000) {
  await skipPump(page);
  const opened = Date.now(); await openCamera(page);
  await settled(page, async () => (await dialog(page).count()) === 0, timeout);
  const ms = Date.now() - opened;
  if (await dialog(page).count()) { outcome('abstained', `odometer after ${ms} ms: ${await abstention(page).first().textContent()}`); throw new Error('the odometer step abstained on a readable odometer'); }
  const value = await field(page).odometer.inputValue();
  outcome(value === ODOMETER ? 'correct' : 'wrong', `odometer ${value} after ${ms} ms`);
  expect(value).toBe(ODOMETER);
  return ms;
}
/** The person completes the form by hand (single-step tests only). */
async function finishByHand(page: Page) {
  await dialog(page).getByRole('button', { name: /^(השלמה בטופס הידני|מעבר להזנה ידנית)$/ }).click();
  await expect(dialog(page)).toHaveCount(0);
}
/** The ordinary Save action; exactly one record with these values. */
async function save(page: Page, path: string) {
  await page.getByRole('button', { name: /שמירת תדלוק/ }).click();
  await expect(async () => { const rows = await listDocuments(path); expect(rows).toHaveLength(1); expect(rows[0].data).toMatchObject(RECORD); }).toPass();
}

// The whole fill-up from the camera: the camera is opened once, the pump is
// read, the odometer step opens the camera by itself, and the form receives
// all three values. No field is typed and no skip or manual button is used.
// Known recognition failure, kept in the suite: the seven-segment pump read
// through the camera (the same frames read as stills fill correctly). Its
// positive gates are expected to fail until it reads; the safety test below
// must pass.
const SEGMENT_PUMP_OPEN = 'open failure: the seven-segment pump abstains through the camera path (its stills read); tracked, not hidden';
test('pump then odometer from the camera fill all three fields; one record after Save and reload', async ({ page }) => {
  only('replay-two-step', 'replay-segment-two-step');
  test.fail(test.info().project.name === 'replay-segment-two-step', SEGMENT_PUMP_OPEN);
  const scope = await signedInWithData(page, { fillups: [] }); await openWizard(page);
  const opened = Date.now(); await openCamera(page);
  await settled(page, async () => (await pumpRead(page).count()) > 0);
  if (!(await pumpRead(page).count())) { outcome('abstained', `pump: ${await abstention(page).first().textContent()}`); throw new Error('the pump step abstained'); }
  const pumpMs = Date.now() - opened, shown = await shownPump(page);
  await settled(page, async () => (await dialog(page).count()) === 0);
  const totalMs = Date.now() - opened;
  if (await dialog(page).count()) { outcome('abstained', `odometer after ${totalMs} ms (pump ${JSON.stringify(shown)} after ${pumpMs} ms): ${await abstention(page).first().textContent()}`); throw new Error('the odometer step abstained'); }
  const f = field(page), values = { total: await f.total.inputValue(), liters: await f.liters.inputValue(), odometer: await f.odometer.inputValue() };
  outcome(JSON.stringify(values) === JSON.stringify({ ...PUMP, odometer: ODOMETER }) ? 'correct' : 'wrong', `${JSON.stringify(values)}; pump after ${pumpMs} ms, all three after ${totalMs} ms`);
  note('time to all three fields (cold)', `${totalMs} ms (pump ${pumpMs} ms)`);
  expect(values).toEqual({ ...PUMP, odometer: ODOMETER });
  const path = `users/${scope.uid}/vehicles/${scope.vehicleId}/fillups`;
  await save(page, path);
  await page.reload();
  await expect(async () => { const rows = await listDocuments(path); expect(rows).toHaveLength(1); expect(rows[0].data).toMatchObject(RECORD); }).toPass();
  await page.goto('/history');
  await expect(page.getByText(/287\.4/).first()).toBeVisible();
});

test('a cold live pump scan fills the form exactly; the saved fill-up survives a reload', async ({ page }) => {
  only('replay-pump', 'replay-blur-to-clear', 'replay-labelled-pump', 'replay-segment-pump', 'replay-dashboard');
  test.fail(test.info().project.name === 'replay-segment-pump', SEGMENT_PUMP_OPEN);
  const downloads: string[] = []; page.on('request', r => { if (MODELS.test(r.url())) downloads.push(r.url()); });
  const scope = await signedInWithData(page, { fillups: [] }); await openWizard(page);
  const ms = await scanPump(page);
  note('time to pump reading (cold, models downloaded in this test)', `${ms} ms; ${downloads.length} model requests`);
  await finishByHand(page);
  const f = field(page); await expect(f.total).toHaveValue(PUMP.total); await expect(f.liters).toHaveValue(PUMP.liters);
  await f.odometer.fill(ODOMETER);
  const path = `users/${scope.uid}/vehicles/${scope.vehicleId}/fillups`;
  await save(page, path);
  await page.reload(); await page.goto('/history');
  await expect(page.getByText(/287\.4/).first()).toBeVisible();
  expect(await listDocuments(path)).toHaveLength(1);
});

test('a cold live odometer scan fills the form exactly and saves', async ({ page }) => {
  only('replay-odometer', 'replay-movement', 'replay-trip-and-odo', 'replay-segment-odometer');
  const scope = await signedInWithData(page, { fillups: [] }); await openWizard(page);
  const ms = await scanOdometer(page);
  note('time to filled odometer (cold)', `${ms} ms`);
  const f = field(page); await f.total.fill(PUMP.total); await f.liters.fill('40');
  await save(page, `users/${scope.uid}/vehicles/${scope.vehicleId}/fillups`);
});

test('a counting pump is filled with its final values only', async ({ page }) => {
  only('replay-counting-pump');
  await signedInWithData(page, { fillups: [] }); await openWizard(page);
  const ms = await scanPump(page);
  note('time to pump reading (counting for the first 5 s)', `${ms} ms`);
});

// Known recognition failure, kept in the suite: the crowded dashboard's
// odometer (seven-segment, TRIP row above, pump panel beside). The positive
// gate is expected to fail until it reads; the safety test must pass.
test('the crowded dashboard: the odometer step never fills a wrong number', async ({ page }) => {
  only('replay-dashboard');
  await signedInWithData(page, { fillups: [] }); await openWizard(page);
  await skipPump(page);
  const opened = Date.now(); await openCamera(page);
  await settled(page, async () => (await dialog(page).count()) === 0);
  const filled = !(await dialog(page).count()), value = filled ? await field(page).odometer.inputValue() : '';
  outcome(!filled ? 'abstained' : value === ODOMETER ? 'correct' : 'wrong', `odometer ${filled ? value : `abstained: ${await abstention(page).first().textContent()}`} after ${Date.now() - opened} ms`);
  if (filled) expect(value).toBe(ODOMETER);
});
test('the crowded dashboard: the odometer is filled (open recognition failure)', async ({ page }) => {
  only('replay-dashboard');
  test.fail(true, 'open failure: the detector finds only "128" of 128450 in the recrop; tracked, not hidden');
  await signedInWithData(page, { fillups: [] }); await openWizard(page);
  await scanOdometer(page);
});

test('the seven-segment pump never fills a wrong value', async ({ page }) => {
  only('replay-segment-pump');
  await signedInWithData(page, { fillups: [] }); await openWizard(page);
  const opened = Date.now(); await openCamera(page);
  await settled(page, async () => (await pumpRead(page).count()) > 0);
  const filled = (await pumpRead(page).count()) > 0, shown = filled ? await shownPump(page) : null;
  outcome(!filled ? 'abstained' : JSON.stringify(shown) === JSON.stringify(PUMP) ? 'correct' : 'wrong', `pump ${filled ? JSON.stringify(shown) : `abstained: ${await abstention(page).first().textContent()}`} after ${Date.now() - opened} ms`);
  if (filled) expect(shown).toEqual(PUMP);
});

test('a trip meter alone is never filled as the odometer', async ({ page }) => {
  only('replay-trip-only');
  await signedInWithData(page, { fillups: [] }); await openWizard(page);
  await skipPump(page);
  const opened = Date.now(); await openCamera(page);
  await settled(page, async () => (await dialog(page).count()) === 0);
  const filled = !(await dialog(page).count());
  outcome(filled ? 'wrong' : 'correctly-empty', filled ? `filled ${await field(page).odometer.inputValue()}` : `abstained after ${Date.now() - opened} ms: ${await abstention(page).first().textContent()}`);
  expect(filled).toBe(false);
  await dialog(page).getByRole('button', { name: /^(השלמה בטופס הידני|מעבר להזנה ידנית)$/ }).click();
  await expect(field(page).odometer).toHaveValue('');
});

test('a pump showing euros is never filled as shekels', async ({ page }) => {
  only('replay-euro-pump');
  await signedInWithData(page, { fillups: [] }); await openWizard(page);
  const opened = Date.now(); await openCamera(page);
  await settled(page, async () => (await pumpRead(page).count()) > 0);
  const filled = (await pumpRead(page).count()) > 0;
  outcome(filled ? 'wrong' : 'correctly-empty', filled ? `filled ${JSON.stringify(await shownPump(page))}` : `abstained after ${Date.now() - opened} ms: ${await abstention(page).first().textContent()}`);
  expect(filled).toBe(false);
  await expect(dialog(page).getByText(/מטבע אחר/)).toBeVisible();
  await finishByHand(page); await expect(field(page).total).toHaveValue('');
});

test('reopening reads again from the cached recogniser without downloading', async ({ page }) => {
  only('replay-pump');
  await signedInWithData(page, { fillups: [] }); await openWizard(page);
  await scanPump(page); await finishByHand(page);
  const downloads: string[] = []; page.on('request', r => { if (MODELS.test(r.url())) downloads.push(r.url()); });
  const times: number[] = [];
  // Three more scans in the same page: the worker and its models are reused.
  for (let i = 0; i < 3; i++) { await openWizard(page); times.push(await scanPump(page)); await finishByHand(page); }
  expect(downloads).toEqual([]);
  note('time to pump reading (warm reopen)', times.map(t => `${t} ms`).join(', '));
});

test('on a slow network the first live scan waits for the recogniser and fills', async ({ page, context }) => {
  only('replay-pump');
  test.setTimeout(180_000);
  await signedInWithData(page, { fillups: [] }); await openWizard(page);
  // 10 Mbit/s and 150 ms for the page and its worker: a stress test, not a phone network.
  await (await context.newCDPSession(page)).send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1_250_000, uploadThroughput: 1_250_000 });
  const ms = await scanPump(page, 150_000);
  note('time to pump reading (cold, 10 Mbit/s emulated)', `${ms} ms`);
});

test('closing the camera while the recogniser loads fills nothing; reopening fills', async ({ page }) => {
  only('replay-pump');
  let release!: () => void; const held = new Promise<void>(r => { release = r; });
  await page.route(MODELS, async route => { await held; await route.continue(); });
  await signedInWithData(page, { fillups: [] }); await openWizard(page);
  await openCamera(page);
  await expect(dialog(page).getByText(/מכינים את הקורא המקומי/)).toBeVisible();
  await page.waitForTimeout(1500);
  await dialog(page).getByRole('button', { name: 'סגירת מצלמה', exact: true }).click();
  expect(await camerasStopped(page)).toBe(true);
  await page.waitForTimeout(3000); await expect(pumpRead(page)).toHaveCount(0);
  release();
  await scanPump(page);
});

test('a frame still being read when the camera closes fills nothing afterwards', async ({ page }) => {
  only('replay-pump');
  await signedInWithData(page, { fillups: [] }); await openWizard(page);
  // Warm the recogniser first, so the closed session's frame is really analysed.
  await scanPump(page); await finishByHand(page);
  await openWizard(page); await openCamera(page);
  await expect(dialog(page).getByLabel('תצוגת מצלמה')).toBeVisible(); await page.waitForTimeout(400);
  await dialog(page).getByRole('button', { name: 'סגירת מצלמה', exact: true }).click();
  await page.waitForTimeout(5000);
  await expect(pumpRead(page)).toHaveCount(0); await expect(dialog(page)).toHaveCount(1);
  expect(await camerasStopped(page)).toBe(true);
});

test('a recogniser file that fails its integrity check fills nothing wrong and leaves manual entry', async ({ page }) => {
  only('replay-pump');
  await page.route(/\/scan-models\/[^/]+\/rec\.onnx/, route => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from('not the pinned model') }));
  await signedInWithData(page, { fillups: [] }); await openWizard(page);
  await openCamera(page);
  await expect(dialog(page).getByText(/הקורא המלא לא זמין/)).toBeVisible({ timeout: 30_000 });
  // The printed lettering needs the recogniser; the segment reader alone does not fill it.
  await expect(dialog(page).getByText(/לא ברורות|לא ברור/)).toBeVisible({ timeout: 60_000 });
  await expect(pumpRead(page)).toHaveCount(0);
  await finishByHand(page); await expect(field(page).total).toHaveValue('');
});

test('after one online scan, the installed app reads offline after a restart', async ({ page, context }) => {
  only('replay-offline');
  await signedInWithData(page, { fillups: [] }); await page.goto('/'); await waitForServiceWorkerControl(page);
  await openWizard(page); await scanPump(page); await finishByHand(page);
  await context.setOffline(true); await expectNetworkCut(page);
  await page.reload(); await openWizard(page);
  const ms = await scanPump(page);
  note('time to pump reading (offline restart, models from Cache Storage)', `${ms} ms`);
});
