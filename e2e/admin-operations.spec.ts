import { expect, test } from '@playwright/test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { ALICE, signIn, signOut, signedInWithData } from './helpers/app';
import { PROJECT_ID, setDocument } from './helpers/emulator';

const repo = 'https://api.github.com/repos/MeniViner/tank-malle';
const sha = 'a'.repeat(40);

test('admin operations deep links, service probes, API filtering and GitHub in both themes', async ({ page }) => {
  const now = Date.now();
  const account = await signedInWithData(page, { regulatedPrice: 7.31 });
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${process.env.CARE_AUTH_PORT ?? '9099'}`;
  const app = initializeApp({ projectId: PROJECT_ID }, `admin-operations-${now}`);
  try { await getAuth(app).setCustomUserClaims(account.uid, { admin: true }); }
  finally { await deleteApp(app); }
  await signOut(page);
  await signIn(page, ALICE);

  const metric = { status: 'ok', days: [10, 20, 30, 40, 55, 60, 70] };
  await setDocument('adminOperations/latest', {
    version: 1, collectedAt: now, end: now - 7_200_000,
    metrics: {
      calls: { ...metric, codes: [{ code: '200', count: 280 }, { code: '503', count: 5 }], breakdownSize: 2, calls: [
        { service: 'firestore.googleapis.com', method: 'google.firestore.v1.Firestore.Commit', code: '200', count: 280 },
        { service: 'identitytoolkit.googleapis.com', method: 'SignInWithPassword', code: '503', count: 5 },
      ] },
      reads: metric, writes: metric, deletes: { status: 'empty' }, bandwidth: { ...metric, days: Array(7).fill(7_550_000) },
    },
  });

  await page.route('**/build-info.json', route => route.fulfill({ json: { version: '1.12.0', commit: sha, dirty: false } }));
  await page.route('https://data.gov.il/api/**', route => route.fulfill({ json: { success: true, result: { records: [] } } }));
  const run = { id: 1, name: 'Fuel price', path: '.github/workflows/fuel-prices.yml', head_branch: 'main', head_sha: sha, status: 'completed', conclusion: 'success', run_started_at: new Date(now).toISOString() };
  let unauthorizedRequests = 0;
  await page.route(`${repo}/**`, route => {
    const url = new URL(route.request().url());
    if (route.request().headers().authorization || route.request().headers().cookie) unauthorizedRequests++;
    const json = url.pathname.endsWith('/commits/main') ? { sha, commit: { message: 'Release check' } }
      : url.pathname.endsWith('/actions/runs') ? { workflow_runs: [run] }
      : [{ number: 8, title: 'Improve fuel job', updated_at: run.run_started_at, pull_request: {} }];
    return route.fulfill({ json });
  });

  await page.goto('/admin?tab=api');
  await expect(page.getByRole('heading', { name: 'קריאות API ותעבורה' })).toBeVisible();
  await expect(page.getByText('google.firestore.v1.Firestore.Commit')).toBeVisible();
  await page.getByRole('checkbox', { name: /רק תשובות/ }).check();
  await expect(page.getByText('google.firestore.v1.Firestore.Commit')).toHaveCount(0);
  await expect(page.getByText('SignInWithPassword')).toBeVisible();
  await page.getByRole('searchbox', { name: 'חיפוש קריאות API' }).fill('missing');
  await expect(page.getByText('אין קריאות שתואמות לסינון.')).toBeVisible();

  await page.getByRole('button', { name: 'שרתים', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'זמינות שירותים' })).toBeVisible();
  await expect(page.getByText('1.12.0', { exact: true })).toBeVisible();
  await expect(page.getByText('קריאה ישירה מהשרת', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'GitHub', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'משימות מתוזמנות' })).toBeVisible();
  await expect(page.getByText('Improve fuel job')).toBeVisible();
  await expect(page.getByText('Release check')).toBeVisible();
  expect(unauthorizedRequests).toBe(0);

  for (const [width, colorScheme] of [[320, 'light'], [390, 'dark'], [1440, 'light']] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme });
    for (const tab of ['שרתים', 'קריאות API', 'GitHub']) {
      const button = page.getByRole('button', { name: tab, exact: true });
      await button.click();
      await expect(button).toBeVisible();
      await expect(page.locator('.admin-ops-view')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
