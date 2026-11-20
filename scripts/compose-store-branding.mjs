/** Re-render the approved six-panel panorama with the current app identity. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2];
if (!destination) throw new Error('Usage: node scripts/compose-store-branding.mjs <output-directory>');
const output = resolve(destination);
await mkdir(resolve(output, 'store-assets'), { recursive: true });
const identity = JSON.parse(await readFile(resolve(root, 'resources/app-icon/identity.json'), 'utf8'));
const data = async (path, type) => `data:${type};base64,${(await readFile(resolve(root, path))).toString('base64')}`;
const values = {
  FONT_SANS_REGULAR: await data('public/fonts/ibm-plex-sans-hebrew-400.woff2', 'font/woff2'),
  FONT_SANS_SEMIBOLD: await data('public/fonts/ibm-plex-sans-hebrew-600.woff2', 'font/woff2'),
  FONT_DISPLAY: await data('public/fonts/karantina-hebrew-400.woff2', 'font/woff2'),
  APP_ICON: await data('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-Default.png', 'image/png'),
  SCREEN_HOME: await data('resources/play-store/screens/home.jpg', 'image/jpeg'),
  SCREEN_JOURNAL: await data('resources/play-store/screens/journal.jpg', 'image/jpeg'),
  SCREEN_INSIGHTS: await data('resources/play-store/screens/insights.jpg', 'image/jpeg'),
  TAGLINE: identity.tagline,
};
let html = await readFile(resolve(root, 'resources/play-store/panorama-template.html'), 'utf8');
html = html.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
  if (!values[key]) throw new Error(`Unknown template asset: ${key}`);
  return values[key];
});
if ((html.match(/class="brand"/g) || []).length !== 6) throw new Error('The approved panorama must have six panels.');
await writeFile(resolve(output, 'panorama.html'), html);
for (let index = 1; index <= 6; index++) {
  // Each viewport keeps the original full panorama underneath; crossing phones
  // and the continuous background therefore meet at the same edges as before.
  const left = (6 - index) * 1080;
  const panel = html.replace('</style>', `\nhtml,body{width:1080px;height:1920px}.master{transform:translateX(-${left}px)}</style>`);
  await writeFile(resolve(output, `panel-${index}.html`), panel);
}
const preview = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="darkreader-lock"><meta name="color-scheme" content="only light"><title>${identity.displayName} · תמונות חנות</title><style>html,body{margin:0;background:#f4f1e8;color:#25282b;font-family:Arial,sans-serif}body{width:1400px;padding:28px;box-sizing:border-box}h1{font-size:25px;margin:0 0 10px}p{font-size:17px;margin:0 0 22px}.panels{display:flex;gap:12px;direction:rtl}.panels img{width:214px;height:auto;border-radius:10px}</style><body><h1>${identity.displayName}</h1><p>${identity.tagline} · מבית <bdi dir="ltr">${identity.publisherBrand}</bdi></p><main class="panels">${Array.from({ length: 6 }, (_, i) => `<img alt="תמונת חנות ${i + 1}" src="store-assets/0${i + 1}-tank-malle-brand.jpg">`).join('')}</main></body></html>`;
await writeFile(resolve(output, 'preview.html'), preview);
console.log(JSON.stringify({ displayName: identity.displayName, tagline: identity.tagline, panels: 6, output }));
