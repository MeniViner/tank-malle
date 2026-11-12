/**
 * Daily phone notifications (Web Push), without a Cloud Function — the project is on
 * Spark, so this runs from GitHub Actions like the fuel-price job
 * (.github/workflows/push-notifications.yml). The decision logic is src/lib/push/run.ts.
 *
 *   # count what would be sent, nothing sent or recorded
 *   FIREBASE_SERVICE_ACCOUNT='{…}' node push.mjs --dry-run
 *
 *   # send
 *   FIREBASE_SERVICE_ACCOUNT='{…}' WEB_PUSH_PRIVATE_KEY=… node push.mjs
 *
 * Bundle first: esbuild scripts/push/sendPushNotifications.ts --bundle --platform=node
 * --format=esm --external:firebase-admin --external:web-push --outfile=push.mjs
 * With FIRESTORE_EMULATOR_HOST set, it reads the local emulator instead.
 */
import { readFile } from 'node:fs/promises';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import webpush from 'web-push';
import { WEB_PUSH_PUBLIC_KEY } from '../../src/lib/push/config';
import { runPush, type PushStore, type RawDoc } from '../../src/lib/push/run';

const TIME_ZONE = 'Asia/Jerusalem';
process.env.TZ ||= TIME_ZONE;
const dryRun = process.argv.includes('--dry-run');

async function account(): Promise<Record<string, string> | null> {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  if (process.env.FIRESTORE_EMULATOR_HOST) return null;
  throw new Error('set FIREBASE_SERVICE_ACCOUNT (inline JSON) or GOOGLE_APPLICATION_CREDENTIALS (path)');
}

async function main() {
  const key = await account();
  const projectId = key?.project_id ?? process.env.GCLOUD_PROJECT ?? 'demo-tankmaleh';
  initializeApp(key ? { credential: cert(key), projectId } : { projectId });
  const db = getFirestore();
  const rows = (snapshot: FirebaseFirestore.QuerySnapshot): RawDoc[] => snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  const store: PushStore = {
    async subscriptions() {
      const snapshot = await db.collectionGroup('pushSubscriptions').get();
      return snapshot.docs.flatMap(doc => {
        const uid = doc.ref.parent.parent?.id, data = doc.data();
        return uid && typeof data.endpoint === 'string' && typeof data.p256dh === 'string' && typeof data.auth === 'string'
          ? [{ uid, id: doc.id, endpoint: data.endpoint, p256dh: data.p256dh, auth: data.auth }] : [];
      });
    },
    profile: async uid => (await db.doc(`users/${uid}`).get()).data() ?? null,
    vehicles: async uid => rows(await db.collection(`users/${uid}/vehicles`).get()),
    collection: async (uid, vehicleId, name) => rows(await db.collection(`users/${uid}/vehicles/${vehicleId}/${name}`).get()),
    // Pages back until `limit` rows pass `keep`, or 500 documents were looked at.
    async latest(uid, vehicleId, name, field, limit, keep) {
      const found: RawDoc[] = [];
      let query = db.collection(`users/${uid}/vehicles/${vehicleId}/${name}`).orderBy(field, 'desc').limit(50), seen = 0;
      for (;;) {
        const page = await query.get();
        for (const row of rows(page)) if (keep(row) && found.push(row) >= limit) return found;
        seen += page.size;
        if (page.size < 50 || seen >= 500) return found;
        query = query.startAfter(page.docs[page.docs.length - 1]);
      }
    },
    async sentIds(uid, ids) {
      if (!ids.length) return new Set();
      const found = await db.getAll(...ids.map(id => db.doc(`users/${uid}/pushSent/${id}`)), { fieldMask: [] });
      return new Set(found.filter(doc => doc.exists).map(doc => doc.id));
    },
    async markSent(uid, items, sentAt) {
      const batch = db.batch();
      for (const item of items) batch.set(db.doc(`users/${uid}/pushSent/${item.id}`), { occurrence: item.occurrence, sentAt });
      await batch.commit();
    },
    removeSubscription: async (uid, id) => { await db.doc(`users/${uid}/pushSubscriptions/${id}`).delete(); },
  };

  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  if (!privateKey && !dryRun) throw new Error('set WEB_PUSH_PRIVATE_KEY (the GitHub secret), or pass --dry-run');
  if (privateKey) webpush.setVapidDetails('https://tank-malle.web.app', WEB_PUSH_PUBLIC_KEY, privateKey);

  const now = Date.now();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(now);
  const report = await runPush(store, async (subscription, message) => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify({ title: message.title, body: message.body, url: message.url, tag: message.tag }),
        // The timeout keeps one unanswering address from holding up everyone after it.
        { TTL: 24 * 60 * 60, urgency: message.urgent ? 'high' : 'normal', timeout: 10_000 });
      return 'sent';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      console.warn(`push failed (${status ?? 'network'}) for one device`);
      return 'failed';
    }
  }, { today, now, dryRun, warn: message => console.warn(message) });
  console.log(`${dryRun ? 'dry run' : 'sent'} ${today} · project ${projectId} · ${JSON.stringify(report)}`);
  // The other accounts were served; the failed run still shows red so it gets looked at.
  if (report.errors) process.exitCode = 1;
}

// The Admin SDK keeps its connection open; exit once the run is reported.
main().then(() => process.exit(process.exitCode ?? 0), error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
