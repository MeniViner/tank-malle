/** Production app icons only. This does not change PWA icons, UI marks or splash art. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const identity = JSON.parse(await readFile(resolve(root, 'resources/app-icon/identity.json'), 'utf8'));
const source = await readFile(resolve(root, 'resources/app-icon/foreground.png'));
const art = await sharp(source).trim({ background: '#00000000' }).ensureAlpha().png().toBuffer();
const { data, info } = await sharp(art).raw().toBuffer({ resolveWithObject: true });
let radius = 0;
for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
  if (data[(y * info.width + x) * 4 + 3] >= 32) radius = Math.max(radius, Math.hypot(x - info.width / 2, y - info.height / 2));
}
const png = { compressionLevel: 9 };
async function write(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
async function foreground(size, safeRadius, monochrome = false) {
  const scale = safeRadius / radius;
  const width = Math.round(info.width * scale), height = Math.round(info.height * scale);
  let stamp = await sharp(art).resize(width, height).png(png).toBuffer();
  if (monochrome) {
    const m = await sharp(stamp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < m.data.length; i += 4) m.data[i] = m.data[i + 1] = m.data[i + 2] = 255;
    stamp = await sharp(m.data, { raw: m.info }).png(png).toBuffer();
  }
  return sharp({ create: { width: size, height: size, channels: 4, background: '#00000000' } })
    .composite([{ input: stamp, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) }]).png(png).toBuffer();
}
async function icon(size, background, monochrome = false) {
  return sharp(await foreground(size, size * 0.47, monochrome)).flatten({ background }).removeAlpha().png(png).toBuffer();
}
const android = resolve(root, 'android/app/src/main/res');
const adaptive = await foreground(648, 197);
const mono = await foreground(648, 197, true);
await write(resolve(android, 'drawable-nodpi/tm_launcher_art.png'), adaptive);
await write(resolve(android, 'drawable-nodpi/tm_launcher_monochrome_art.png'), mono);
for (const [name, source] of [['tm_launcher_foreground', 'tm_launcher_art'], ['tm_launcher_monochrome', 'tm_launcher_monochrome_art']]) {
  await write(resolve(android, `drawable/${name}.xml`), `<?xml version="1.0" encoding="utf-8"?>\n<bitmap xmlns:android="http://schemas.android.com/apk/res/android" android:src="@drawable/${source}" android:gravity="fill" android:antialias="true" android:filter="true"/>\n`);
}
for (const night of [false, true]) {
  await write(resolve(android, `values${night ? '-night' : ''}/tm_launcher_background.xml`), `<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="tm_launcher_background">${night ? identity.darkBackground : identity.background}</color></resources>\n`);
  for (const [density, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
    const flat = await icon(size, night ? identity.darkBackground : identity.background);
    await write(resolve(android, `mipmap${night ? '-night' : ''}-${density}/ic_launcher.png`), flat);
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`);
    await write(resolve(android, `mipmap${night ? '-night' : ''}-${density}/ic_launcher_round.png`), await sharp(flat).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png(png).toBuffer());
  }
}
// Night-qualified legacy PNGs otherwise win before Android compares density/API.
// Match their uiMode qualifier so modern launchers keep the adaptive drawable.
for (const night of [false, true]) for (const version of [26, 33]) for (const suffix of ['', '_round']) {
  await write(resolve(android, `mipmap${night ? '-night' : ''}-anydpi-v${version}/ic_launcher${suffix}.xml`), `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@color/tm_launcher_background"/>\n  <foreground android:drawable="@drawable/tm_launcher_foreground"/>\n${version >= 33 ? '  <monochrome android:drawable="@drawable/tm_launcher_monochrome"/>\n' : ''}</adaptive-icon>\n`);
}
const catalog = resolve(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
const variants = [
  { filename: 'AppIcon-Default.png', background: identity.background },
  { filename: 'AppIcon-Dark.png', background: identity.darkBackground, value: 'dark' },
  { filename: 'AppIcon-Tinted.png', background: '#000000', monochrome: true, value: 'tinted' },
];
for (const v of variants) await write(resolve(catalog, v.filename), await icon(1024, v.background, v.monochrome));
await write(resolve(catalog, 'Contents.json'), JSON.stringify({ images: variants.map(v => ({ filename: v.filename, idiom: 'universal', platform: 'ios', size: '1024x1024', ...(v.value ? { appearances: [{ appearance: 'luminosity', value: v.value }] } : {}) })), info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
const strings = resolve(android, 'values/strings.xml');
let text = await readFile(strings, 'utf8');
for (const name of ['app_name', 'title_activity_main']) text = text.replace(new RegExp(`(<string name="${name}">)[^<]*(</string>)`), `$1${identity.displayName}$2`);
await writeFile(strings, text);
const iosConfig = resolve(root, 'ios/App/App/TankMalle.xcconfig');
await writeFile(iosConfig, (await readFile(iosConfig, 'utf8')).replace(/^TANK_MALLE_DISPLAY_NAME = .*$/m, 'TANK_MALLE_DISPLAY_NAME = ' + identity.displayName));
const output = process.argv[2] && resolve(process.argv[2]);
if (output) {
  await write(resolve(output, 'icon-default-1024.png'), await icon(1024, identity.background));
  await write(resolve(output, 'icon-dark-1024.png'), await icon(1024, identity.darkBackground));
  await write(resolve(output, 'icon-tinted-1024.png'), await icon(1024, '#000000', true));
  await write(resolve(output, 'icon-play-512.png'), await icon(512, identity.background));
  await write(resolve(output, 'icon-foreground.png'), source);
}
console.log(JSON.stringify({ displayName: identity.displayName, adaptiveCanvas: 648, safeRadius: 197, sourceRadius: Math.round(radius), output: output || null }));
