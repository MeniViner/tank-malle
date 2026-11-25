import { nativeBuild } from '../native/platform';

// Enabled only for separately distributed adult pilot builds in an eligible region.
export const cloudPilot = import.meta.env.VITE_SCAN_AI_PILOT === '1' &&
  import.meta.env.VITE_USE_EMULATORS !== '1' && import.meta.env.VITE_FIREBASE_PROJECT_ID === 'tank-malle' &&
  (nativeBuild || Boolean(import.meta.env.VITE_SCAN_RECAPTCHA_SITE_KEY));
