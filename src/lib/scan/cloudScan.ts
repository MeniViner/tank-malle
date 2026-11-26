import { getAI, getGenerativeModel, GoogleAIBackend, Schema, ThinkingLevel } from 'firebase/ai';
import { CustomProvider, getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { cloudPilot, ownerCloudBuild, webAttestationKey } from './cloudPilot';
import { app, auth } from '../firebase';
import prompt from './cloudPrompt.json';
import { getConsoleAccess } from '../ownerConsole';
import { nativeBuild } from '../native/platform';
import type { DisplayKind, ScanContext } from './engine';
import type { Gray } from './engine/image';
import { parseCloudReading, SCAN_MODEL } from './cloudReading';

async function configureAttestation() {
  let provider;
  if (nativeBuild) {
    const { FirebaseAppCheck } = await import('@capacitor-firebase/app-check');
    await FirebaseAppCheck.initialize({});
    provider = new CustomProvider({ getToken: async () => {
      const { token, expireTimeMillis } = await FirebaseAppCheck.getToken();
      if (!expireTimeMillis) throw new Error('Missing attestation expiry');
      return { token, expireTimeMillis };
    } });
  } else {
    provider = new ReCaptchaEnterpriseProvider(webAttestationKey);
  }
  return initializeAppCheck(app, { provider });
}
let attestation: ReturnType<typeof configureAttestation> | undefined;
const cooldowns = new Map<string, number>();
const ownerService = 'https://tank-malle-owner-scan.meniviner.workers.dev/scan/';


function cropJpeg(crop: Gray) {
  const canvas = document.createElement('canvas');
  canvas.width = crop.width; canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const pixels = ctx.createImageData(crop.width, crop.height);
  for (let i = 0; i < crop.data.length; i++) {
    pixels.data.fill(crop.data[i], i * 4, i * 4 + 3);
    pixels.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const url = canvas.toDataURL('image/jpeg', 0.9);
  return url.startsWith('data:image/jpeg;base64,') ? url.slice(23) : null;
}

export async function cloudScan(kind: DisplayKind, crop: Gray, context: ScanContext, signal: AbortSignal, onGenerate: () => void) {
  const user = auth.currentUser;
  const uid = user?.uid ?? '';
  if (signal.aborted || !navigator.onLine || Date.now() < (cooldowns.get(uid) ?? 0)) return undefined;
  try {
    const identity = user?.emailVerified ? await user.getIdTokenResult() : undefined;
    const owner = user && identity?.claims.admin === true && identity.signInProvider === 'google.com' &&
      await getConsoleAccess(uid).catch(() => false);
    if (auth.currentUser !== user || signal.aborted) return undefined;
    if (!cloudPilot && !(ownerCloudBuild && owner)) return undefined;
    attestation ??= configureAttestation().catch(error => { attestation = undefined; throw error; });
    // Fail closed before passing any image to AI Logic if attestation is unavailable.
    const { token: appToken } = await getToken(await attestation);
    if (signal.aborted || auth.currentUser !== user) return undefined;
    const data = cropJpeg(crop);
    if (!data) return undefined;
    if (owner && identity) {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      onGenerate();
      const result = await fetch(ownerService + kind, {
        method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), body: bytes,
        headers: { Authorization: 'Bearer ' + identity.token, 'X-Firebase-AppCheck': appToken, 'Content-Type': 'image/jpeg' },
      });
      if (result.status === 429) cooldowns.set(uid, Date.now() + 60_000);
      return result.ok ? parseCloudReading(kind, await result.text(), context) : null;
    }
    const digitString = () => Schema.string({ nullable: true });
    const properties: Record<string, ReturnType<typeof digitString>> = kind === 'odometer'
      ? { odometer: digitString() } : { total: digitString(), liters: digitString(), price: digitString() };
    const model = getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), {
      model: SCAN_MODEL,
      generationConfig: { responseMimeType: 'application/json', responseSchema: Schema.object({ properties }),
        maxOutputTokens: 256, thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
    });
    onGenerate();
    const response = await model.generateContent([
      prompt[kind] + ' ' + prompt.instructions,
      { inlineData: { mimeType: 'image/jpeg', data } },
    ], { signal, timeout: 12000 });
    return parseCloudReading(kind, response.response.text(), context);
  } catch (error) {
    if ((error as { customErrorData?: { status?: number } })?.customErrorData?.status === 429) {
      cooldowns.set(uid, Date.now() + 60_000);
    }
    return null;
  }
}
