import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { GoogleAuthProvider } from 'firebase/auth';

let setup: Promise<void> | undefined;

function initialize() {
  const webClientId = import.meta.env.VITE_NATIVE_GOOGLE_WEB_CLIENT_ID;
  const iOSClientId = import.meta.env.VITE_NATIVE_GOOGLE_IOS_CLIENT_ID;
  if (!Capacitor.isNativePlatform() || !webClientId || (Capacitor.getPlatform() === 'ios' && !iOSClientId)) {
    throw new Error('Native Google sign-in is unavailable in this build.');
  }
  setup ??= SocialLogin.initialize({
    google: { webClientId, iOSClientId, iOSServerClientId: webClientId, mode: 'online' },
  }).catch(error => {
    setup = undefined;
    throw error;
  });
  return setup;
}

export async function nativeGoogleCredential() {
  await initialize();
  const { result } = await SocialLogin.login({
    provider: 'google',
    options: { forcePrompt: true },
  });
  if (result.responseType !== 'online' || !result.idToken) throw new Error('Google returned no ID token.');
  return GoogleAuthProvider.credential(result.idToken);
}

export function googleCancelled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: string; message?: string };
  return code === 'LOGIN_CANCELED' || /\bcancell?ed\b/i.test(message ?? '');
}

export async function clearNativeGoogle() {
  await initialize();
  await SocialLogin.logout({ provider: 'google' });
}
