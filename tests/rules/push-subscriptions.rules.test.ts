import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'B' + 'k'.repeat(86), auth: 'a'.repeat(22), platform: 'android', createdAt: 1_794_000_000_000 };
const as = (uid: string) => env.authenticatedContext(uid).firestore();
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-push-rules', firestore: {
    host: '127.0.0.1', port: Number(process.env.RULES_FIRESTORE_PORT ?? 8080), rules: readFileSync('firestore.rules', 'utf8'),
  } });
}, 60_000);
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env?.cleanup(); });

describe('push subscriptions', () => {
  it('the owner registers, reads and removes a device', async () => {
    const ref = doc(as('alice'), 'users/alice/pushSubscriptions/d1');
    await assertSucceeds(setDoc(ref, sub));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(deleteDoc(ref));
  });
  it('nobody else can read or write it', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'users/alice/pushSubscriptions/d1'), sub));
    await assertFails(getDoc(doc(as('bob'), 'users/alice/pushSubscriptions/d1')));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/pushSubscriptions/d2'), sub));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/alice/pushSubscriptions/d1')));
  });
  it('rejects extra fields, non-https endpoints and unknown platforms', async () => {
    const ref = doc(as('alice'), 'users/alice/pushSubscriptions/d1');
    for (const bad of [{ ...sub, extra: 1 }, { ...sub, endpoint: 'http://push.example/1' }, { ...sub, endpoint: 'x'.repeat(1001) },
      { ...sub, platform: 'watch' }, { ...sub, auth: 5 }, { endpoint: sub.endpoint }]) await assertFails(setDoc(ref, bad));
  });
  it('accepts the browsers\' push services and nothing else', async () => {
    const ref = doc(as('alice'), 'users/alice/pushSubscriptions/d1');
    for (const endpoint of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/QK1', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-db5p.notify.windows.com/w/?token=x'])
      await assertSucceeds(setDoc(ref, { ...sub, endpoint }));
    for (const endpoint of ['https://attacker.example/hang', 'https://fcm.googleapis.com.attacker.example/x', 'https://notify.windows.com.evil.example/x', 'https://fcm.googleapis.com/'])
      await assertFails(setDoc(ref, { ...sub, endpoint }));
    for (const bad of [{ ...sub, p256dh: 'short' }, { ...sub, p256dh: 'k'.repeat(87) + '!' }, { ...sub, auth: 'x' }])
      await assertFails(setDoc(ref, bad));
  });
  it('is closed while the account is being deleted', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'users/alice'), { deletionPending: true }));
    await assertFails(setDoc(doc(as('alice'), 'users/alice/pushSubscriptions/d1'), sub));
  });
});

describe('push sent log', () => {
  it('is server-written: the owner may read and delete it but never write it', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'users/alice/pushSent/s1'), { occurrence: 'doc:test', sentAt: 1 }));
    await assertSucceeds(getDoc(doc(as('alice'), 'users/alice/pushSent/s1')));
    await assertFails(setDoc(doc(as('alice'), 'users/alice/pushSent/s2'), { occurrence: 'x', sentAt: 1 }));
    await assertFails(getDoc(doc(as('bob'), 'users/alice/pushSent/s1')));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'users/alice/pushSent/s1')));
  });
});
