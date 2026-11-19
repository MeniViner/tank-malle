import { expect, test } from '@playwright/test';
import { signedInWithData } from './helpers/app';

/**
 * A pump photo chosen from the device fills the station nearest to where it was taken and the
 * time it was taken (EXIF), read on the device. A date or station chosen by hand is kept.
 */
test.use({ serviceWorkers: 'block' });

/** JPEG APP1 "Exif" with DateTimeOriginal (+offset) and GPS, little-endian, the way phone cameras write it. */
function exifSegment(takenAt: Date, lat: number, lng: number): Buffer {
  const u16 = (v: number) => [v & 255, v >> 8];
  const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24];
  const dms = (value: number) => { const d = Math.floor(value), m = Math.floor((value - d) * 60), s = Math.round(((value - d) * 60 - m) * 60 * 10000); return [[d, 1], [m, 1], [s, 10000]]; };
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${takenAt.getUTCFullYear()}:${pad(takenAt.getUTCMonth() + 1)}:${pad(takenAt.getUTCDate())} ${pad(takenAt.getUTCHours())}:${pad(takenAt.getUTCMinutes())}:${pad(takenAt.getUTCSeconds())}`;
  type Tag = [number, 2 | 4 | 5, string | number | number[][]];
  const root: Tag[] = [[0x8769, 4, 0], [0x8825, 4, 0]];
  const exif: Tag[] = [[0x9003, 2, stamp], [0x9011, 2, '+00:00']];
  const gps: Tag[] = [[1, 2, 'N'], [2, 5, dms(lat)], [3, 2, 'E'], [4, 5, dms(lng)]];
  const ifds = [root, exif, gps], starts: number[] = [];
  let at = 8; for (const tags of ifds) { starts.push(at); at += 2 + tags.length * 12 + 4; }
  root[0][2] = starts[1]; root[1][2] = starts[2];
  const out: number[] = [0x49, 0x49, ...u16(42), ...u32(8)], blobs: number[] = [];
  for (const tags of ifds) {
    out.push(...u16(tags.length));
    for (const [tag, type, value] of tags) {
      const bytes = type === 2 ? [...String(value)].map(c => c.charCodeAt(0)).concat(0) : type === 4 ? u32(Number(value)) : (value as number[][]).flatMap(([n, d]) => [...u32(n), ...u32(d)]);
      const count = type === 5 ? (value as number[][]).length : type === 4 ? 1 : bytes.length;
      out.push(...u16(tag), ...u16(type), ...u32(count));
      if (bytes.length <= 4) out.push(...bytes, ...Array(4 - bytes.length).fill(0)); else { out.push(...u32(at)); blobs.push(...bytes); at += bytes.length; }
    }
    out.push(...u32(0));
  }
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...out, ...blobs], length = payload.length + 2;
  return Buffer.from([0xff, 0xe1, length >> 8, length & 255, ...payload]);
}

async function pumpPhoto(takenAt: Date): Promise<Buffer> {
  const sharp = (await import('sharp')).default, { demoPhoto } = await import('../src/lib/scan/fixtures');
  const raw = demoPhoto('pump');
  const jpeg = await sharp(Buffer.from(raw.data), { raw: { width: raw.width, height: raw.height, channels: 4 } }).jpeg({ quality: 95 }).toBuffer();
  // דלק דורון - כפר סבא, from public/fuel-stations.json, about 20 m away.
  return Buffer.concat([jpeg.subarray(0, 2), exifSegment(takenAt, 32.17410, 34.89080), jpeg.subarray(2)]);
}

test('a chosen pump photo fills the nearest station and the time it was taken', async ({ page }) => {
  await signedInWithData(page, { fillups: [] });
  await page.goto('/fillup/new');
  await expect(page.getByTestId('fillup-station')).toContainText('בחירת תחנה');
  await page.getByTestId('fillup-camera').click();
  const dialog = page.getByRole('dialog', { name: 'תדלוק בשני צילומים', exact: true });
  const takenAt = new Date(Date.now() - 3 * 3_600_000);
  takenAt.setUTCSeconds(0, 0);
  await dialog.locator('input[aria-label="תמונת משאבה"]').setInputFiles({ name: 'pump.jpg', mimeType: 'image/jpeg', buffer: await pumpPhoto(takenAt) });
  await expect(dialog.getByText('המשאבה נקראה', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(page.getByTestId('fillup-station')).toContainText('דלק דורון - כפר סבא');
  await expect(page.getByTestId('fillup-station')).toContainText('לפי מיקום');
  await expect(page.getByTestId('fillup-date')).toContainText('לפי התמונה');
  const shown = await page.evaluate((ms) => new Date(ms).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false }), takenAt.getTime());
  await expect(page.getByTestId('fillup-date')).toContainText(shown);
});

test('a date chosen by hand is not replaced by the photo time', async ({ page }) => {
  await signedInWithData(page, { fillups: [] });
  await page.goto('/fillup/new');
  await page.getByTestId('fillup-date').click();
  await page.getByRole('dialog').getByRole('button', { name: 'עכשיו', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'אישור', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('fillup-camera').click();
  const dialog = page.getByRole('dialog', { name: 'תדלוק בשני צילומים', exact: true });
  await dialog.locator('input[aria-label="תמונת משאבה"]').setInputFiles({ name: 'pump.jpg', mimeType: 'image/jpeg', buffer: await pumpPhoto(new Date(Date.now() - 5 * 3_600_000)) });
  await expect(dialog.getByText('המשאבה נקראה', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fillup-station')).toContainText('דלק דורון - כפר סבא');
  await expect(page.getByTestId('fillup-date')).not.toContainText('לפי התמונה');
});
