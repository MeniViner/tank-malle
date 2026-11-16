import type { CapacitorConfig } from '@capacitor/cli';

const qa = process.env.TANK_MALLE_NATIVE_PROFILE === 'qa';

export default {
  appId: qa ? 'com.meniviner.tankmalle.qa' : 'com.meniviner.tankmalle',
  appName: qa ? 'טנק מלא QA' : 'טנק מלא',
  webDir: 'dist-native',
  server: { hostname: 'localhost', androidScheme: 'https', iosScheme: 'capacitor' },
  ios: { contentInset: 'never' },
  plugins: {
    App: { disableBackButtonHandler: false },
    SocialLogin: {
      providers: { google: true, apple: false, facebook: false, twitter: false, oauth2: false },
      logLevel: 0,
    },
  },
} satisfies CapacitorConfig;
