/**
 * Generates the PWA icon set from a single inline SVG source.
 *
 *   node scripts/generateIcons.mjs
 *
 * The mark is the fuel-gauge needle from the design export. The maskable
 * variant keeps the glyph inside the safe zone (80% of the canvas) so Android
 * can crop it to any shape without clipping.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = resolve(ROOT, "public/icons");

const ACCENT = "#0E7A6B";

/** @param {{ scale: number, background: string, radius: number | null }} options */
function markSvg({ scale, background, radius }) {
  const size = 512;
  const inset = (size * (1 - scale)) / 2;
  const glyph = size * scale;

  const shape =
    radius === null
      ? `<rect width="${size}" height="${size}" fill="${background}"/>`
      : `<rect width="${size}" height="${size}" rx="${radius}" fill="${background}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${shape}
  <g transform="translate(${inset} ${inset}) scale(${glyph / 64})">
    <path d="M14 41A21 21 0 1 1 50 41" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" fill="none"/>
    <path d="M32 36 45 26" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"/>
    <circle cx="32" cy="37" r="4" fill="#FFFFFF"/>
  </g>
</svg>`;
}

const OUTPUTS = [
  { file: "icon-192.png", size: 192, svg: markSvg({ scale: 0.62, background: ACCENT, radius: 108 }) },
  { file: "icon-512.png", size: 512, svg: markSvg({ scale: 0.62, background: ACCENT, radius: 108 }) },
  {
    file: "icon-maskable-512.png",
    size: 512,
    // Full-bleed background, glyph inside the 80% safe zone.
    svg: markSvg({ scale: 0.5, background: ACCENT, radius: null }),
  },
];

async function main() {
  await mkdir(ICONS, { recursive: true });

  for (const output of OUTPUTS) {
    await sharp(Buffer.from(output.svg))
      .resize(output.size, output.size)
      .png({ compressionLevel: 9 })
      .toFile(resolve(ICONS, output.file));
    console.log(`  ${output.file} (${output.size}×${output.size})`);
  }

  // Apple touch icon: no transparency, no rounding — iOS masks it itself.
  await sharp(Buffer.from(markSvg({ scale: 0.6, background: ACCENT, radius: null })))
    .resize(180, 180)
    .png({ compressionLevel: 9 })
    .toFile(resolve(ROOT, "public/apple-touch-icon.png"));
  console.log("  apple-touch-icon.png (180×180)");

  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="${ACCENT}"/>
  <path d="M17 40A17 17 0 1 1 47 40" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" fill="none"/>
  <path d="M32 37 43 28" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"/>
  <circle cx="32" cy="38" r="3.6" fill="#FFFFFF"/>
</svg>`;
  await writeFile(resolve(ROOT, "public/favicon.svg"), favicon, "utf8");
  console.log("  favicon.svg");

  console.log(`\nIcons written to ${ICONS}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
