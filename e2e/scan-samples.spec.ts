import { expect, test } from '@playwright/test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { ALICE, signIn, signOut, signedInWithData } from './helpers/app';
import { PROJECT_ID, listDocuments } from './helpers/emulator';

/**
 * Every scan attempt is recorded with the rows the engine cut out; saving the fill-up attaches
 * the saved numbers; the Admin "סריקה" tab measures accuracy from those records.
 */
test('scan attempts are recorded, labelled by the saved fill-up, and measured in Admin', async ({ page }) => {
  const sharp = (await import('sharp')).default, { demoPhoto } = await import('../src/lib/scan/fixtures');
  const png = async (kind: 'pump' | 'odometer') => { const raw = demoPhoto(kind); return sharp(Buffer.from(raw.data), { raw: { width: raw.width, height: raw.height, channels: 4 } }).png().toBuffer(); };
  const blank = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#777' } }).png().toBuffer();
  const scope = await signedInWithData(page, { fillups: [] });
  await page.goto('/fillup/new'); await page.getByTestId('fillup-camera').click();
  const dialog = page.getByRole('dialog', { name: 'תדלוק בשני צילומים', exact: true });
  await expect(dialog.getByText('קטעים מהצילום נשמרים לשיפור הזיהוי', { exact: false })).toBeVisible();

  // First try: nothing readable. Second try: the pump. Then the odometer.
  await dialog.locator('input[aria-label="תמונת משאבה"]').setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: blank });
  await expect(dialog.getByText('הספרות עדיין לא ברורות מספיק', { exact: false })).toBeVisible();
  await dialog.locator('input[aria-label="תמונת משאבה"]').setInputFiles({ name: 'pump.png', mimeType: 'image/png', buffer: await png('pump') });
  await expect(dialog.getByText('המשאבה נקראה', { exact: true })).toBeVisible();
  await dialog.locator('input[aria-label="תמונת קילומטראז׳"]').setInputFiles({ name: 'odometer.png', mimeType: 'image/png', buffer: await png('odometer') });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('fillup-total')).toHaveValue('287.60');
  await expect(page.getByTestId('fillup-odometer')).toHaveValue('128450');

  const mine = async (name: string) => (await listDocuments(name)).filter(d => d.data.uid === scope.uid);
  await expect(async () => expect(await mine('scanSamples')).toHaveLength(3)).toPass();
  let samples = (await mine('scanSamples')).map(d => d.data);
  const pick = (kind: string, attempt: number) => samples.find(s => s.kind === kind && s.attempt === attempt)!;
  expect(pick('pump', 1)).toMatchObject({ outcome: 'unreadable', source: 'file', final: null, result: null, journal: false, engine: 2 });
  expect(pick('pump', 2)).toMatchObject({ outcome: 'read', guess: '287.60|40.000', final: null });
  expect(pick('odometer', 1)).toMatchObject({ outcome: 'read', guess: '128450', final: null });
  expect(new Set(samples.map(s => s.session)).size).toBe(1);
  const images = await mine('scanImages');
  // The unreadable grey picture has no rows, only a thumbnail; the read ones carry their rows and no thumbnail.
  expect(images.filter(d => (d.data.strips as unknown[]).length > 0 && d.data.thumb === null)).toHaveLength(2);
  expect(images.filter(d => (d.data.strips as unknown[]).length === 0 && d.data.thumb !== null)).toHaveLength(1);
  for (const d of images) for (const s of d.data.strips as { jpeg: string; h: number }[]) { expect(s.h).toBe(64); expect(s.jpeg.length).toBeGreaterThan(200); }

  // The person corrects the odometer by one and saves: the pump reading was right, the odometer one was corrected.
  await page.getByTestId('fillup-odometer').fill('128451');
  await page.getByRole('button', { name: /שמירת תדלוק/ }).click();
  await expect(async () => {
    samples = (await mine('scanSamples')).map(d => d.data);
    expect(pick('pump', 1)).toMatchObject({ final: '287.60|40.000', result: 'manual' });
    expect(pick('pump', 2)).toMatchObject({ final: '287.60|40.000', result: 'match' });
    expect(pick('odometer', 1)).toMatchObject({ final: '128451', result: 'corrected' });
  }).toPass();

  // Admin: the same three attempts, measured.
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${process.env.CARE_AUTH_PORT ?? '9099'}`;
  const adminApp = initializeApp({ projectId: PROJECT_ID }, `scan-samples-${Date.now()}`);
  await getAuth(adminApp).setCustomUserClaims(scope.uid, { admin: true }); await deleteApp(adminApp);
  await signOut(page); await signIn(page, ALICE);
  await page.goto('/admin'); await page.getByRole('button', { name: 'סריקה', exact: true }).click();
  const summary = page.getByRole('region', { name: 'דיוק הסריקה', exact: true });
  await expect(summary.locator('.admin-tile').nth(0)).toContainText('3');
  await expect(summary.locator('.admin-tile').nth(1)).toContainText('67%');   // 2 of 3 attempts showed a reading
  await expect(summary.locator('.admin-tile').nth(2)).toContainText('33%');   // 1 of 3 saved attempts was shown and right
  await expect(summary.locator('.admin-tile').nth(3)).toContainText('50');    // 1 of the 2 shown readings was corrected
  const tries = page.getByRole('region', { name: 'כמה ניסיונות נדרשו', exact: true });
  await expect(tries.getByText('בניסיון הראשון', { exact: true }).locator('..')).toContainText('50%');
  await expect(tries.getByText('בניסיון השני', { exact: true }).locator('..')).toContainText('50%');
  const problems = page.getByRole('region', { name: 'קריאות שלא הצליחו', exact: true });
  await expect(problems.locator('.admin-scan-problem')).toHaveCount(2);
  const corrected = problems.locator('.admin-scan-problem', { hasText: 'נקרא ותוקן' });
  await expect(corrected).toContainText('128451'); await expect(corrected).toContainText('128450');
  await corrected.getByRole('button', { name: 'הצגת מה שהמנוע ראה', exact: true }).click();
  await expect(corrected.locator('img')).toHaveCount(1);
  expect(await corrected.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalHeight === 64)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('one fill-up is one scan session; labels survive a reload, skip an undone save and hand-typed amounts', async ({ page }) => {
  const sharp = (await import('sharp')).default, { demoPhoto } = await import('../src/lib/scan/fixtures');
  const png = async (kind: 'pump' | 'odometer') => { const raw = demoPhoto(kind); return sharp(Buffer.from(raw.data), { raw: { width: raw.width, height: raw.height, channels: 4 } }).png().toBuffer(); };
  const blank = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#777' } }).png().toBuffer();
  const scope = await signedInWithData(page, { fillups: [] });
  const mine = async () => (await listDocuments('scanSamples')).filter(d => d.data.uid === scope.uid).map(d => d.data);
  const dialog = page.getByRole('dialog', { name: 'תדלוק בשני צילומים', exact: true });

  // Opened twice for one fill-up: the second opening continues the same session (attempt 2, not 1 again).
  await page.goto('/fillup/new'); await page.getByTestId('fillup-camera').click();
  await dialog.locator('input[aria-label="תמונת משאבה"]').setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: blank });
  await expect(dialog.getByText('הספרות עדיין לא ברורות מספיק', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'סגירה', exact: true }).click();
  await page.getByTestId('fillup-camera').click();
  await dialog.locator('input[aria-label="תמונת משאבה"]').setInputFiles({ name: 'pump.png', mimeType: 'image/png', buffer: await png('pump') });
  await dialog.locator('input[aria-label="תמונת קילומטראז׳"]').setInputFiles({ name: 'odometer.png', mimeType: 'image/png', buffer: await png('odometer') });
  await expect(page.getByTestId('fillup-total')).toHaveValue('287.60');
  await expect(async () => expect(await mine()).toHaveLength(3)).toPass();
  let samples = await mine();
  expect(new Set(samples.map(s => s.session)).size).toBe(1);
  expect(samples.filter(s => s.kind === 'pump').map(s => s.attempt).sort()).toEqual([1, 2]);

  // A reload before saving: the draft brings the attempts back, and saving labels them.
  await page.reload();
  await expect(page.getByTestId('fillup-total')).toHaveValue('287.60');
  await page.getByRole('button', { name: /שמירת תדלוק/ }).click();
  // Reloaded right after saving, inside the undo window: the labels still arrive.
  await expect(page.getByTestId('fillup-saved-undo')).toBeVisible();
  await page.reload();
  await expect(async () => { samples = await mine(); expect(samples.filter(s => s.final !== null)).toHaveLength(3); }).toPass({ timeout: 20_000 });
  expect(samples.map(s => s.result).sort()).toEqual(['manual', 'match', 'match']);

  // Saved, then undone within the five seconds: those attempts are never labelled.
  await page.goto('/fillup/new'); await page.getByTestId('fillup-camera').click();
  await dialog.locator('input[aria-label="תמונת משאבה"]').setInputFiles({ name: 'pump.png', mimeType: 'image/png', buffer: await png('pump') });
  await dialog.locator('input[aria-label="תמונת קילומטראז׳"]').setInputFiles({ name: 'odometer.png', mimeType: 'image/png', buffer: await png('odometer') });
  await expect(page.getByTestId('fillup-odometer')).toHaveValue('128450');
  await page.getByTestId('fillup-odometer').fill('128460');
  await page.getByRole('button', { name: /שמירת תדלוק/ }).click();
  await page.getByTestId('fillup-saved-undo').click();
  await expect(async () => expect(await mine()).toHaveLength(5)).toPass();
  await page.waitForTimeout(7_000);
  samples = await mine();
  expect(samples.filter(s => s.final === null)).toHaveLength(2);

  // The amount was typed before scanning: the pump reading is not applied, so it is not labelled.
  await page.goto('/fillup/new');
  await page.getByTestId('fillup-total').fill('285');
  await page.getByTestId('fillup-camera').click();
  await dialog.locator('input[aria-label="תמונת משאבה"]').setInputFiles({ name: 'pump.png', mimeType: 'image/png', buffer: await png('pump') });
  await dialog.locator('input[aria-label="תמונת קילומטראז׳"]').setInputFiles({ name: 'odometer.png', mimeType: 'image/png', buffer: await png('odometer') });
  await expect(page.getByTestId('fillup-total')).toHaveValue('285');
  await expect(async () => expect(await mine()).toHaveLength(7)).toPass();
  await page.getByRole('button', { name: /שמירת תדלוק/ }).click();
  await expect(async () => { samples = await mine(); expect(samples.filter(s => s.final !== null)).toHaveLength(4); }).toPass({ timeout: 15_000 });
  const latestSession = samples.find(s => s.kind === 'pump' && s.final === null && s.attempt === 1 && samples.filter(o => o.session === s.session).length === 2 && samples.some(o => o.session === s.session && o.kind === 'odometer' && o.final !== null));
  expect(latestSession).toBeTruthy();
});
