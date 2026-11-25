import { createRemoteJWKSet, jwtVerify } from 'jose';
import prompt from '../../src/lib/scan/cloudPrompt.json' with { type: 'json' };

const identityKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const appKeys = createRemoteJWKSet(new URL('https://firebaseappcheck.googleapis.com/v1/jwks'));
const apps = ['1:157993868783:web:a742075707dfd7d09a6a1a', '1:157993868783:android:855a08c8d958f22c9a6a1a'];
const maxBytes = 768 * 1024;

export async function verifyOwner(request, owner, identityKey = identityKeys, appKey = appKeys) {
  const bearer = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  const attestation = request.headers.get('X-Firebase-AppCheck');
  if (!owner || !bearer || !attestation) return false;
  try {
    const [id, app] = await Promise.all([
      jwtVerify(bearer, identityKey, { algorithms: ['RS256'], issuer: 'https://securetoken.google.com/tank-malle',
        audience: 'tank-malle', requiredClaims: ['exp', 'iat', 'sub'] }),
      jwtVerify(attestation, appKey, { algorithms: ['RS256'], issuer: 'https://firebaseappcheck.googleapis.com/157993868783',
        audience: 'projects/157993868783', requiredClaims: ['exp', 'iat', 'sub'] }),
    ]);
    return id.payload.sub === owner && id.payload.email_verified === true && id.payload.admin === true &&
      id.payload.firebase?.sign_in_provider === 'google.com' && apps.includes(app.payload.sub);
  } catch { return false; }
}

async function readJpeg(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return null;
  return bytes.toBase64();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const paths = { '/scan/pump': 'pump', '/scan/odometer': 'odometer' };
    const kind = paths[new URL(request.url).pathname];
    if (!kind || !origin || !['https://localhost', 'https://tank-malle.web.app', env.WEB_PILOT_ORIGIN].includes(origin))
      return new Response(null, { status: 403 });
    const headers = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Cache-Control': 'no-store' };
    const empty = status => new Response(null, { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers,
      'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Firebase-AppCheck' } });
    if (request.method !== 'POST') return empty(405);
    if (!await verifyOwner(request, env.OWNER_UID)) return empty(403);
    if (request.headers.get('Content-Type') !== 'image/jpeg') return empty(415);
    if (Number(request.headers.get('Content-Length')) > maxBytes) return empty(413);
    try {
      const data = await readJpeg(request);
      if (!data) return empty(400);
      const fields = kind === 'odometer' ? ['odometer'] : ['total', 'liters', 'price'];
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + prompt.model + ':generateContent', {
        method: 'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt[kind] + ' ' + prompt.instructions }, { inlineData: { mimeType: 'image/jpeg', data } }] }],
          generationConfig: { maxOutputTokens: 256, thinkingConfig: { thinkingLevel: 'MINIMAL' }, responseMimeType: 'application/json',
            responseSchema: { type: 'OBJECT', required: fields, properties: Object.fromEntries(fields.map(k => [k, { type: 'STRING', nullable: true }])) } } }),
      });
      if (!response.ok) return empty(response.status === 429 ? 429 : 502);
      const result = await response.json();
      const reading = result.candidates?.[0]?.content?.parts?.find(part => !part.thought && part.text)?.text;
      if (typeof reading !== 'string') return empty(502);
      return new Response(reading, { headers: { ...headers, 'Content-Type': 'application/json' } });
    } catch { return empty(502); }
  },
};
