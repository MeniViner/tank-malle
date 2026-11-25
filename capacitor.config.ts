import type { CapacitorConfig } from '@capacitor/cli';
import identity from './resources/app-icon/identity.json';

const qa = process.env.TANK_MALLE_NATIVE_PROFILE === 'qa';

export default {
  appId: qa ? 'com.meniviner.tankmalle.qa' : 'com.meniviner.tankmalle',
  appName: qa ? 'טנק מלא QA' : identity.displayName,
  webDir: 'dist-native',
  server: { hostname: 'localhost', androidScheme: 'https', iosScheme: 'capacitor' },
  ios: { contentInset: 'never' },
  experimental: { ios: { spm: { swiftToolsVersion: '6.1',
    packageTraits: { '@capacitor-firebase/analytics': ['AnalyticsWithoutAdIdSupport'] },
    packageOptions: {
    '@capacitor-firebase/analytics': { symlink: true },
    '@capacitor-firebase/performance': { symlink: true },
    '@capacitor-firebase/app-check': { symlink: true },
    '@capacitor-firebase/crashlytics': { symlink: true },
  } } } },
  plugins: {
    App: { disableBackButtonHandler: false },
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
    SocialLogin: {
      providers: { google: true, apple: false, facebook: false, twitter: false, oauth2: false },
      logLevel: 0,
    },
  },
} satisfies CapacitorConfig;
