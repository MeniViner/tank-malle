import { expect, test } from '@playwright/test';
import { signedInWithData } from './helpers/app';

test('camera zoom crops the scanned pixels with the preview and closes its stream', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Canvas captureStream fixture; physical Android/iPhone cameras are not tested here.');
  await signedInWithData(page, { fillups: [] });
  await page.goto('/fillup/new');
  await page.getByTestId('fillup-camera').click();
  await page.evaluate(() => {
    const fixture = window as typeof window & {
      __zoomPixels?: number[][];
      __zoomStream?: MediaStream;
    };
    fixture.__zoomPixels = [];
    // Keep recognition pending/unreadable so a detected value cannot close the UI.
    window.Worker = class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      postMessage(message: { data: Uint8ClampedArray }) {
        fixture.__zoomPixels!.push(Array.from(message.data.slice(0, 3)));
        setTimeout(() => this.onmessage?.({ data: { status: 'unreadable' } } as MessageEvent), 0);
      }
      terminate() { this.onmessage = null; }
    } as unknown as typeof Worker;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 768;
      const context = canvas.getContext('2d')!;
      const draw = () => {
        context.fillStyle = '#ff0000'; context.fillRect(0, 0, 1024, 768);
        context.fillStyle = '#0000ff'; context.fillRect(256, 192, 512, 384);
      };
      draw();
      const stream = canvas.captureStream(10);
      fixture.__zoomStream = stream;
      const timer = setInterval(() => { if (stream.active) draw(); else clearInterval(timer); }, 80);
      return stream;
    } });
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'פתיחת מצלמה', exact: true }).click();
  const slider = dialog.getByRole('slider', { name: 'זום דיגיטלי', exact: true });
  await expect(slider).toBeVisible();
  await expect(slider).toHaveAttribute('min', '1');
  await expect(slider).toHaveAttribute('max', '4');
  expect((await slider.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect.poll(() => page.evaluate(() => (window as any).__zoomPixels.some((rgb: number[]) => rgb[0] > 240 && rgb[2] < 15))).toBe(true);
  await slider.focus();
  await page.keyboard.press('Home');
  for (let step = 0; step < 10; step++) await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('2');
  await expect(dialog.locator('video')).toHaveCSS('transform', 'matrix(2, 0, 0, 2, 0, 0)');
  await expect.poll(() => page.evaluate(() => (window as any).__zoomPixels.some((rgb: number[]) => rgb[0] < 15 && rgb[2] > 240))).toBe(true);
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveValue('1.9');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'סגירת מצלמה', exact: true }).click();
  await expect(slider).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__zoomStream.getTracks().every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
});
