import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signedInWithData } from './helpers/app';

test.use({ serviceWorkers: 'block' });
const original = readFileSync(new URL('../src/lib/prices/__fixtures__/delek-list-2026-11.html', import.meta.url), 'utf8');
function publication() {
  const today = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  return original.replaceAll('01/11/2026', today);
}

test('backup belongs to My Data after account information', async ({ page }) => {
  await signedInWithData(page);
  await page.goto('/settings/profile');
  const data = page.getByRole('region', { name: 'הנתונים שלי', exact: true });
  await expect(data.getByRole('button', { name: 'הורדת גיבוי מלא ↓' })).toBeVisible();
  await expect(data.getByRole('button', { name: /גיבוי וייצוא תחזוקה/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'גיבוי חשבון מלא' })).toHaveCount(1);
  const account = await page.getByText('alice@example.com', { exact: true }).boundingBox();
  const backup = await data.boundingBox();
  expect(account!.y).toBeLessThan(backup!.y);
});

test('diesel list price refreshes independently and never becomes a receipt default', async ({ page }) => {
  let down = false;
  await page.route('https://delek.co.il/**', route => route.fulfill({ status: down ? 503 : 200, contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: down ? 'unavailable' : publication() }));
  await page.route('https://r.jina.ai/https://delek.co.il/**', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await signedInWithData(page, { vehicle: { make: 'פורד', model: 'טרנזיט', fuelType: 'diesel' }, regulatedPrice: 7.31 });
  const reference = page.getByRole('region', { name: 'מחירון סולר', exact: true });
  await expect(reference).toContainText('₪12.05');
  await expect(reference).toContainText('מחירון דלק · שירות מלא');
  await expect(reference).toContainText('מחוץ לאילת');
  await page.goto('/settings');
  await expect(reference).toContainText('₪12.05');
  down = true;
  await reference.getByRole('button', { name: 'רענון מחירון', exact: true }).click();
  await expect(reference).toContainText('הרענון לא הצליח');
  await expect(reference).toContainText('₪12.05');
  await page.goto('/fillup/new');
  await expect(page.getByLabel('מחיר לליטר', { exact: true })).toHaveValue('');
});

test('98 uses its own published value while 95 keeps its exact existing suggestion', async ({ page }) => {
  let requests = 0;
  await page.route('https://delek.co.il/**', route => { requests++; return route.fulfill({ contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: publication() }); });
  await signedInWithData(page, { vehicle: { make: 'מבחן', model: '95', fuelType: '95' }, regulatedPrice: 7.31 });
  await expect(page.getByRole('region', { name: /מחירון/ })).toHaveCount(0);
  await page.goto('/fillup/new');
  await expect(page.getByLabel('מחיר לליטר', { exact: true })).toHaveValue('7.31');
  expect(requests).toBe(0);
});

test('98 is labelled as a network reference, with its own exact price', async ({ page }) => {
  await page.route('https://delek.co.il/**', route => route.fulfill({ contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: publication() }));
  await signedInWithData(page, { vehicle: { make: 'מבחן', model: '98', fuelType: '98' } });
  const reference = page.getByRole('region', { name: 'מחירון בנזין 98', exact: true });
  await expect(reference).toContainText('₪9.66');
  await expect(reference).not.toContainText('₪12.05');
  await expect(reference).toContainText('המחיר ששולם בתחנה עשוי להיות שונה');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
