import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { WEB_PUSH_PUBLIC_KEY } from './config';

export type PushPlatform = 'ios' | 'android' | 'desktop';
/**
 * on / off: push works here. needsInstall: an iPhone or iPad in the browser — Apple delivers
 * web push only to an app added to the home screen. denied: blocked in the system or browser
 * settings. unsupported: this browser (or a development build without a service worker) cannot.
 */
export type PushStatus = 'on' | 'off' | 'needsInstall' | 'denied' | 'unsupported';

export function pushPlatform(nav: Navigator = navigator): PushPlatform {
  const ua = nav.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)) return 'ios';
  return /Android/.test(ua) ? 'android' : 'desktop';
}

function standalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function pushCapable(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushCapable()) return null;
  // A development server has no service worker; `ready` would never settle there.
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/**
 * `on` means this account is registered on this device: the browser holds a subscription AND
 * its document is under this account. A subscription left by another account that used this
 * browser reads as `off`, so the toggle never claims notifications that will not arrive.
 */
export async function pushStatus(uid?: string | null): Promise<PushStatus> {
  if (pushPlatform() === 'ios' && !standalone()) return 'needsInstall';
  const reg = await registration();
  if (!reg) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const subscription = Notification.permission === 'granted' ? await reg.pushManager.getSubscription() : null;
  if (!subscription || !uid) return 'off';
  // Offline with nothing cached the document cannot be checked; the subscription alone is the best evidence.
  const mine = await getDoc(doc(db, 'users', uid, 'pushSubscriptions', await subscriptionId(subscription.endpoint))).then(snapshot => snapshot.exists(), () => true);
  return mine ? 'on' : 'off';
}

/** A stable document id per push endpoint, so the same phone never registers twice. */
export async function subscriptionId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].slice(0, 20).map(b => b.toString(16).padStart(2, '0')).join('');
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - base64url.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Must run from a tap: the permission prompt needs a user gesture (always on iOS). */
export async function enablePush(uid: string): Promise<PushStatus> {
  const reg = await registration();
  if (!reg) return pushPlatform() === 'ios' && !standalone() ? 'needsInstall' : 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  // Enabling starts from `off`, so a subscription still held here belongs to another account or
  // lost its document. Replace it: the old address stops working and the sender drops its record.
  await (await reg.pushManager.getSubscription())?.unsubscribe();
  const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(WEB_PUSH_PUBLIC_KEY) });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('push-subscription-incomplete');
  await setDoc(doc(db, 'users', uid, 'pushSubscriptions', await subscriptionId(json.endpoint)), {
    endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, platform: pushPlatform(), createdAt: Date.now(),
  });
  return 'on';
}

export async function disablePush(uid: string): Promise<PushStatus> {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) {
    await deleteDoc(doc(db, 'users', uid, 'pushSubscriptions', await subscriptionId(subscription.endpoint)));
    await subscription.unsubscribe();
  }
  return 'off';
}

/**
 * Sign-out: this device must stop receiving the account's reminders. The subscription is
 * cancelled first, which works offline and makes the address dead (the sender then removes
 * its record); deleting the record is attempted briefly and never delays the sign-out.
 */
export async function releasePush(uid: string, waitMs = 3000): Promise<void> {
  const subscription = await (await registration().catch(() => null))?.pushManager.getSubscription().catch(() => null);
  if (!subscription) return;
  const id = await subscriptionId(subscription.endpoint);
  await subscription.unsubscribe().catch(() => false);
  await Promise.race([deleteDoc(doc(db, 'users', uid, 'pushSubscriptions', id)).catch(() => {}), new Promise(resolve => setTimeout(resolve, waitMs))]);
}
