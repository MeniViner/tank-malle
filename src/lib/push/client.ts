import { deleteDoc, doc, setDoc } from 'firebase/firestore';
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

export async function pushStatus(): Promise<PushStatus> {
  if (pushPlatform() === 'ios' && !standalone()) return 'needsInstall';
  const reg = await registration();
  if (!reg) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && await reg.pushManager.getSubscription() ? 'on' : 'off';
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
  const subscription = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(WEB_PUSH_PUBLIC_KEY) });
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
