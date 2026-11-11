/**
 * Scan samples (`scanSamples`, `scanImages`): the owner creates them, may attach the saved
 * numbers once, and may delete them; an admin reads and deletes; nobody else sees them.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-scan-samples', firestore: {
    host: '127.0.0.1', port: Number(process.env.RULES_FIRESTORE_PORT ?? 8080), rules: readFileSync('firestore.rules', 'utf8') } });
}, 60000);
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const alice = () => env.authenticatedContext('alice').firestore();
const bob = () => env.authenticatedContext('bob').firestore();
const admin = () => env.authenticatedContext('root', { admin: true }).firestore();
const sample = {
  uid: 'alice', createdAt: 1794000000000, day: '2026-11-11', appVersion: '1.9.0', engine: 2, kind: 'odometer', source: 'camera',
  session: 'b6c1e9d2-7a51-4a37-9d59-0f6a8a4f5f10', attempt: 1, outcome: 'read', guess: '168053', confidence: .71, ms: 840, frames: 6,
  seconds: 4.2, width: 1920, height: 1440, journal: true, platform: 'android', final: null, result: null, labeledAt: null,
};
const strip = { role: 'odometer', text: '168053', confidence: .71, w: 420, h: 64, jpeg: 'AAAA' };
const images = { uid: 'alice', createdAt: 1794000000000, strips: [strip], thumb: null };

describe('scanSamples', () => {
  it('the owner creates a well-formed sample; pump and unreadable shapes pass too', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'scanSamples/a'), sample));
    await assertSucceeds(setDoc(doc(alice(), 'scanSamples/b'), { ...sample, kind: 'pump', source: 'file', guess: '287.60|40.000', journal: false }));
    await assertSucceeds(setDoc(doc(alice(), 'scanSamples/c'), { ...sample, outcome: 'unreadable', guess: null, confidence: null, width: 0, height: 0 }));
  });
  it('rejects another uid, extra keys, bad enums and a pre-filled label', async () => {
    await assertFails(setDoc(doc(bob(), 'scanSamples/a'), sample));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'scanSamples/a'), sample));
    for (const patch of [{ extra: 1 }, { kind: 'receipt' }, { source: 'video' }, { outcome: 'maybe' }, { guess: '<b>' }, { guess: 'x'.repeat(41) },
      { confidence: 1.2 }, { attempt: 0 }, { attempt: 1.5 }, { platform: 'windows' }, { final: '168053' }, { result: 'match' }, { labeledAt: 1 },
      { createdAt: 12 }, { day: 'today' }, { session: '' }, { journal: 'yes' }, { seconds: -1 }]) {
      await assertFails(setDoc(doc(alice(), 'scanSamples/a'), { ...sample, ...patch }));
    }
  });
  it('the saved numbers can be attached once, by the owner, and nothing else changes', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'scanSamples/a'), sample));
    const label = { final: '168058', result: 'corrected', labeledAt: 1794000050000 };
    await assertFails(updateDoc(doc(bob(), 'scanSamples/a'), label));
    await assertFails(updateDoc(doc(alice(), 'scanSamples/a'), { ...label, guess: '168058' }));
    await assertFails(updateDoc(doc(alice(), 'scanSamples/a'), { ...label, result: 'great' }));
    await assertFails(updateDoc(doc(alice(), 'scanSamples/a'), { ...label, final: 'DROP' }));
    await assertSucceeds(updateDoc(doc(alice(), 'scanSamples/a'), label));
    await assertFails(updateDoc(doc(alice(), 'scanSamples/a'), { ...label, final: '168059' }));
  });
  it('only the owner and an admin read; the owner can erase their own by query', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'scanSamples/a'), sample));
    await assertSucceeds(getDoc(doc(alice(), 'scanSamples/a')));
    await assertFails(getDoc(doc(bob(), 'scanSamples/a')));
    await assertSucceeds(getDoc(doc(admin(), 'scanSamples/a')));
    await assertSucceeds(getDocs(collection(admin(), 'scanSamples')));
    await assertFails(getDocs(collection(alice(), 'scanSamples')));
    await assertSucceeds(getDocs(query(collection(alice(), 'scanSamples'), where('uid', '==', 'alice'))));
    await assertFails(deleteDoc(doc(bob(), 'scanSamples/a')));
    await assertSucceeds(deleteDoc(doc(alice(), 'scanSamples/a')));
  });
  it('an account marked for deletion cannot add samples', async () => {
    await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'users/alice'), { deletionPending: true }); });
    await assertFails(setDoc(doc(alice(), 'scanSamples/a'), sample));
    await assertFails(setDoc(doc(alice(), 'scanImages/a'), images));
  });
});

describe('scanImages', () => {
  it('accepts up to three strips and an optional thumbnail', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'scanImages/a'), images));
    await assertSucceeds(setDoc(doc(alice(), 'scanImages/b'), { ...images, strips: [strip, strip, strip], thumb: { w: 250, h: 188, jpeg: 'BBBB' } }));
    await assertSucceeds(setDoc(doc(alice(), 'scanImages/c'), { ...images, strips: [], thumb: { w: 250, h: 188, jpeg: 'BBBB' } }));
  });
  it('rejects oversized or malformed pictures, a fourth strip and another uid', async () => {
    await assertFails(setDoc(doc(alice(), 'scanImages/a'), { ...images, strips: [strip, strip, strip, strip] }));
    await assertFails(setDoc(doc(alice(), 'scanImages/a'), { ...images, strips: [{ ...strip, jpeg: 'x'.repeat(60001) }] }));
    await assertFails(setDoc(doc(alice(), 'scanImages/a'), { ...images, strips: [strip, { ...strip, role: 'face' }] }));
    await assertFails(setDoc(doc(alice(), 'scanImages/a'), { ...images, strips: [{ ...strip, url: 'https://x' }] }));
    await assertFails(setDoc(doc(alice(), 'scanImages/a'), { ...images, thumb: { w: 250, h: 188 } }));
    await assertFails(setDoc(doc(alice(), 'scanImages/a'), { ...images, extra: true }));
    await assertFails(setDoc(doc(bob(), 'scanImages/a'), images));
  });
  it('is immutable; owner and admin read and delete, others do not', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'scanImages/a'), images));
    await assertFails(updateDoc(doc(alice(), 'scanImages/a'), { thumb: null }));
    await assertFails(getDoc(doc(bob(), 'scanImages/a')));
    await assertSucceeds(getDoc(doc(admin(), 'scanImages/a')));
    await assertFails(deleteDoc(doc(bob(), 'scanImages/a')));
    await assertSucceeds(deleteDoc(doc(admin(), 'scanImages/a')));
  });
});
