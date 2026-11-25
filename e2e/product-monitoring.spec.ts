import { expect, test } from '@playwright/test';
import { fillupFixture, typeFillup } from './helpers/design-v2-fillup';

test('the optional usage report follows one new fill-up from opening to local handoff', async ({ page }) => {
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
  const events = () => page.frameLocator('iframe[src="/usage-metrics.html"]').locator('body').evaluate(() => {
    const layer = (window as Window & { dataLayer?: ArrayLike<string>[] }).dataLayer ?? [];
    return layer.filter(args => args[0] === 'event').map(args => args[1]);
  });
  await expect.poll(events).toEqual(['usage_open', 'fillup_started', 'fillup_submitted', 'fillup_queued']);
  await page.goto('/account');
  await toggle.click();
  await expect(page.locator('iframe[src="/usage-metrics.html"]')).toHaveCount(0);
});
