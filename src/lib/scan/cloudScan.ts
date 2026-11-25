import { getAI, getGenerativeModel, GoogleAIBackend, Schema, ThinkingLevel } from 'firebase/ai';
import { CustomProvider, getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { app } from '../firebase';
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
    provider = new ReCaptchaEnterpriseProvider(import.meta.env.VITE_SCAN_RECAPTCHA_SITE_KEY);
  }
  return initializeAppCheck(app, { provider });
}
let attestation: ReturnType<typeof configureAttestation> | undefined;
let cooldownUntil = 0;

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

export async function cloudScan(kind: DisplayKind, crop: Gray, context: ScanContext, signal: AbortSignal) {
  if (signal.aborted || !navigator.onLine || Date.now() < cooldownUntil) return undefined;
  try {
    attestation ??= configureAttestation().catch(error => { attestation = undefined; throw error; });
    // Fail closed before passing any image to AI Logic if attestation is unavailable.
    await getToken(await attestation);
    if (signal.aborted) return null;
    const data = cropJpeg(crop);
    if (!data) return null;
    const digitString = () => Schema.string({ nullable: true });
    const properties: Record<string, ReturnType<typeof digitString>> = kind === 'odometer'
      ? { odometer: digitString() } : { total: digitString(), liters: digitString(), price: digitString() };
    const model = getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), {
      model: SCAN_MODEL,
      generationConfig: { responseMimeType: 'application/json', responseSchema: Schema.object({ properties }),
        maxOutputTokens: 256, thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
    });
    const target = kind === 'odometer' ? 'the cumulative odometer in km, excluding trip or speed'
      : 'the pump sale total, litres and displayed price per litre, in that order on a typical Israeli pump';
    const response = await model.generateContent([
      'Transcribe ' + target + '. Copy only legible digits and printed decimal points. Keep trailing zeros. Return null for ambiguous or missing fields. Never calculate a missing field.',
      { inlineData: { mimeType: 'image/jpeg', data } },
    ], { signal, timeout: 12000 });
    return parseCloudReading(kind, response.response.text(), context);
  } catch (error) {
    if ((error as { customErrorData?: { status?: number } })?.customErrorData?.status === 429) {
      cooldownUntil = Date.now() + 60_000;
    }
    return null;
  }
}
