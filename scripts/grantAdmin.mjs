/**
 * Grant or revoke admin access.
 *
 * Admin is a Firebase custom claim, not a database flag: claims are signed
 * into the ID token, so `request.auth.token.admin` in the security rules
 * cannot be forged by a client.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/tank-malle-…json \
 *     node scripts/grantAdmin.mjs someone@gmail.com
 *
 *   … node scripts/grantAdmin.mjs someone@gmail.com --revoke
 *
 * The user must have signed in at least once. After the claim changes they
 * need to sign out and back in (or wait for the hourly token refresh) for it
 * to take effect.
 */

import { readFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const [, , email, ...flags] = process.argv;
const revoke = flags.includes("--revoke");

if (!email) {
  console.error(
    "usage: GOOGLE_APPLICATION_CREDENTIALS=<key.json> node scripts/grantAdmin.mjs <email> [--revoke]",
  );
  process.exit(1);
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.error("GOOGLE_APPLICATION_CREDENTIALS must point at a service-account key JSON.");
  process.exit(1);
}

const serviceAccount = JSON.parse(await readFile(keyPath, "utf8"));
initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });

const auth = getAuth();
const db = getFirestore();

let user;
try {
  user = await auth.getUserByEmail(email);
} catch {
  console.error(
    `No account found for ${email}.\n` +
      "The user has to sign in to the app once before admin can be granted.",
  );
  process.exit(1);
}

const claims = { ...(user.customClaims ?? {}) };
if (revoke) delete claims.admin;
else claims.admin = true;

await auth.setCustomUserClaims(user.uid, claims);

// Mirrored onto the profile so the UI can show the badge without decoding
// the token; the rules still trust only the signed claim.
await db.doc(`users/${user.uid}`).set({ isAdmin: !revoke }, { merge: true });

console.log(
  `${revoke ? "Revoked" : "Granted"} admin for ${email} (uid ${user.uid}).\n` +
    "They must sign out and back in for the new token to take effect.",
);
process.exit(0);
