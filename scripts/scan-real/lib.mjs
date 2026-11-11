import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..');
export async function load(module) {
  const { runnerImport } = await import('vite');
  return (await runnerImport(join(repo, module))).module;
}
export async function readRGBA(path, maxSide = 0) {
  const sharp = (await import('sharp')).default;
  let p = sharp(path, { failOn: 'none' }).rotate();
  if (maxSide) p = p.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
  const { data, info } = await p.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}
export const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : pairs, []));
