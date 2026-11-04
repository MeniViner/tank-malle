import { expect, type Page } from '@playwright/test';
import { vehicleFixture } from './design-v2-vehicle';
import { getDocument, seedVehicle } from './emulator';
import { outboxCount } from './pwa';

/** A real server interleaving: restoration precedes the automatic follow-up read. */
export async function restoredArchiveFollowupFlow(page: Page) {
  const scope = await vehicleFixture(page);
  const vehicleId = 'archive-race', profilePath = `users/${scope.uid}`;
  await seedVehicle(scope.uid, vehicleId, { make: 'רכב בדיקה', model: 'החזרה', year: 2021 });
  const original = await getDocument(`${profilePath}/vehicles/${vehicleId}`);
  await page.goto('/settings/vehicles');
  const card = page.locator(`[data-managed-vehicle="${vehicleId}"]`);
  await card.getByRole('button', { name: /^בחירה ברכב/ }).click();
  await expect.poll(async () => (await getDocument(profilePath))?.settings).toMatchObject({ activeVehicleId: vehicleId });
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  const settings = (await getDocument(profilePath))!.settings;
  let release = () => {}, held = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pattern = '**/*:batchGet*';
  await page.route(pattern, async route => {
    const body = route.request().postData() ?? '';
    if (!held && body.includes(profilePath) && !body.includes('costBenchmarks')) {
      held = true; await gate;
    }
    await route.continue();
  });
  try {
    await card.getByRole('button', { name: /^העברת .* לארכיון$/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'העברה לארכיון', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    await expect.poll(() => getDocument(`${profilePath}/vehicles/${vehicleId}`)).toMatchObject({ archived: true });
    await card.getByRole('button', { name: /^החזרת .* מהארכיון$/ }).click();
    await expect.poll(() => getDocument(`${profilePath}/vehicles/${vehicleId}`)).toMatchObject({ archived: false });
    release();
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
    expect((await getDocument(profilePath))!.settings).toEqual(settings);
    expect(await getDocument(`${profilePath}/vehicles/${vehicleId}`)).toEqual(original);
  } finally { release(); await page.unroute(pattern); }
}
