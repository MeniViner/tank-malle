import { expect, test, type Page } from '@playwright/test';
import { fillupFixture, typeFillup } from './helpers/design-v2-fillup';

import { ALICE, completeGooglePopup, uidOf } from './helpers/app';
import { listDocuments, resetEmulators } from './helpers/emulator';

async function isolateCollectors(page: Page) {
  // Exercise the production opt-in UI, with both Google collectors isolated.
  await page.route('https://www.googletagmanager.com/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://*.google-analytics.com/**', r => r.abort());
  await page.route('**/src/lib/monitoring/usage.ts*', async route => {
    const source = await route.fetch();
    const body = (await source.text()).replace(/export const measurementAvailable = [^;]+;/, 'export const measurementAvailable = true;');
    await route.fulfill({ response: source, body });
  });
  await page.route('**/firebase_performance.js*', r => r.fulfill({ contentType: 'text/javascript',
    body: 'export const initializePerformance = () => ({}); export const trace = () => ({record(){}});' }));
}

const events = (page: Page): Promise<string[]> => page.frameLocator('iframe[src="/usage-metrics.html"]').locator('body').evaluate(() => {
  const layer = (window as Window & { dataLayer?: ArrayLike<string>[] }).dataLayer ?? [];
  return layer.filter(args => args[0] === 'event').map(args => args[1]);
});

test('the optional usage report follows one new fill-up from opening to local handoff', async ({ page }) => {
  await isolateCollectors(page);
  await fillupFixture(page, { history: 'none' });
  await page.goto('/account');
  const toggle = page.getByRole('switch', { name: 'שיתוף נתוני שימוש מהמכשיר הזה' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await page.goto('/');
  await page.getByTestId('refuel-fab').click();
  await typeFillup(page, { odometer: 100000, liters: 20, price: 7, end: 'full' });
  await page.getByTestId('fillup-save').click();
  await expect(page.getByTestId('fillup-saved')).toBeVisible();
  await expect.poll(() => events(page)).toContain('write_synced');
  expect(await events(page)).toEqual(expect.arrayContaining(['usage_open', 'fillup_started', 'fillup_submitted', 'write_local', 'fillup_queued']));
  await page.goto('/account');
  await toggle.click();
  await expect(page.locator('iframe[src="/usage-metrics.html"]')).toHaveCount(0);
});

test('opt-in sign-in through first vehicle and offline first action', async ({ page, context }) => {
  await resetEmulators();
  await isolateCollectors(page);
  await page.goto('/');
  await page.getByTestId('onboarding-skip').click();
  await expect(page.locator('iframe[src="/usage-metrics.html"]')).toHaveCount(0);
  await page.getByRole('checkbox', { name: /שיתוף נתוני שימוש/ }).check();
  await page.getByTestId('signin-consent').check();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('signin-google').click()]);
  await completeGooglePopup(popup, ALICE);
  await page.getByTestId('wizard-manual').click();
  await page.getByTestId('wizard-make').fill('בדיקה');
  await page.getByTestId('wizard-model').fill('דגם');
  await page.getByTestId('wizard-confirm-next').click();
  await page.getByTestId('wizard-skip').click();
  const uid = await uidOf(ALICE);
  await expect.poll(() => events(page)).toContain('write_synced');
  const [vehicle] = await listDocuments('users/' + uid + '/vehicles');
  const stages = ['signin_viewed', 'signin_started', 'signin_completed', 'vehicle_wizard_open', 'vehicle_created'];
  expect((await events(page)).filter(name => stages.includes(name))).toEqual(stages);
  await page.getByTestId('refuel-fab').click();
  await typeFillup(page, { odometer: 3000, liters: 20, price: 7, end: 'full' });
  await context.setOffline(true);
  await page.getByTestId('fillup-save').click();
  await expect(page.getByTestId('fillup-saved')).toBeVisible();
  expect(await listDocuments('users/' + uid + '/vehicles/' + vehicle.id + '/fillups')).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage)
    .filter(([key]) => key.startsWith('tm.measurement.offline.')).map(([, value]) => value))).toContain('first_action_saved');
  await context.setOffline(false);
  await expect.poll(() => events(page)).toContain('first_action_saved');
  await expect.poll(async () => (await events(page)).filter(name => name === 'write_synced').length).toBe(2);
  expect((await events(page)).filter(name => name === 'write_local')).toHaveLength(2);
  expect(await listDocuments('users/' + uid + '/vehicles/' + vehicle.id + '/fillups')).toHaveLength(1);
});
