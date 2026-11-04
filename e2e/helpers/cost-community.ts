import { expect, type Page } from '@playwright/test';
import { tcoFixture } from './tco';
import { ALICE, BOB, signIn, signOut } from './app';
import { getDocument, listAccounts, listDocuments, seedFillups, seedVehicle, setDocument } from './emulator';
import { outboxCount } from './pwa';

const sharing = (page: Page) => page.getByRole('switch', { name: 'שיתוף סיכום עלות הרכב', exact: true });
const costPath = (uid: string, vehicleId: string) => `costBenchmarks/${uid}__${vehicleId}`;
async function enable(page: Page, scope: { uid: string; vehicleId: string }) {
  await page.goto('/account'); await expect(sharing(page)).not.toBeChecked(); await sharing(page).click();
  const consent = page.getByTestId('cost-sharing-consent');
  await expect(consent).toContainText('כבוי כברירת מחדל');
  await expect(consent).toContainText('משתמשים מחוברים יכולים לקרוא');
  await consent.getByRole('button', { name: 'אישור והפעלת שיתוף עלות', exact: true }).click();
  await expect(consent).toHaveCount(0);
  await expect.poll(async () => (await getDocument(`users/${scope.uid}`))?.settings).toMatchObject({ shareTcoBenchmarks: true });
  await expect.poll(() => getDocument(costPath(scope.uid, scope.vehicleId))).not.toBeNull();
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
}
const peer = (uid: string, patch: Record<string, unknown> = {}) => setDocument(`costBenchmarks/${uid}__car`, {
  vehicleId: 'car', modelKey: 'יונדאי i20', fuelType: '95', monthlyCost: 1000, months: 12, method: 1, updatedAt: new Date(), ...patch,
});
async function openCost(page: Page) { await page.goto('/'); await page.getByTestId('tco-card').click(); }

export async function costConsentFlow(page: Page) {
  const scope = await tcoFixture(page);
  expect(await getDocument(costPath(scope.uid, scope.vehicleId))).toBeNull();
  await page.goto('/account'); await expect(sharing(page)).not.toBeChecked(); await sharing(page).click();
  await page.getByTestId('cost-sharing-consent').getByRole('button', { name: 'סגירה', exact: true }).click();
  await expect(sharing(page)).not.toBeChecked();
  expect(await listDocuments('costBenchmarks')).toHaveLength(0);
  await enable(page, scope);
  const row = (await getDocument(costPath(scope.uid, scope.vehicleId)))!;
  expect(Object.keys(row).sort()).toEqual(['fuelType', 'method', 'modelKey', 'monthlyCost', 'months', 'updatedAt', 'vehicleId']);
  expect(row).toMatchObject({ monthlyCost: 810, months: 2, method: 1 });
  await page.reload(); await expect(sharing(page)).toBeChecked();
}

export async function costCohortFlow(page: Page) {
  const scope = await tcoFixture(page); await enable(page, scope);
  for (const uid of ['peer-a', 'peer-b', 'peer-c']) await peer(uid);
  await setDocument('costBenchmarks/peer-a__other', { ...(await getDocument('costBenchmarks/peer-a__car'))!, vehicleId: 'other', updatedAt: new Date(Date.now() - 1000) });
  await peer('other-model', { modelKey: 'יונדאי kona' }); await peer('other-fuel', { fuelType: 'diesel' });
  await peer('stale', { updatedAt: new Date(Date.now() - 91 * 86400000) });
  await setDocument(costPath(scope.uid, 'other'), { ...(await getDocument(costPath(scope.uid, scope.vehicleId)))!, vehicleId: 'other', monthlyCost: 9999 });
  await openCost(page);
  await expect(page.getByTestId('tco-community-status')).toContainText('יש 3 נהגים אחרים');
  await expect(page.getByTestId('tco-community-comparison')).toHaveCount(0);
  await page.keyboard.press('Escape'); await peer('peer-d'); await page.getByTestId('tco-card').click();
  await expect(page.getByTestId('tco-community-comparison')).toHaveText('אתה משלם 19% פחות מהממוצע');
  await page.getByRole('radio', { name: 'בשנה', exact: true }).click();
  await expect(page.getByTestId('tco-community-comparison')).toHaveText('אתה משלם 19% פחות מהממוצע');
  await page.getByTestId('tco-part-test').click();
  const editor = page.getByRole('dialog', { name: 'טסט שנתי', exact: true });
  await editor.getByTestId('vehicle-doc-cost').fill('2400'); await editor.getByTestId('vehicle-doc-save').click();
  await expect(page.getByTestId('tco-community-comparison')).toHaveText('אתה משלם 9% פחות מהממוצע');
  await expect.poll(async () => (await getDocument(costPath(scope.uid, scope.vehicleId)))?.monthlyCost).toBe(910);
}

export async function costWithdrawalFlow(page: Page) {
  const scope = await tcoFixture(page); await enable(page, scope);
  const own = (await getDocument(costPath(scope.uid, scope.vehicleId)))!;
  for (const id of ['archived', 'deleted']) await setDocument(costPath(scope.uid, id), { ...own, vehicleId: id });
  await peer('unrelated');
  await page.getByRole('switch', { name: 'שיתוף סיכום דלק להשוואה', exact: true }).click();
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  expect(await getDocument(costPath(scope.uid, scope.vehicleId))).not.toBeNull();
  await sharing(page).click();
  await expect.poll(() => listDocuments('costBenchmarks')).toEqual([expect.objectContaining({ id: 'unrelated__car' })]);
  await expect(page.getByTestId('cost-sharing-withdrawal')).toHaveText('שיתוף העלות כבוי. סיכומי העלות הוסרו מהשרת.');
  await page.reload(); await expect(sharing(page)).not.toBeChecked();
  expect(await getDocument(costPath(scope.uid, scope.vehicleId))).toBeNull();
}

export async function costOfflineWithdrawalFlow(page: Page) {
  const scope = await tcoFixture(page); await enable(page, scope);
  await page.context().setOffline(true);
  try {
    await sharing(page).click(); await expect(sharing(page)).not.toBeChecked();
    await expect(page.getByTestId('cost-sharing-withdrawal')).not.toContainText('סיכומי העלות הוסרו מהשרת');
    expect(await getDocument(costPath(scope.uid, scope.vehicleId))).not.toBeNull();
  } finally { await page.context().setOffline(false); }
  await expect.poll(() => getDocument(costPath(scope.uid, scope.vehicleId))).toBeNull();
  await expect(page.getByTestId('cost-sharing-withdrawal')).toContainText('סיכומי העלות הוסרו מהשרת');
}

export async function costIncompleteFlow(page: Page) {
  const scope = await tcoFixture(page); await enable(page, scope);
  for (const uid of ['a', 'b', 'c', 'd']) await peer(uid);
  await openCost(page); await expect(page.getByTestId('tco-community-comparison')).toBeVisible();
  await page.getByTestId('tco-part-test').click();
  const editor = page.getByRole('dialog', { name: 'טסט שנתי', exact: true });
  await editor.getByTestId('vehicle-doc-cost').fill(''); await editor.getByTestId('vehicle-doc-save').click();
  await expect(page.getByTestId('tco-community-comparison')).toHaveCount(0);
  await expect(page.getByTestId('tco-community-status')).toContainText('אחרי שכל העלויות יושלמו');
  await expect.poll(() => getDocument(costPath(scope.uid, scope.vehicleId))).toBeNull();
}

export async function costScopeFlow(page: Page) {
  const scope = await tcoFixture(page); await enable(page, scope);
  for (const uid of ['a', 'b', 'c', 'd']) await peer(uid);
  await openCost(page); await expect(page.getByTestId('tco-community-comparison')).toBeVisible();
  await page.keyboard.press('Escape');
  await seedVehicle(scope.uid, 'other', { make: 'Toyota', model: 'Yaris' });
  await seedFillups(scope.uid, 'other', [{ id: 'f', date: new Date(), odometer: 200000, liters: 30, totalCost: 200 }]);
  await page.getByTestId('open-car-switch').click();
  await page.getByRole('dialog').getByRole('button', { name: /Toyota Yaris/ }).click();
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  expect((await getDocument(`users/${scope.uid}`))?.settings).toMatchObject({ shareTcoBenchmarks: true, activeVehicleId: 'other' });
  await page.getByTestId('tco-card').click();
  await expect(page.getByTestId('tco-community-comparison')).toHaveCount(0);
  await page.keyboard.press('Escape'); await signOut(page); await signIn(page, BOB); await page.goto('/account');
  await expect(sharing(page)).not.toBeChecked();
  await expect(page.getByTestId('tco-community-comparison')).toHaveCount(0);
  expect((await listDocuments('costBenchmarks')).filter(row => String(row.id).startsWith(`${scope.uid}__`)).length).toBeGreaterThan(0);
}


export async function costAccountDeletionFlow(page: Page) {
  const scope = await tcoFixture(page); await enable(page, scope);
  expect((await getDocument(`users/${scope.uid}`))?.costSharingUsed).toBe(true);
  const own = (await getDocument(costPath(scope.uid, scope.vehicleId)))!;
  await setDocument(costPath(scope.uid, 'orphan'), { ...own, vehicleId: 'orphan' });
  await peer('preserved');
  await page.getByTestId('account-delete').click();
  await page.getByRole('button', { name: 'המשך למחיקה', exact: true }).click();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'כן, מחקו הכול', exact: true }).click();
  await (await popup).getByText(ALICE.email, { exact: false }).first().click();
  await expect.poll(async () => (await listAccounts()).some(account => account.localId === scope.uid), { timeout: 25000 }).toBe(false);
  expect(await getDocument(`users/${scope.uid}`)).toBeNull();
  expect(await getDocument(costPath(scope.uid, scope.vehicleId))).toBeNull();
  expect(await getDocument(costPath(scope.uid, 'orphan'))).toBeNull();
  expect(await getDocument('costBenchmarks/preserved__car')).not.toBeNull();
  await expect(page.getByTestId('signin-google')).toBeVisible();
}
