import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const [profile, platform] = process.argv.slice(2);
if (!['qa', 'personal'].includes(profile) || !['android', 'ios'].includes(platform)) {
  throw new Error('Usage: npm run native:prepare -- <qa|personal> <android|ios>');
}

const mode = 'native-' + profile;
const identity = JSON.parse(readFileSync('resources/app-icon/identity.json', 'utf8'));
const settings = parseEnv(readFileSync('.env.' + mode + '.local', 'utf8'));
const project = settings.VITE_FIREBASE_PROJECT_ID;
const googleClient = /^(\d+)-[a-z0-9-]+\.apps\.googleusercontent\.com$/;
const webClient = settings.VITE_NATIVE_GOOGLE_WEB_CLIENT_ID ?? '';
const iosClient = settings.VITE_NATIVE_GOOGLE_IOS_CLIENT_ID ?? '';
const required = ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'MESSAGING_SENDER_ID', 'APP_ID'];
if (!required.every(key => settings['VITE_FIREBASE_' + key]) ||
    (profile === 'personal' ? project !== 'tank-malle' : project !== 'tank-malle-native-qa-20261112') ||
    webClient.match(googleClient)?.[1] !== settings.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    (platform === 'ios' && iosClient.match(googleClient)?.[1] !== settings.VITE_FIREBASE_MESSAGING_SENDER_ID)) {
  throw new Error('The selected profile requires matching Firebase web and Google OAuth client configuration.');
}

const version = readFileSync('src/lib/version.ts', 'utf8').match(/APP_VERSION = "(\d+\.\d+\.\d+)"/)?.[1];
if (!version) throw new Error('Missing application version.');
const buildNumber = process.env.TANK_MALLE_BUILD_NUMBER || '1';
if (!/^[1-9]\d{0,8}$/.test(buildNumber)) throw new Error('TANK_MALLE_BUILD_NUMBER must be a positive integer.');

const env = {
  ...process.env,
  ...Object.fromEntries(Object.entries(settings).filter(([key]) => key.startsWith('VITE_'))),
  VITE_NATIVE_GOOGLE_IOS_CLIENT_ID: platform === 'ios' ? iosClient : '',
  TANK_MALLE_NATIVE_PROFILE: profile,
  TANK_MALLE_NATIVE_PLATFORM: platform,
};
execFileSync('node', ['scripts/generate-app-icons.mjs'], { stdio: 'inherit' });
execFileSync('npm', ['run', 'build', '--', '--mode', mode], { env, stdio: 'inherit' });
execFileSync('npx', ['--no-install', 'cap', 'sync', platform], { env, stdio: 'inherit' });

if (platform === 'ios') {
  // The Capacitor 8 SPM template still declares Swift tools 5.9, which
  // understands the string platform form for iOS 18.
  const packagePath = 'ios/App/CapApp-SPM/Package.swift';
  const manifest = readFileSync(packagePath, 'utf8');
  const compatible = manifest.replace('.iOS(.v18)', '.iOS("18.0")');
  if (compatible !== manifest) writeFileSync(packagePath, compatible);

  const identifier = profile === 'qa' ? 'com.meniviner.tankmalle.qa' : 'com.meniviner.tankmalle';
  const reversedClient = iosClient.split('.').reverse().join('.');
  writeFileSync('ios/App/App/TankMalle.generated.xcconfig', [
    'PRODUCT_BUNDLE_IDENTIFIER = ' + identifier,
    'TANK_MALLE_GOOGLE_SCHEME = ' + reversedClient,
    'TANK_MALLE_DISPLAY_NAME = ' + (profile === 'qa' ? 'טנק מלא QA' : identity.displayName),
    'MARKETING_VERSION = ' + version,
    'CURRENT_PROJECT_VERSION = ' + buildNumber,
    '',
  ].join('\n'));
}
