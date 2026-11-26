import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { AUTH_HOST, PROJECT_ID, resetEmulators, setDocument } from './helpers/emulator';

const fakeGoogleId = (subject: string) => [ { alg: 'none' }, {
  sub: subject, email: `${subject}@example.test`, email_verified: true, name: 'Console Fixture',
} ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.';

test('desktop console is exclusive to the enrolled Google account and keeps the narrow admin', async ({ page, request }) => {
  await resetEmulators();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'כניסה לקונסולת הבעלים' })).toBeVisible();

  process.env.FIREBASE_AUTH_EMULATOR_HOST = new URL(AUTH_HOST).host;
  const admin = initializeApp({ projectId: PROJECT_ID }, 'owner-console-e2e');
  const register = async (subject: string) => {
    const token = fakeGoogleId(subject);
    const postBody = new URLSearchParams({ id_token: token, providerId: 'google.com' }).toString();
    const res = await request.post(`${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-api-key`, {
      data: { postBody, requestUri: 'http://127.0.0.1:5273', returnSecureToken: true },
    });
    expect(res.ok()).toBe(true);
    const { localId } = await res.json();
    await getAuth(admin).setCustomUserClaims(localId, { admin: true });
    return { uid: localId, token };
  };

  const owner = await register('owner-test');
  const other = await register('blocked-test');
  await deleteApp(admin);
  await setDocument('scanSamples/corrected-odometer', { kind: 'odometer', createdAt: Date.now(), outcome: 'read',
    fallback: 'read', source: 'file', guess: '12000', final: '12001' });
  await setDocument('ownerConsole/access', { uid: owner.uid });
  await setDocument('ownerConsole/telemetry', { version: 1, checkedAt: Date.now(), probes: [], backups: [], latency: null, inventory: { users: 2 } });
  await page.route('**/build-info.json', route => route.fulfill({ json: { version: '1.11.7', dirty: false, commit: 'a'.repeat(40) } }));
  await page.route('https://data.gov.il/api/**', route => route.fulfill({ json: { success: true } }));
  await page.route('https://api.github.com/repos/**', route => route.fulfill({ json: { workflow_runs: [] } }));
  const signIn = (token: string) => page.evaluate(async token => {
    const sdk = '/node_modules/.vite/deps/firebase_auth.js';
    const firebase = '/src/lib/firebase.ts';
    const { signInWithCredential, GoogleAuthProvider } = await import(/* @vite-ignore */ sdk);
    const { auth } = await import(/* @vite-ignore */ firebase);
    await signInWithCredential(auth, GoogleAuthProvider.credential(token));
  }, token);

  await signIn(other.token);
  await expect(page.getByRole('heading', { name: 'הגישה שמורה לבעלים' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'מדורי הקונסולה' })).toHaveCount(0);
  await signIn(owner.token);
  await expect(page.getByRole('heading', { name: 'מצב כללי' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'מדורי הקונסולה' });
  await expect(page.getByRole('heading', { name: 'דורש בדיקה' })).toBeVisible();
  await nav.getByRole('link', { name: 'סריקות', exact: true }).click();
  await page.getByLabel('סוג צג', { exact: true }).selectOption('odometer');
  await page.getByLabel('אופן הקריאה', { exact: true }).selectOption('read');
  await page.getByLabel('תוצאת הסריקה').selectOption('corrected');
  await page.getByLabel('פילוח ניסיונות').selectOption('source');
  await page.getByRole('button', { name: 'תמונה מהמכשיר · 1' }).click();
  await page.getByRole('button', { name: 'פרטים', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'פרטי ניסיון · נקרא ותוקן' })).toBeVisible();
  await page.getByRole('button', { name: 'איפוס מסננים' }).click();
  await expect(page.getByLabel('סוג צג', { exact: true })).toHaveValue('');
  await page.getByRole('link', { name: 'תוצאות Gemini' }).click();
  await expect(page.getByRole('heading', { name: 'מה קרה להצעות הסריקה?' })).toBeVisible();
  await expect(page.getByRole('row', { name: /קילומטראז׳/ })).toBeVisible();
  await page.getByRole('button', { name: 'הצעה שתוקנה · 1' }).click();
  await expect(page.getByRole('heading', { name: 'הצעה שתוקנה' })).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'חיפוש מדור' });
  await search.fill('no-such-section');
  await expect(page.getByText('לא נמצא מדור מתאים.')).toBeVisible();
  await search.fill('סנכרון');
  await page.getByRole('navigation', { name: 'תוצאות חיפוש במדורים' }).getByRole('link', { name: 'הצטרפות וסנכרון' }).click();
  await page.getByRole('radio', { name: 'שמירה וסנכרון' }).click();
  await expect(page.getByRole('heading', { name: 'שמירות ואישורי שרת' })).toBeVisible();
  await nav.getByText('כלי עזר', { exact: true }).click();
  await nav.getByRole('link', { name: 'קטלוג האוספים' }).click();
  await expect(page.getByRole('row', { name: /פרופילים.*users.*2/ })).toBeVisible();
  await nav.getByRole('link', { name: 'גישה ואבטחה' }).click();
  await expect(page.getByText('מאומתת', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'מדורי ניהול' })).toBeVisible();
  await expect(nav).toHaveCount(0);
  await page.getByRole('button', { name: 'תוצאות Gemini' }).click();
  await expect(page.getByRole('heading', { name: 'מה קרה להצעות הסריקה?' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
