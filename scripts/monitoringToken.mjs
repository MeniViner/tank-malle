import { sign } from 'node:crypto';

const scope = 'https://www.googleapis.com/auth/monitoring.read';
const audience = 'https://oauth2.googleapis.com/token';
const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');

/** A short-lived OAuth token explicitly scoped to read Cloud Monitoring. */
export async function monitoringToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: account.client_email, scope, aud: audience, iat: now, exp: now + 600,
  })}`;
  const signature = sign('sha256', Buffer.from(assertion), account.private_key).toString('base64url');
  const response = await fetch(audience, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${assertion}.${signature}`,
    }),
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  const credential = await response.json();
  if (!response.ok || typeof credential.access_token !== 'string') {
    throw new Error(`Monitoring scoped token unavailable (HTTP ${response.status})`);
  }
  return credential.access_token;
}
