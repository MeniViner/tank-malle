import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { deleteDoc, doc, runTransaction } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { PushStatus } from '../push/client';
import { clearNativeReminders } from './reminders';

export interface RemoteTap { uid?: string; route?: string }
interface TankRemotePushPlugin {
  available(): Promise<{ available: boolean }>;
  getToken(): Promise<{ token: string }>;
  setOwner(options: { uid: string }): Promise<void>;
  clearOwner(): Promise<void>;
  openSettings(): Promise<void>;
  takeTap(): Promise<RemoteTap>;
  addListener(event: 'tap', callback: (tap: RemoteTap) => void): Promise<PluginListenerHandle>;
}

export const TankRemotePush = registerPlugin<TankRemotePushPlugin>('TankRemotePush');
const OWNER = 'tm.native.push.owner';
const INSTALL = 'tm.native.push.install';
const localUid = () => localStorage.getItem(OWNER);
const available = () => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('TankRemotePush');
const deviceRef = (uid: string, id: string) => doc(db, 'users', uid, 'nativePushDevices', id);
let pending = Promise.resolve();
let epoch = 0;

function serialize<T>(action: () => Promise<T>) {
  const next = pending.then(action);
  pending = next.then(() => {}, () => {});
  return next;
}

export async function remotePushConfigured() {
  return available() && (await TankRemotePush.available()).available;
}

export async function remotePushStatus(uid?: string | null): Promise<PushStatus> {
  const { display } = await LocalNotifications.checkPermissions();
  if (display === 'denied') return 'denied';
  return display === 'granted' && uid && uid === localUid() ? 'on' : 'off';
}

async function register(uid: string, current: () => boolean) {
  if (!current() || !navigator.onLine) throw new Error('Device is offline or signed out');
  const token = (await TankRemotePush.getToken()).token;
  if (!/^[A-Za-z0-9_:-]{40,512}$/.test(token) || !current()) throw new Error('Device registration interrupted');
  const id = localStorage.getItem(INSTALL) ?? crypto.randomUUID();
  localStorage.setItem(INSTALL, id);
  const ref = deviceRef(uid, id);
  await runTransaction(db, async transaction => {
    const existing = await transaction.get(ref);
    if (!current()) throw new Error('Account changed');
    if (existing.data()?.token !== token) transaction.set(ref, { token, platform: 'android', createdAt: Date.now() });
  });
  if (!current()) return 'off' as const;
  localStorage.setItem(OWNER, uid);
  try {
    await TankRemotePush.setOwner({ uid });
  } catch (error) {
    if (localUid() === uid) localStorage.removeItem(OWNER);
    throw error;
  }
  return current() ? 'on' as const : 'off' as const;
}

export async function enableRemotePush(uid: string, current: () => boolean): Promise<PushStatus> {
  const started = epoch;
  const stillCurrent = () => current() && started === epoch;
  const { display } = await LocalNotifications.requestPermissions();
  if (display !== 'granted' || !stillCurrent()) return display === 'denied' ? 'denied' : 'off';
  return serialize(async () => {
    const result = await register(uid, stillCurrent);
    if (result === 'on') await clearNativeReminders().catch(() => {});
    return result;
  });
}

export function refreshRemotePush(uid: string, current: () => boolean) {
  if (!available() || localUid() !== uid) return Promise.resolve();
  return serialize(async () => {
    if (localUid() !== uid || !current() || (await LocalNotifications.checkPermissions()).display !== 'granted') return;
    await register(uid, () => current() && localUid() === uid);
  });
}

export async function releaseRemotePush(uid: string) {
  if (!available()) return;
  epoch++;
  if (localUid() !== uid) return;
  const id = localStorage.getItem(INSTALL);
  // Native delivery checks this owner even if the device signs out offline.
  await TankRemotePush.clearOwner();
  if (localUid() === uid) localStorage.removeItem(OWNER);
  if (id && auth.currentUser?.uid === uid) {
    await Promise.race([deleteDoc(deviceRef(uid, id)), new Promise(resolve => setTimeout(resolve, 2500))]);
  }
}
