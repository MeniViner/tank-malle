import { beforeAll, expect, it } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import worker, { verifyOwner } from './index.mjs';

const uid = 'owner-fixture';
const android = '1:157993868783:android:855a08c8d958f22c9a6a1a';
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => { keys = await generateKeyPair('RS256'); });

async function request(sub = uid, appId = android, provider = 'google.com') {
  const token = await new SignJWT({ email_verified: true, admin: true, firebase: { sign_in_provider: provider } })
    .setProtectedHeader({ alg: 'RS256' }).setSubject(sub).setIssuer('https://securetoken.google.com/tank-malle')
    .setAudience('tank-malle').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  const app = await new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setSubject(appId)
    .setIssuer('https://firebaseappcheck.googleapis.com/157993868783').setAudience('projects/157993868783')
    .setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  return new Request('https://worker.test/scan/odometer', { method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'X-Firebase-AppCheck': app, Origin: 'https://localhost' } });
}

it('requires the designated Google owner and a signed App Check token for this app', async () => {
  const verify = (req: Request) => verifyOwner(req, uid, keys.publicKey, keys.publicKey);
  expect(await verify(await request())).toBe(true);
  expect(await verify(await request('another-admin'))).toBe(false);
  expect(await verify(await request(uid, 'unregistered-app'))).toBe(false);
  expect(await verify(await request(uid, android, 'password'))).toBe(false);
  const noApp = await request();
  noApp.headers.delete('X-Firebase-AppCheck');
  expect(await verify(noApp)).toBe(false);
});

it('rejects unauthenticated calls before reading an image or invoking Gemini', async () => {
  const req = new Request('https://worker.test/scan/pump', { method: 'POST', headers: { Origin: 'https://localhost' } });
  expect((await worker.fetch(req, { OWNER_UID: uid })).status).toBe(403);
});
