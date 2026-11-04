import { expect, type Page } from '@playwright/test';
import { signedInWithData } from './app';
import { getDocument, listDocuments, seedVehicle, setActiveVehicle, setDocument } from './emulator';
import { homeAppearance } from './design-v2-home';
import { outboxCount } from './pwa';
import { localDay } from '../../src/lib/maintenance/model';

export async function tcoFixture(page: Page, mode: 'complete' | 'one' | 'empty' = 'complete') {
  const now = new Date();
  const fills = mode === 'empty' ? [] : mode === 'one'
    ? [{ id: 'one', date: now, odometer: 100800, liters: 40, totalCost: 240 }]
    : [
      { id: 'base', date: new Date(now.getFullYear(), now.getMonth() - 1, 1, 12), odometer: 100000, liters: 40, totalCost: 240 },
      { id: 'middle', date: new Date(now.getFullYear(), now.getMonth() - 1, 15, 12), odometer: 100400, liters: 40, totalCost: 240 },
      { id: 'end', date: now, odometer: 100800, liters: 40, totalCost: 240 },
    ];
  const scope = await signedInWithData(page, { fillups: fills, vehicle: { make: 'יונדאי', model: 'i20', tankLiters: 45, tankLitersSource: 'user', declaredKmPerLiter: 16.4 } });
  const base = `users/${scope.uid}/vehicles/${scope.vehicleId}`;
  const original = await getDocument(base);
  await setDocument(base, { ...original, docs: mode === 'complete'
    ? { mandatory: { cost: 1200, insurer: 'הראל', due: '2027-11-04' }, coverage: { type: 'third', cost: 600 }, test: { cost: 1200, future: { retained: true } } }
    : { coverage: { type: 'none' } } });
  if (mode === 'complete') {
    const record = { schemaVersion: 1, version: 1, day: localDay(now), title: 'חשבונית בדיקה', notes: '' };
    await setDocument(`${base}/serviceEvents/service`, { ...record, jobs: ['oil'], odometer: 100800, costAgorot: 30000, garage: '', completedPlanIds: [] });
    for (const [category, costAgorot] of [['parking', 10000], ['insurance', 180000], ['registration', 120000]] as const) {
      await setDocument(`${base}/vehicleExpenses/${category}`, { ...record, category, costAgorot });
    }
  }
  await page.goto('/');
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  return { ...scope, base };
}

export async function completeTcoFlow(page: Page) {
  const scope = await tcoFixture(page);
  const card = page.getByTestId('tco-card');
  await expect(card.locator('.tm-tco-value')).toHaveText('₪810');
  await expect(card.getByTestId('tco-missing')).toHaveCount(0);
  await expect(card).toContainText('₪9,720');
  await expect(page.getByTestId('home-fuel-month')).toContainText('₪240');
  await expect(page.getByTestId('home-fuel-month')).toContainText('בד״כ ₪360');
  await card.click();
  const sheet = page.getByTestId('tco-sheet');
  await expect(sheet.locator('.tm-tco-value')).toHaveText('₪810');
  const sharingAction = sheet.getByRole('button', { name: 'הגדרות שיתוף עלות', exact: true });
  const target = await sharingAction.boundingBox(); expect(target?.height).toBeGreaterThanOrEqual(44); expect(target?.width).toBeGreaterThanOrEqual(44);
  await expect(page.getByTestId('tco-value-other')).toHaveText('₪50');
  await expect(page.getByTestId('tco-value-mandatory')).toHaveText('₪100');
  await expect(page.getByTestId('tco-value-test')).toHaveText('₪100');
  await page.getByRole('radio', { name: 'בשנה', exact: true }).click();
  await expect(sheet.locator('.tm-tco-value')).toHaveText('₪9,720');
  await expect(page.getByTestId('tco-value-test')).toHaveText('₪1,200');
  await page.getByRole('radio', { name: 'בחודש', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  await page.goto('/stats?tab=spend');
  const compact = page.getByTestId('tco-card');
  await expect(compact).toHaveAttribute('data-compact', 'true');
  await expect(compact.locator('.tm-tco-value')).toHaveText('₪810');
  await expect(compact.locator('.tm-tco-legend')).toHaveCount(0);
  expect(await listDocuments(`${scope.base}/vehicleExpenses`)).toHaveLength(3);
}

export async function missingTcoFlow(page: Page) {
  const scope = await tcoFixture(page, 'one');
  const card = page.getByTestId('tco-card');
  await expect(card).toContainText('הרכב עולה לך, לפחות');
  await expect(card.getByTestId('tco-missing')).toHaveText('חסר 2 פריטים');
  await expect(card.locator('.tm-tco-value')).toHaveText('₪240');
  await card.click();
  await page.getByTestId('tco-part-mandatory').click();
  const editor = page.getByRole('dialog', { name: 'ביטוח חובה', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByTestId('vehicle-doc-cost').fill('1200');
  await editor.getByTestId('vehicle-doc-save').click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await getDocument(scope.base))?.docs).toMatchObject({ mandatory: { cost: 1200 }, coverage: { type: 'none' } });
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  await expect(page.getByTestId('tco-sheet').locator('.tm-tco-value')).toHaveText('₪340');
  await expect(page.getByTestId('tco-part-mandatory')).not.toContainText('לא הוזן');
  await expect(page.getByTestId('tco-part-mandatory')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(card.getByTestId('tco-missing')).toHaveText('חסר טסט ואגרת רישוי');
  expect(await listDocuments(`${scope.base}/vehicleExpenses`)).toHaveLength(0);
}

export async function preciseTestCostFlow(page: Page) {
  const scope = await tcoFixture(page);
  await expect(page.getByTestId('tco-card').locator('.tm-tco-value')).toHaveText('₪810');
  await page.getByTestId('tco-card').click();
  await page.getByTestId('tco-part-test').click();
  const editor = page.getByRole('dialog', { name: 'טסט שנתי', exact: true });
  await expect(editor.getByLabel('אגרת רישוי + טסט, בשנה (רשות)', { exact: true })).toHaveValue('1200');
  await editor.getByTestId('vehicle-doc-cost').fill('2400.123456');
  await editor.getByTestId('vehicle-doc-save').click();
  await expect.poll(async () => (await getDocument(scope.base))?.docs).toMatchObject({ test: { cost: 2400.123456, future: { retained: true } }, mandatory: { cost: 1200 }, coverage: { cost: 600 } });
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  await expect(page.getByTestId('tco-sheet').locator('.tm-tco-value')).toHaveText('₪910');
  await page.getByRole('radio', { name: 'בשנה', exact: true }).click();
  await expect(page.getByTestId('tco-sheet').locator('.tm-tco-value')).toHaveText('₪10,920');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByTestId('tco-card').locator('.tm-tco-value')).toHaveText('₪910');
  expect((await getDocument(scope.base))?.docs).toMatchObject({ test: { cost: 2400.123456, future: { retained: true } } });
  expect(await listDocuments(`${scope.base}/vehicleExpenses`)).toHaveLength(3);
}

export async function filteredJournalTcoFlow(page: Page) {
  await tcoFixture(page);
  for (const [id, kind] of [['fuel', 'fuel'], ['service', 'service'], ['other', 'expense']] as const) {
    await page.goto('/');
    await page.getByTestId('tco-card').click();
    await page.getByTestId(`tco-part-${id}`).click();
    await expect(page).toHaveURL(new RegExp(`/history\\?.*kind=${kind}`));
    await expect(page.getByTestId(`journal-filter-${kind}`)).toHaveAttribute('aria-pressed', 'true');
  }
}

export async function responsiveTcoFlow(page: Page) {
  const scope = await tcoFixture(page);
  const colors: string[] = [];
  for (const [theme, accent] of [['light', 'plate'], ['dark', 'mint']] as const) {
    await homeAppearance(page, scope.uid, theme, accent);
    for (const width of [320, 390, 820, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const card = page.getByTestId('tco-card');
      await expect(card.locator('.tm-tco-value')).toHaveText('₪810');
      expect(await card.locator('.tm-tco-value').evaluate(element => getComputedStyle(element).fontFamily)).toContain('Karantina');
      await expect(card.getByTestId('tco-bar').locator('i')).toHaveCount(6);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const box = await card.boundingBox(); expect(box?.width).toBeLessThanOrEqual(width);
    }
    colors.push(await page.locator('[data-tco-part="fuel"]').evaluate(element => getComputedStyle(element).backgroundColor));
  }
  expect(colors[0]).not.toBe(colors[1]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('tco-card').click();
  await expect(page.getByTestId('tco-community-status')).not.toContainText('8%');
  await page.keyboard.press('Escape');
  await seedVehicle(scope.uid, 'empty', { make: 'רכב חדש', model: 'ללא תדלוקים' });
  await setActiveVehicle(scope.uid, 'empty');
  await page.goto('/');
  await expect(page.getByText('מתחילים מהתדלוק הבא', { exact: true })).toBeVisible();
  await expect(page.getByTestId('tco-card')).toHaveCount(0);
  await expect(page.getByTestId('home-fuel-month')).toContainText('—');
}
