import { describe, expect, it } from 'vitest';
import { notificationId } from '../vehicle/model';
import { runPush, type PushMessage, type PushStore, type PushSubscriptionRow, type RawDoc, type SendResult } from './run';

const plan = (id: string, dueDay: string): RawDoc => ({ id, schemaVersion: 1, version: 1, title: `טיפול ${id}`, job: 'periodic', dueDay, dueOdometer: null,
  intervalMonths: null, intervalKm: null, basis: 'manual', source: 'owner', notes: '', active: true });

function fakeStore(over: { plans?: RawDoc[]; vehicles?: RawDoc[]; profile?: Record<string, unknown> | null; devices?: string[]; states?: RawDoc[]; fillups?: RawDoc[]; users?: string[]; broken?: string } = {}) {
  const sent = new Map<string, string>(), removed: string[] = [], reads: string[] = [];
  const subs: PushSubscriptionRow[] = (over.users ?? ['alice']).flatMap(uid => (over.devices ?? ['d1']).map(id => ({ uid, id, endpoint: `https://push/${id}`, p256dh: 'k', auth: 'a' })));
  const store: PushStore = {
    subscriptions: async () => subs.filter(s => !removed.includes(s.id)),
    profile: async uid => { if (uid === over.broken) throw new Error('quota'); return over.profile === undefined ? { settings: {} } : over.profile; },
    vehicles: async () => over.vehicles ?? [{ id: 'v1', nickname: 'המשפחתית', archived: false }],
    collection: async (_uid, vehicleId, name) => { reads.push(name); return vehicleId !== 'v1' ? [] : name === 'maintenancePlans' ? over.plans ?? [plan('a', '2026-11-12')]
      : name === 'notificationStates' ? over.states ?? [] : []; },
    latest: async (_uid, _vehicleId, name, _field, limit) => { reads.push(`latest ${name}`); return name === 'fillups' ? (over.fillups ?? []).slice(0, limit) : []; },
    sentIds: async (uid, ids) => new Set(ids.filter(id => sent.has(`${uid}/${id}`))),
    markSent: async (uid, items) => { for (const item of items) sent.set(`${uid}/${item.id}`, item.occurrence); },
    removeSubscription: async (_uid, id) => { removed.push(id); },
  };
  return { store, sent, removed, reads };
}
const sender = (results: Record<string, SendResult> | ((device: string, message: PushMessage) => SendResult) = {}) => {
  const calls: { device: string; message: PushMessage }[] = [];
  return { calls, send: async (device: PushSubscriptionRow, message: PushMessage) => { calls.push({ device: device.id, message });
    return typeof results === 'function' ? results(device.id, message) : results[device.id] ?? 'sent'; } };
};
const at = { today: '2026-11-11', now: 1 };

describe('runPush', () => {
  it('sends a due reminder once to every device, then never again', async () => {
    const { store, sent } = fakeStore({ devices: ['d1', 'd2'] }), s = sender();
    expect(await runPush(store, s.send, at)).toMatchObject({ users: 1, devices: 2, messages: 2, occurrences: 1 });
    expect(s.calls.map(c => c.device)).toEqual(['d1', 'd2']);
    expect(s.calls[0].message).toMatchObject({ title: 'טיפול a', body: 'הטיפול מתקרב', url: '/open?vehicle=v1&to=%2Fvehicle%2Freminders%2Fa' });
    expect(sent.size).toBe(1);
    const again = sender();
    expect(await runPush(store, again.send, at)).toMatchObject({ messages: 0 });
    expect(again.calls).toHaveLength(0);
  });
  it('more than three new items become one summary pointing at the notifications list', async () => {
    const { store, sent } = fakeStore({ plans: ['a', 'b', 'c', 'd'].map(id => plan(id, '2026-11-12')) }), s = sender();
    await runPush(store, s.send, at);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].message).toMatchObject({ title: '4 התראות חדשות', url: '/notifications', tag: 'digest' });
    expect(sent.size).toBe(4);
  });
  it('removes an expired device and keeps the occurrence unsent when no device accepted it', async () => {
    const { store, sent, removed } = fakeStore({ devices: ['gone', 'flaky'] });
    const report = await runPush(store, sender({ gone: 'gone', flaky: 'failed' }).send, at);
    expect(report).toMatchObject({ removed: 1, failed: 1, occurrences: 0 });
    expect(removed).toEqual(['gone']);
    expect(sent.size).toBe(0);
  });
  it('skips accounts being deleted, archived vehicles, and what the user archived in the app', async () => {
    const s = sender();
    await runPush(fakeStore({ profile: { deletionPending: true } }).store, s.send, at);
    await runPush(fakeStore({ vehicles: [{ id: 'v1', archived: true }] }).store, s.send, at);
    const occurrence = `reminder:a:2026-11-12:-:initial`;
    await runPush(fakeStore({ states: [{ id: notificationId(occurrence), schemaVersion: 1, version: 1, occurrence, read: false, archived: true, snoozeUntilDay: null }] }).store, s.send, at);
    expect(s.calls).toHaveLength(0);
  });
  it('a dry run counts without sending or recording', async () => {
    const { store, sent } = fakeStore(), s = sender();
    expect(await runPush(store, s.send, { ...at, dryRun: true })).toMatchObject({ messages: 1, occurrences: 1 });
    expect(s.calls).toHaveLength(0);
    expect(sent.size).toBe(0);
  });
  it('records only the notifications a device accepted; one that failed everywhere is sent again next run', async () => {
    const { store, sent } = fakeStore({ plans: [plan('a', '2026-11-12'), plan('b', '2026-11-12')] });
    const first = await runPush(store, sender((_device, message) => message.title === 'טיפול b' ? 'failed' : 'sent').send, at);
    expect(first).toMatchObject({ messages: 1, failed: 1, occurrences: 1 });
    expect(sent.size).toBe(1);
    const retry = sender();
    expect(await runPush(store, retry.send, at)).toMatchObject({ messages: 1, occurrences: 1 });
    expect(retry.calls.map(c => c.message.title)).toEqual(['טיפול b']);
    expect(sent.size).toBe(2);
  });
  it('a notification one device refused counts as sent when another device took it', async () => {
    const { store, sent } = fakeStore({ devices: ['d1', 'd2'], plans: [plan('a', '2026-11-12'), plan('b', '2026-11-12')] });
    await runPush(store, sender((device, message) => device === 'd1' && message.title === 'טיפול b' ? 'failed' : 'sent').send, at);
    expect(sent.size).toBe(2);
  });
  it('two vehicles with the same test date each get their own notification, opened on their own vehicle', async () => {
    const docs = { test: { due: '2026-11-20' } };
    const { store, sent } = fakeStore({ plans: [], vehicles: [{ id: 'v1', nickname: 'המשפחתית', docs }, { id: 'v2', nickname: 'השנייה', docs }] }), s = sender();
    expect(await runPush(store, s.send, at)).toMatchObject({ messages: 2, occurrences: 2 });
    expect(s.calls.map(c => c.message.body.split(' · ')[0])).toEqual(['המשפחתית', 'השנייה']);
    expect(s.calls.map(c => c.message.url)).toEqual(['/open?vehicle=v1&to=%2Fvehicle%3Fdoc%3Dtest%26vehicle%3Dv1', '/open?vehicle=v2&to=%2Fvehicle%3Fdoc%3Dtest%26vehicle%3Dv2']);
    expect(new Set(s.calls.map(c => c.message.tag)).size).toBe(2);
    expect(sent.size).toBe(2);
    const again = sender();
    await runPush(store, again.send, at);
    expect(again.calls).toHaveLength(0);
  });
  it('an account whose data cannot be read does not stop the accounts after it', async () => {
    const { store, sent } = fakeStore({ users: ['alice', 'bob', 'carol'], broken: 'bob' }), s = sender(), warnings: string[] = [];
    const report = await runPush(store, s.send, { ...at, warn: message => warnings.push(message) });
    expect(report).toMatchObject({ users: 2, messages: 2, occurrences: 2, errors: 1 });
    expect([...sent.keys()].map(key => key.split('/')[0])).toEqual(['alice', 'carol']);
    expect(warnings).toEqual(['push run failed for one account: quota']);
  });
  it('what a device accepted is recorded even when a later step throws, so it is not pushed twice', async () => {
    const { store, sent } = fakeStore({ devices: ['d1', 'd2'] });
    const report = await runPush(store, async device => { if (device.id === 'd2') throw new Error('socket'); return 'sent'; }, at);
    expect(report).toMatchObject({ messages: 1, occurrences: 1, errors: 1 });
    expect(sent.size).toBe(1);
  });
  it('reads only what the answer needs', async () => {
    const quiet = fakeStore({ plans: [] });
    await runPush(quiet.store, sender().send, at);
    expect(quiet.reads).toEqual(['maintenancePlans']);
    const active = fakeStore();
    await runPush(active.store, sender().send, at);
    expect(active.reads).toEqual(['maintenancePlans', 'serviceEvents', 'odometerReadings', 'latest fillups', 'latest observations', 'notificationStates']);
    const off = fakeStore({ profile: { settings: { reminderNotifications: false } } });
    await runPush(off.store, sender().send, at);
    expect(off.reads).toEqual([]);
  });
  it('a reminder by km is judged by the newest fill-up, and vehicles being deleted are skipped', async () => {
    const byKm = { ...plan('km', '2026-11-12'), dueDay: null, dueOdometer: 180_000 };
    const s = sender();
    await runPush(fakeStore({ plans: [byKm], fillups: [{ id: 'f', date: Date.UTC(2026, 10, 10, 10), odometer: 179_500 }] }).store, s.send, at);
    expect(s.calls.map(c => c.message.title)).toEqual(['טיפול km']);
    const none = sender();
    await runPush(fakeStore({ vehicles: [{ id: 'v1', deletionPending: true }] }).store, none.send, at);
    expect(none.calls).toHaveLength(0);
  });
  it('names the car when the account has several', async () => {
    const { store } = fakeStore({ vehicles: [{ id: 'v1', nickname: 'המשפחתית' }, { id: 'v2', nickname: 'השנייה' }] }), s = sender();
    await runPush(store, s.send, at);
    expect(s.calls[0].message.body).toBe('המשפחתית · הטיפול מתקרב');
  });
});
