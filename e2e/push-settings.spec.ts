import { expect, test } from '@playwright/test';
import { signedInWithData } from './helpers/app';
import { listDocuments } from './helpers/emulator';

test('browser push can always be enabled from the bell and registers the current device', async ({ page }) => {
  await page.addInitScript(() => {
    let current: { endpoint: string; toJSON: () => object; unsubscribe: () => Promise<boolean> } | null = null;
    let permission = 'default';
    const endpoint = 'https://fcm.googleapis.com/fcm/send/tank-malle-e2e';
    Object.defineProperty(Notification, 'permission', { get: () => permission, configurable: true });
    Notification.requestPermission = async () => { permission = 'granted'; return 'granted'; };
    navigator.serviceWorker.getRegistration = async () => ({
      pushManager: {
        getSubscription: async () => current,
        subscribe: async () => {
          current = {
            endpoint,
            toJSON: () => ({ endpoint, keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } }),
            unsubscribe: async () => { current = null; return true; },
          };
          return current;
        },
      },
    }) as ServiceWorkerRegistration;
  });
  const { uid } = await signedInWithData(page);
  await page.goto('/notifications');
  await page.getByRole('button', { name: 'הגדרת התראות למכשיר' }).click();
  const section = page.getByTestId('push-section');
  await expect(section).toHaveAttribute('data-push-status', 'off');
  await section.getByRole('switch', { name: 'התראות לטלפון' }).click();
  await expect(section).toHaveAttribute('data-push-status', 'on');
  await expect.poll(async () => (await listDocuments(`users/${uid}/pushSubscriptions`)).length).toBe(1);
  await section.getByRole('switch', { name: 'התראות לטלפון' }).click();
  await expect(section).toHaveAttribute('data-push-status', 'off');
  await expect.poll(async () => (await listDocuments(`users/${uid}/pushSubscriptions`)).length).toBe(0);
});
