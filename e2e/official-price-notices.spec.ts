import { expect, test } from '@playwright/test';
import { signedInWithData } from './helpers/app';
import { setDocument } from './helpers/emulator';
import { CHECKED_AT, FIFTH, NOVEMBER_FIFTH, SNAPSHOT } from '../src/lib/prices/__fixtures__/officialNotices';
import { withPublicPrices } from '../src/lib/prices/regulated';

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem' });

test('a confirmed upcoming price shows its source and activates while Home and its sheet remain open', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signedInWithData(page, { vehicle: { make: 'יונדאי', model: 'i20', tankLiters: 45, tankLitersSource: 'user' }, regulatedPrice: 7.35, fillups: [] });
  await page.clock.install({ time: new Date(NOVEMBER_FIFTH - 30_000) });
  await setDocument('appConfig/fuelPrices', withPublicPrices(null, SNAPSHOT, CHECKED_AT)!);
  await page.goto('/');
  const current = page.getByTestId('home-fuel-price');
  const alert = page.locator('[data-testid="spotlight-card"][data-spotlight-type="price"]');
  await expect(current).toContainText('7.35\u202F₪');
  await expect(alert).toContainText('יתייקר');
  await expect(alert).toContainText('0.50\u202F₪');
  await expect(alert).toContainText('45 ליטר');
  await expect(alert).toContainText('23\u202F₪');
  const upcomingId = await alert.getAttribute('data-spotlight-id');
  await alert.getByRole('button').first().click();
  const sheet = page.getByTestId('price-sheet');
  const upcoming = page.getByTestId('upcoming-official-price');
  await expect(sheet).toBeVisible();
  await expect(upcoming).toContainText('7.85\u202F₪');
  await expect(upcoming).toContainText('5 בנובמבר 2026 בשעה 00:00');
  await expect(upcoming.getByRole('link')).toHaveAttribute('href', FIFTH.url);
  // VehicleDataContext's existing minute clock must update this mounted screen without a reload or network refresh.
  await page.clock.fastForward(60_000);
  await expect(upcoming).toHaveCount(0);
  await expect(current).toContainText('7.85\u202F₪');
  await expect(sheet.getByRole('link', { name: 'להודעת משרד האנרגיה על המחיר הנוכחי' })).toHaveAttribute('href', FIFTH.url);
  await page.keyboard.press('Escape');
  await expect(alert).toContainText('עלה ב-');
  await expect(alert).toContainText('0.50\u202F₪');
  await expect(alert).not.toContainText('0.08\u202F₪');
  expect(await alert.getAttribute('data-spotlight-id')).not.toBe(upcomingId);
});
