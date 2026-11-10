import { expect, test, type Page, type Route } from '@playwright/test';
import { DOC_TITLES, openVehicleDoc, vehicleFixture } from './helpers/design-v2-vehicle';
import { getDocument, listDocuments } from './helpers/emulator';
import { outboxCount } from './helpers/pwa';
import { tcoFixture } from './helpers/tco';

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });

const LISTEN = /google\.firestore\.v1\.Firestore\/Listen\/channel/;
const COMMIT = /\/documents:commit(?:\?|$)/;

/** Hold only this vehicle's first real local-emulator Commit, never fixture/admin traffic. */
async function holdVehicleCommit(page: Page, path: string) {
  let held = false;
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const handler = async (route: Route) => {
    const url = new URL(route.request().url());
    if (!held && ['127.0.0.1', 'localhost'].includes(url.hostname)
      && url.pathname.includes('/projects/demo-tankmaleh/') && route.request().postData()?.includes(path)) {
      held = true;
      await gate;
    }
    await route.continue();
  };
  await page.route(COMMIT, handler);
  return {
    wait: () => expect.poll(() => held).toBe(true),
    release,
    cleanup: async () => { release(); await page.unroute(COMMIT, handler); },
  };
}

test('manual dates mask day/month/year while typing and retain editable invalid drafts', async ({ page }) => {
  await vehicleFixture(page, { mandatory: { due: '2027-01-01', cost: 1200 } });
  await openVehicleDoc(page, 'mandatory');
  const due = page.locator('#vehicle-doc-due');
  await due.fill('');
  await due.pressSequentially('30');
  await expect(due).toHaveValue('30');
  await due.pressSequentially('06');
  await expect(due).toHaveValue('30/06');
  await due.pressSequentially('2027');
  await expect(due).toHaveValue('30/06/2027');
  expect(await due.evaluate(input => (input as HTMLInputElement).selectionStart)).toBe(10);
  await expect(page.getByRole('dialog').locator('input[type="date"]')).toHaveValue('2027-06-30');

  // Real key edits cross inserted separators and keep the remaining segments in place.
  await due.evaluate(input => (input as HTMLInputElement).setSelectionRange(3, 3));
  await due.press('Backspace');
  await expect(due).toHaveValue('3/06/2027');
  expect(await due.evaluate(input => (input as HTMLInputElement).selectionStart)).toBe(1);
  await due.pressSequentially('0');
  await expect(due).toHaveValue('30/06/2027');
  await due.evaluate(input => (input as HTMLInputElement).setSelectionRange(3, 5));
  await due.pressSequentially('12');
  await expect(due).toHaveValue('30/12/2027');
  await due.fill('31022027');
  await due.press('Tab');
  await expect(due).toHaveValue('31/02/2027');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('תאריך לא תקין');
  await expect(page.getByRole('dialog').locator('input[type="date"]')).toHaveValue('');
  await due.fill('30062027');
  await expect(due).toHaveValue('30/06/2027');
  await page.keyboard.press('Escape');

  // The independent fill-up date/time control uses the same mask and day order.
  await page.goto('/fillup/new');
  await page.getByTestId('fillup-date').click();
  const fillupDay = page.getByLabel('תאריך — הקלדה ידנית');
  await fillupDay.fill('');
  await fillupDay.pressSequentially('30062024');
  await expect(fillupDay).toHaveValue('30/06/2024');
  await fillupDay.press('Enter');
  await expect(page.getByLabel('בחירת תאריך מהמכשיר')).toHaveValue('2024-06-30');
  await fillupDay.fill('31022024');
  await fillupDay.press('Enter');
  await expect(fillupDay).toHaveValue('31/02/2024');
  await expect(page.getByRole('button', { name: 'אישור', exact: true })).toBeDisabled();
  await fillupDay.fill('30062024');
  await fillupDay.press('Enter');
  await page.getByRole('button', { name: 'אישור', exact: true }).click();
  await expect(page.getByLabel('תאריך — הקלדה ידנית')).toHaveCount(0);
});

for (const key of ['mandatory', 'test'] as const) {
  test(`${key} cost updates TCO and vehicle rows before Commit ACK and survives ACK without reload or a Listen echo`, async ({ page, context }) => {
    const scope = await tcoFixture(page);
    const originalDocs = (await getDocument(scope.base))?.docs;
    const sameDocument = await page.evaluateHandle(() => document);
    const card = page.getByTestId('tco-card');
    await expect(card.locator('.tm-tco-value')).toHaveText('810\u202F₪');
    await card.click();
    await page.getByTestId(`tco-part-${key}`).click();
    const editor = page.getByRole('dialog', { name: DOC_TITLES[key], exact: true });
    await expect(editor.getByTestId('vehicle-doc-cost')).toHaveValue('1200');

    // End the old long-poll connection before blocking replacement Listen calls.
    // BatchGet and Commit stay live, so only the provider's ACK bridge can retire
    // the optimistic document overlay without reverting the visible values.
    await context.setOffline(true);
    await page.route(LISTEN, route => route.abort('connectionfailed'));
    await context.setOffline(false);
    const gate = await holdVehicleCommit(page, scope.base);
    try {
      const due = editor.locator('#vehicle-doc-due');
      await due.fill('');
      await due.pressSequentially('30062027');
      await expect(due).toHaveValue('30/06/2027');
      await editor.getByTestId('vehicle-doc-cost').fill('2400.123456');
      await editor.getByTestId('vehicle-doc-save').click();
      await gate.wait();
      await expect(editor).toHaveCount(0);

      // This is intentionally before the server request is allowed to commit.
      expect((await getDocument(scope.base))?.docs).toEqual(originalDocs);
      expect(await outboxCount(page, scope.uid)).toBeGreaterThan(0);
      await expect(page.getByTestId('tco-sheet').locator('.tm-tco-value')).toHaveText('910\u202F₪');
      await expect(page.getByTestId(`tco-value-${key}`)).toHaveText('200\u202F₪');
      await page.keyboard.press('Escape');
      await expect(card.locator('.tm-tco-value')).toHaveText('910\u202F₪');
      await page.getByTestId('tab-vehicle').click();
      const row = page.getByTestId(`vehicle-doc-${key}`);
      await expect(row).toContainText('2,400\u202F₪');
      await expect(row).toContainText('30/06/2027');
      expect((await getDocument(scope.base))?.docs).toEqual(originalDocs);
      await page.getByTestId('tab-home').click();
      await card.click();
      await expect(page.getByTestId(`tco-value-${key}`)).toHaveText('200\u202F₪');

      gate.release();
      await expect.poll(async () => (await getDocument(scope.base))?.docs).toMatchObject({
        [key]: { cost: 2400.123456, due: '2027-06-30' },
      });
      await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
      // Check after React has painted the retired overlay, not only in the
      // interval between the journal's disk deletion and its UI notification.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page.getByTestId('tco-sheet').locator('.tm-tco-value')).toHaveText('910\u202F₪');
      await expect(page.getByTestId(`tco-value-${key}`)).toHaveText('200\u202F₪');
      await page.keyboard.press('Escape');
      await page.getByTestId('tab-vehicle').click();
      await expect(row).toContainText('2,400\u202F₪');
      await expect(row).toContainText('30/06/2027');
      expect(await sameDocument.evaluate(node => node === document)).toBe(true);
      expect(await listDocuments(`${scope.base}/vehicleExpenses`)).toHaveLength(3);
    } finally {
      await gate.cleanup();
      await page.unroute(LISTEN);
      await context.setOffline(false);
      await sameDocument.dispose();
    }
  });
}
