import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const profile = process.argv[2];
if (!['qa', 'personal'].includes(profile)) throw new Error('Usage: npm run native:android -- <qa|personal>');
const signingDir = process.env.TANK_MALLE_SIGNING_DIR;
if (!signingDir || !['tank-malle.p12', 'password'].every(file => existsSync(join(signingDir, file)))) {
  throw new Error('Set TANK_MALLE_SIGNING_DIR to the Android signing key directory.');
}

execFileSync(process.execPath, ['scripts/prepare-native.mjs', profile, 'android'], { stdio: 'inherit' });
const variant = profile === 'qa' ? 'Qa' : 'Personal';
execFileSync('./gradlew', [':app:assemble' + variant + 'Release'], { cwd: 'android', stdio: 'inherit' });
