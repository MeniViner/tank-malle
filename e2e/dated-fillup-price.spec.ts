import { expect, test, type Page } from '@playwright/test';
import { signedInWithData } from './helpers/app';
import { getDocument, listDocuments, seedFillups, setDocument } from './helpers/emulator';
import { NOVEMBER_FIFTH, SNAPSHOT } from '../src/lib/prices/__fixtures__/officialNotices';
import { withPublicPrices } from '../src/lib/prices/regulated';

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem' });

const VIEWED_AT = NOVEMBER_FIFTH + 36 * 60 * 60_000;

async function datedForm(page: Page) {
  await page.route('https://www.gov.il/**', route => route.abort());
  await page.route('https://r.jina.ai/**', route => route.abort());
  const scope = await signedInWithData(page, { fillups: [], regulatedPrice: 7.85 });
  await page.clock.setFixedTime(VIEWED_AT);
  const base = `users/${scope.uid}/vehicles/${scope.vehicleId}`;
  const vehicle = (await getDocument(base))!;
  await setDocument(base, { ...vehicle, createdAt: new Date(Number(vehicle.createdAt)),
    priceDiscount: { kind: 'amount', value: .2 } });
  await setDocument('appConfig/fuelPrices', withPublicPrices(null, SNAPSHOT, VIEWED_AT)!);
  await page.goto('/fillup/new');
  await expect(page.getByTestId('fillup-price')).toHaveValue('7.65');
  return { ...scope, collection: `${base}/fillups` };
}

async function chooseMoment(page: Page, day: string, time: string) {
  await page.getByTestId('fillup-date').click();
  const dialog = page.getByRole('dialog', { name: 'תאריך ושעה', exact: true });
  const dayField = dialog.getByLabel('תאריך — הקלדה ידנית');
  await dayField.fill(day);
  await dayField.press('Enter');
  const timeField = dialog.getByLabel('שעה — הקלדה ידנית');
  await timeField.fill(time);
  await timeField.press('Enter');
  await dialog.getByRole('button', { name: 'אישור', exact: true }).click();
}

test('the chosen Israel date changes the official base and current discount at midnight, with dated provenance', async ({ page }) => {
  const scope = await datedForm(page);
  await chooseMoment(page, '2026-11-04', '23:59');
  await expect(page.getByTestId('fillup-price')).toHaveValue('7.15');
  await expect(page.locator('#fillup-price-caption')).toContainText('1 בנובמבר 2026 בשעה 00:00');
  await expect(page.locator('#fillup-price-caption')).toContainText('לפי ההגדרה הנוכחית');
  await page.getByTestId('fillup-liters').fill('40');
  await expect(page.getByTestId('fillup-total')).toHaveValue('286.00');

  await chooseMoment(page, '2026-11-05', '00:00');
  await expect(page.getByTestId('fillup-price')).toHaveValue('7.65');
  await expect(page.getByTestId('fillup-liters')).toHaveValue('40');
  await expect(page.getByTestId('fillup-total')).toHaveValue('306.00');
  await expect(page.locator('#fillup-price-caption')).toContainText('5 בנובמבר 2026 בשעה 00:00');

  // Both entered measurements outrank a newly selected reference price.
  await page.getByTestId('fillup-total').fill('280.012345');
  await chooseMoment(page, '2026-11-04', '23:59');
  await expect(page.getByTestId('fillup-price')).toHaveValue('7');
  await expect(page.getByTestId('fillup-total')).toHaveValue('280.012345');
  expect(await listDocuments(scope.collection)).toHaveLength(0);
});

test('an older date without evidence clears derived amounts but preserves entered measurements and manual prices', async ({ page }) => {
  await datedForm(page);
  await page.getByTestId('fillup-liters').fill('40');
  await expect(page.getByTestId('fillup-total')).toHaveValue('306.00');
  // A legacy current value must not be borrowed for October just because it
  // was read before this form opened. Its only dated evidence is November.
  await setDocument('appConfig/fuelPrices', { source: 'gov.il',
    current: { pricePerLiter: 7.85, updatedAt: new Date(VIEWED_AT) }, history: { '2026-11': 7.85 } });
  await chooseMoment(page, '2026-10-15', '12:00');
  await expect(page.getByTestId('fillup-price')).toHaveValue('');
  await expect(page.getByTestId('fillup-total')).toHaveValue('');
  await expect(page.getByTestId('fillup-liters')).toHaveValue('40');

  await chooseMoment(page, '2026-11-05', '12:00');
  await expect(page.getByTestId('fillup-price')).toHaveValue('7.65');
  await page.getByTestId('fillup-price').fill('7.123456789');
  const derivedFromManual = await page.getByTestId('fillup-total').inputValue();
  await chooseMoment(page, '2026-10-15', '12:00');
  await expect(page.getByTestId('fillup-price')).toHaveValue('7.123456789');
  await expect(page.getByTestId('fillup-total')).toHaveValue(derivedFromManual);
  await page.reload();
  await expect(page.getByTestId('fillup-price')).toHaveValue('7.123456789');
});

test('editing the date of a saved transaction keeps its exact paid price and total', async ({ page }) => {
  const scope = await datedForm(page);
  const id = 'dated-paid-receipt', path = `${scope.collection}/${id}`;
  await seedFillups(scope.uid, scope.vehicleId, [{ id, date: new Date('2026-11-04T10:00:00Z'),
    odometer: 100000, liters: 40, pricePerLiter: 7.185, totalCost: 287.4001234567 }]);
  await page.goto(`/fillup/${id}`);
  await expect(page.getByTestId('fillup-price')).toHaveValue('7.185');
  await expect(page.getByTestId('fillup-total')).toHaveValue('287.4001234567');
  await chooseMoment(page, '2026-11-05', '12:00');
  await expect(page.getByTestId('fillup-price')).toHaveValue('7.185');
  await expect(page.getByTestId('fillup-total')).toHaveValue('287.4001234567');
  await page.getByTestId('fillup-save').click();
  await expect(page).toHaveURL('/');
  await expect.poll(async () => (await getDocument(path))?.date).toBe(Date.parse('2026-11-05T10:00:00Z'));
  expect(await getDocument(path)).toMatchObject({ pricePerLiter: 7.185, totalCost: 287.4001234567, liters: 40 });
});
