import { beforeEach, describe, expect, it, vi } from 'vitest';

const docs = new Set<string>(), calls: string[] = [];
vi.mock('../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  getDoc: async (path: string) => ({ exists: () => docs.has(path) }),
  setDoc: async (path: string) => { docs.add(path); calls.push(`set ${path.split('/')[1]}`); },
  deleteDoc: async (path: string) => { docs.delete(path); calls.push(`delete ${path.split('/')[1]}`); },
}));
import { disablePush, enablePush, pushStatus, releasePush, subscriptionId } from './client';

let current: { endpoint: string; unsubscribe: () => Promise<boolean>; toJSON: () => unknown } | null = null, serial = 0;
const subscribe = async () => {
  const endpoint = `https://push.test/${++serial}`;
  current = { endpoint, unsubscribe: async () => { calls.push(`unsubscribe ${endpoint.at(-1)}`); current = null; return true; }, toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }) };
  return current;
};

beforeEach(() => {
  docs.clear(); calls.length = 0; current = null; serial = 0;
  const pushManager = { getSubscription: async () => current, subscribe };
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: async () => 'granted' });
  vi.stubGlobal('navigator', { userAgent: 'Android', maxTouchPoints: 0, serviceWorker: { getRegistration: async () => ({ pushManager }) } });
  vi.stubGlobal('window', { PushManager: class {}, Notification: {} });
});

describe('phone notifications on a shared browser', () => {
  it('is on only for the account whose record is on this device', async () => {
    expect(await enablePush('alice')).toBe('on');
    expect(await pushStatus('alice')).toBe('on');
    expect(await pushStatus('bob')).toBe('off');
    expect(await pushStatus(null)).toBe('off');
  });
  it('signing out cancels the subscription and removes the record', async () => {
    await enablePush('alice');
    const id = await subscriptionId('https://push.test/1');
    await releasePush('alice');
    expect(current).toBeNull();
    expect(docs.has(`users/alice/pushSubscriptions/${id}`)).toBe(false);
    expect(await pushStatus('alice')).toBe('off');
  });
  it('another account enabling on a browser that still holds a subscription gets a new address, so the old one dies', async () => {
    await enablePush('alice');
    calls.length = 0;
    expect(await enablePush('bob')).toBe('on');
    expect(calls).toEqual(['unsubscribe 1', 'set bob']);
    expect(current?.endpoint).toBe('https://push.test/2');
    expect(await pushStatus('bob')).toBe('on');
  });
  it('turning off removes the record of the signed-in account and the subscription', async () => {
    await enablePush('alice');
    expect(await disablePush('alice')).toBe('off');
    expect(docs.size).toBe(0);
    expect(current).toBeNull();
  });
});
