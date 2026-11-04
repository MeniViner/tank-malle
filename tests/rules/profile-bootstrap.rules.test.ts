import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  disableNetwork, doc, enableNetwork, getDocFromCache, getDocFromServer,
  runTransaction, serverTimestamp, setDoc, Timestamp, type DocumentData, type Firestore,
} from 'firebase/firestore';
import { missingProfileFields } from '../../src/lib/profileBootstrap';

let env: RulesTestEnvironment;
const path = 'users/alice';
const identity = { displayName: 'From authentication', photoURL: 'https://example.invalid/photo', email: 'alice@example.invalid' };
const owner = () => env.authenticatedContext('alice').firestore() as unknown as Firestore;
const seed = async (fields: Record<string, unknown>) => {
  let stored!: DocumentData;
  await env.withSecurityRulesDisabled(async context => {
    const ref = doc(context.firestore(), path);
    await setDoc(ref, fields);
    stored = (await getDocFromServer(ref)).data()!;
  });
  return stored;
};

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-profile-bootstrap-rules', firestore: {
    host: '127.0.0.1', port: Number(process.env.RULES_FIRESTORE_PORT ?? 8080),
    rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
  } });
}, 60_000);
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env?.cleanup(); });

describe('profile initialization against the actual Firestore SDK and rules', () => {
  it('atomically creates a confirmed-absent parent with the exact pending offline preference', async () => {
    const db = owner(), ref = doc(db, path);
    expect((await getDocFromServer(ref)).exists()).toBe(false);
    await disableNetwork(db);
    const settings = { theme: 'dark', accentColor: 'mint', activeVehicleId: 'chosen-offline', shareBenchmarks: false };
    // The explicit preference owns one whole field, including when its parent
    // is absent. No separate defaults or empty parent mutation is queued.
    let settled = false;
    const queued = setDoc(ref, { settings }, { mergeFields: ['settings'] }).then(() => { settled = true; });
    try {
      await expect.poll(async () => {
        const snapshot = await getDocFromCache(ref);
        return { fields: snapshot.data(), pending: snapshot.metadata.hasPendingWrites };
      }).toEqual({ fields: { settings }, pending: true });
      expect(settled).toBe(false);
    } finally {
      await enableNetwork(db);
      await queued;
    }
    expect((await getDocFromServer(ref)).data()).toEqual({ settings });
  });

  it('replaces exactly the owned settings map while preserving concurrent unrelated profile fields', async () => {
    const original = {
      ...identity, displayName: null, photoURL: null,
      settings: { theme: 'light', obsoletePreference: 'remove with the whole map', nested: { obsolete: true } },
      createdAt: new Timestamp(1_700_000_000, 123_456_000),
      lastLoginAt: new Timestamp(1_800_000_000, 654_321_000),
      futureProfile: { retained: true, precise: 9.123456789 },
    };
    await seed(original);
    const db = owner(), ref = doc(db, path);
    await getDocFromServer(ref);
    await disableNetwork(db);
    const settings = { theme: 'dark', accentColor: 'lilac', activeVehicleId: 'v-authored', shareBenchmarks: false, nested: {} };
    const pending = setDoc(ref, { settings }, { mergeFields: ['settings'] });
    let authored: Awaited<ReturnType<typeof seed>>;
    try {
      await expect.poll(async () => (await getDocFromCache(ref)).data()?.settings).toEqual(settings);
      authored = await seed({
        ...original, nickname: 'Changed by another profile writer',
        futureProfile: { retained: true, precise: 9.123456789, concurrent: [0, null, 'exact'] },
      });
    } finally {
      await enableNetwork(db);
      await pending;
    }
    // Exact map replacement removes omitted settings children, unlike a
    // recursive merge:true. Every unrelated root field is compared with the
    // concurrent writer's actual server image.
    expect((await getDocFromServer(ref)).data()).toEqual({ ...authored, settings });
  });

  it('recomputes missing fields after a concurrent writer changes an initially empty profile', async () => {
    await seed({});
    const db = owner(), ref = doc(db, path);
    let release!: () => void, reached!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const firstRead = new Promise<void>(resolve => { reached = resolve; });
    let attempts = 0;
    const repair = runTransaction(db, async transaction => {
      const snapshot = await transaction.get(ref);
      if (++attempts === 1) {
        expect(snapshot.data()).toEqual({});
        reached();
        await held;
      }
      const patch = missingProfileFields(snapshot.data() ?? {}, identity, serverTimestamp());
      if (Object.keys(patch).length) transaction.set(ref, patch, { merge: true });
    });
    let authored: Awaited<ReturnType<typeof seed>>;
    try {
      await Promise.race([firstRead, repair.then(() => { throw new Error('repair completed before its held first read'); })]);
      authored = await seed({
        displayName: null,
        settings: { activeVehicleId: 'concurrently-selected', shareBenchmarks: false, futurePreference: null },
        createdAt: new Timestamp(1_600_000_000, 987_654_000),
        futureProfile: { preserved: ['value', 0, null] },
      });
    } finally {
      release();
    }
    await repair;
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect((await getDocFromServer(ref)).data()).toEqual({ ...authored, photoURL: identity.photoURL, email: identity.email });
  });
});
