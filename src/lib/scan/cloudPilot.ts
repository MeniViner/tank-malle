import { nativeBuild } from '../native/platform';

// Public Enterprise site identifier registered for tank-malle (embedded by reCAPTCHA on the web).
export const webAttestationKey = import.meta.env.VITE_SCAN_RECAPTCHA_SITE_KEY ||
  (import.meta.env.VITE_FIREBASE_PROJECT_ID === 'tank-malle' ? '6Lef9DEuAAAAAAslW6iEOYZfVYHB-LG9wIp7z9qG' : '');

// Enabled only for separately distributed adult pilot builds in an eligible region.
export const cloudPilot = import.meta.env.VITE_SCAN_AI_PILOT === '1' &&
  import.meta.env.VITE_USE_EMULATORS !== '1' && import.meta.env.VITE_FIREBASE_PROJECT_ID === 'tank-malle' &&
  (nativeBuild || Boolean(webAttestationKey));

// Public Hosting exposes only the separately authorized owner service.
export const ownerCloudBuild = !nativeBuild && !cloudPilot &&
  import.meta.env.VITE_USE_EMULATORS !== '1' && import.meta.env.VITE_FIREBASE_PROJECT_ID === 'tank-malle' &&
  Boolean(webAttestationKey);
