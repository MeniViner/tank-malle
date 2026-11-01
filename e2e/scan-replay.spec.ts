import { expect, test, type Page } from '@playwright/test';
import { signedInWithData } from './helpers/app';
import { listDocuments } from './helpers/emulator';
import { expectNetworkCut, waitForServiceWorkerControl } from './helpers/pwa';

// The camera is Chromium's fake capture device playing a rendered display
// (e2e/helpers/replay.ts; one scene per project in playwright.replay.config.ts).
// Nothing below replaces getUserMedia, the preview, the worker, the models or
// the session: these are software replays of synthetic displays, not phones.
const MODELS = /\/scan-models\/|ort-wasm-simd-threaded[^/]*\.wasm/;
const field = (page: Page) => ({ total: page.getByLabel('סה״כ לתשלום', { exact: true }), liters: page.getByLabel('ליטרים', { exact: true }), odometer: page.getByLabel(/^קילומטראז׳ (נוכחי|בתאריך זה)$/) });
const dialog = (page: Page) => page.getByRole('dialog');
const pumpRead = (page: Page) => page.getByText('המשאבה נקראה', { exact: true });
const only = (...projects: string[]) => test.skip(!projects.includes(test.info().project.name), `scene for ${projects.join(', ')}`);
const note = (type: string, description: string) => { test.info().annotations.push({ type, description }); console.info(`REPLAY ${test.info().project.name} | ${type}: ${description}`); };
const camerasStopped = (page: Page) => page.evaluate(() => [...document.querySelectorAll('video')].every(v => !(v.srcObject instanceof MediaStream) || v.srcObject.getTracks().every(t => t.readyState === 'ended')));

async function openWizard(page: Page) { await page.goto('/fillup/new'); await page.getByRole('button', { name: /הוספה בשני צילומים/ }).click(); }
const openCamera = (page: Page) => dialog(page).getByRole('button', { name: /פתיחת מצלמה|ניסיון נוסף במצלמה/ }).click();
/** Pump step from the camera; returns ms from opening the camera to the reading. */
async function scanPump(page: Page, timeout = 60_000) {
  const opened = Date.now(); await openCamera(page);
  await expect(pumpRead(page)).toBeVisible({ timeout });
  return Date.now() - opened;
}
/** Odometer step from the camera (pump step skipped); returns ms to the filled form. */
async function scanOdometer(page: Page, timeout = 60_000) {
  await dialog(page).getByRole('button', { name: 'דילוג לקילומטראז׳', exact: true }).click();
  const opened = Date.now(); await openCamera(page);
  await expect(dialog(page)).toHaveCount(0, { timeout });
  return Date.now() - opened;
}
/** The person completes the form by hand (after the pump step, or instead of it). */
async function finishByHand(page: Page) {
  await dialog(page).getByRole('button', { name: /^(השלמה בטופס הידני|מעבר להזנה ידנית)$/ }).click();
  await expect(dialog(page)).toHaveCount(0);
}
/** 'filled' when the scan closed with values, 'abstained' when it showed why it filled nothing. */
const outcome = (abstained: ReturnType<Page['getByText']>, filled: () => Promise<boolean>) =>
  expect.poll(async () => (await filled()) ? 'filled' : (await abstained.count()) ? 'abstained' : 'scanning', { timeout: 60_000, intervals: [500] }).not.toBe('scanning');
async function save(page: Page, path: string, expected: Record<string, number>) {
  await page.getByRole('button', { name: /שמירת תדלוק/ }).click();
  await expect(async () => { const rows = await listDocuments(path); expect(rows).toHaveLength(1); expect(rows[0].data).toMatchObject(expected); }).toPass();
}

test('a cold live pump scan fills the form; the saved fill-up survives a reload', async ({ page }) => {
  only('replay-pump', 'replay-blur-to-clear');
  const downloads: string[] = []; page.on('request', r => { if (MODELS.test(r.url())) downloads.push(r.url()); });
  const scope = await signedInWithData(page, { fillups: [] }); await openWizard(page);
  const ms = await scanPump(page);
  note('time to pump reading (cold, models downloaded in this test)', `${ms} ms; ${downloads.length} model requests`);
  await finishByHand(page);
  const f = field(page); await expect(f.total).toHaveValue('287.40'); await expect(f.liters).toHaveValue('40.000');
  await f.odometer.fill('128450');
  const path = `users/${scope.uid}/vehicles/${scope.vehicleId}/fillups`;
  await save(page, path, { odometer: 128450, liters: 40, totalCost: 287.4 });
  await page.reload(); await page.goto('/history');
  await expect(page.getByText(/287\.4/).first()).toBeVisible();
  expect(await listDocuments(path)).toHaveLength(1);
});

test('a cold live odometer scan fills the form and saves', async ({ page }) => {
  only('replay-odometer', 'replay-movement');
  const scope = await signedInWithData(page, { fillups: [] }); await openWizard(page);
  const ms = await scanOdometer(page);
  note('time to filled odometer (cold)', `${ms} ms`);
  const f = field(page); await expect(f.odometer).toHaveValue('128450');
  await f.total.fill('287.40'); await f.liters.fill('40');
  await save(page, `users/${scope.uid}/vehicles/${scope.vehicleId}/fillups`, { odometer: 128450, liters: 40, totalCost: 287.4 });
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
  // The printed font needs the recogniser; the segment reader alone does not fill it.
  await expect(dialog(page).getByText(/לא ברורות|לא ברור/)).toBeVisible({ timeout: 60_000 });
  await expect(pumpRead(page)).toHaveCount(0);
  await finishByHand(page); await expect(field(page).total).toHaveValue('');
});

test('a counting pump is filled only with its final values, or not at all', async ({ page }) => {
  only('replay-counting-pump');
  await signedInWithData(page, { fillups: [] }); await openWizard(page);
  const opened = Date.now(); await openCamera(page);
  const abstained = dialog(page).getByText(/סותרות|לא ברורות|לא ברור/);
  await outcome(abstained, async () => (await pumpRead(page).count()) > 0);
  if (await pumpRead(page).count()) {
    const banner = dialog(page).getByRole('status').filter({ hasText: 'המשאבה נקראה' });
    await expect(banner).toContainText('₪287.40'); await expect(banner).toContainText('40.000');
    note('outcome', `filled the final values after ${Date.now() - opened} ms`);
  } else note('outcome', `abstained after ${Date.now() - opened} ms: ${await abstained.first().textContent()}`);
});

test('a pump with printed words beside its rows is filled correctly or not at all', async ({ page }) => {
  // The scene's words and digits are drawn with system fonts, which differ
  // between machines (macOS, the CI's Linux): the outcome is recorded, and
  // only a wrong value fails.
  only('replay-labelled-pump');
  await signedInWithData(page, { fillups: [] }); await openWizard(page);
  const opened = Date.now(); await openCamera(page);
  const abstained = dialog(page).getByText(/סותרות|לא ברורות|לא ברור/);
  await outcome(abstained, async () => (await pumpRead(page).count()) > 0);
  if (await pumpRead(page).count()) {
    const banner = dialog(page).getByRole('status').filter({ hasText: 'המשאבה נקראה' });
    await expect(banner).toContainText('₪287.40'); await expect(banner).toContainText('40.000');
    note('outcome', `filled 287.40 / 40.000 after ${Date.now() - opened} ms`);
  } else note('outcome', `abstained after ${Date.now() - opened} ms: ${await abstained.first().textContent()}`);
});

test('with a trip meter and a clock above the odometer, the trip is never filled', async ({ page }) => {
  only('replay-trip-and-odo');
  await signedInWithData(page, { fillups: [] }); await openWizard(page);
  await dialog(page).getByRole('button', { name: 'דילוג לקילומטראז׳', exact: true }).click();
  const opened = Date.now(); await openCamera(page);
  const abstained = dialog(page).getByText(/לא ברור|לא ברורות|TRIP|סותרות/);
  await outcome(abstained, async () => (await dialog(page).count()) === 0);
  if (!(await dialog(page).count())) { await expect(field(page).odometer).toHaveValue('128450'); note('outcome', `filled 128450 after ${Date.now() - opened} ms`); }
  else note('outcome', `abstained after ${Date.now() - opened} ms: ${await abstained.first().textContent()}`);
  await expect(field(page).odometer).not.toHaveValue('12345');
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
