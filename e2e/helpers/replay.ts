import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { blank } from '../../src/lib/scan/fixtures';
import { resample } from '../../src/lib/scan/frame';

/**
 * Camera replay: scenes rendered frame by frame into Y4M files that Chromium's
 * fake capture device plays as the camera (`--use-file-for-fake-video-capture`,
 * looping). The app then runs unchanged: getUserMedia, the preview, frame
 * sampling, the production worker with the real models, the session and the
 * form. These are synthetic displays shown to a fake camera, not a phone.
 *
 * One file per browser launch: a pump scene drives the pump step (the
 * odometer is then typed in the normal form) and an odometer scene drives the
 * odometer step (the pump step is skipped and its values typed).
 */
export const REPLAY_DIR = resolve('.care-device/replay');
const W = 1280, H = 720, FPS = 3;
type Rgba = { width: number; height: number; data: Uint8ClampedArray };
const NIGHT = [8, 15, 24], AMBER = [255, 196, 80], BLUE = [40, 170, 255];

/** Words printed beside the digits, drawn as text over the frame. */
async function withText(frame: Rgba, texts: { text: string; x: number; y: number; size: number; color: number[]; font?: string }[]) {
  if (!texts.length) return frame;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${texts.map(t => `<text x="${t.x}" y="${t.y}" font-family="${t.font ?? 'Arial, Helvetica, sans-serif'}" font-size="${t.size}" fill="rgb(${t.color})">${t.text}</text>`).join('')}</svg>`;
  const { data } = await sharp(Buffer.from(frame.data), { raw: { width: W, height: H, channels: 4 } }).composite([{ input: Buffer.from(svg) }]).raw().toBuffer({ resolveWithObject: true });
  return { width: W, height: H, data: new Uint8ClampedArray(data) };
}
const DISPLAY = 'DIN Condensed';
const digits = (text: string, x: number, y: number, size: number, color: number[]) => ({ text, x, y, size, color, font: DISPLAY });
/** A pump display (printed display font): amount above volume, optionally with printed words. */
async function pump({ total = '287.40', liters = '40.000', labels = false } = {}) {
  return withText(blank(W, H, NIGHT), [digits(total, 360, 260, 170, AMBER), digits(liters, 360, 500, 170, AMBER),
    ...(labels ? [{ text: 'SALE ₪', x: 830, y: 240, size: 56, color: AMBER }, { text: 'LITRES', x: 830, y: 480, size: 56, color: AMBER }] : [])]);
}
/** A dashboard odometer, optionally with a trip meter and a clock above it. */
async function odometer({ value = '128450', trip = null as string | null } = {}) {
  return withText(blank(W, H, NIGHT), [digits(value, 360, 520, 170, BLUE), { text: 'km', x: 820, y: 510, size: 56, color: BLUE },
    ...(trip ? [digits(trip, 360, 280, 170, BLUE), { text: 'TRIP', x: 180, y: 270, size: 52, color: BLUE }, { text: 'ODO', x: 190, y: 510, size: 52, color: BLUE }, digits('12:34', 1040, 110, 70, BLUE)] : [])]);
}
/** The scene seen through a moving, refocusing camera. */
async function transform(frame: Rgba, { blur = 0, dx = 0, dy = 0, zoom = 1 } = {}) {
  const view = resample(frame, { x: (W - W / zoom) / 2 - dx, y: (H - H / zoom) / 2 - dy, w: W / zoom, h: H / zoom }, W, H);
  if (!blur) return view;
  const { data } = await sharp(Buffer.from(view.data), { raw: { width: W, height: H, channels: 4 } }).blur(blur).raw().toBuffer({ resolveWithObject: true });
  return { width: W, height: H, data: new Uint8ClampedArray(data) };
}

/** Each scene: frames at 3 fps; the camera loops the file. */
export const SCENES = {
  // Crisp and still.
  pump: { seconds: 2, frame: async () => pump() },
  odometer: { seconds: 2, frame: async () => odometer() },
  // Out of focus for 6 s, then sharp.
  'blur-to-clear': { seconds: 16, frame: async (t: number) => transform(await pump(), { blur: t < 6 ? 8 : 0 }) },
  // A hand-held phone: drift of up to ±50 px and ±5% zoom.
  movement: { seconds: 8, frame: async (t: number) => transform(await odometer(), { dx: 50 * Math.sin(t * 1.3), dy: 30 * Math.sin(t * 1.9 + 1), zoom: 1 + .05 * Math.sin(t * .7) }) },
  // The pump still counting for 5 s, then stopped at its final values.
  'counting-pump': { seconds: 25, frame: async (t: number) => { const liters = Math.min(40, 40 * t / 5); return pump({ liters: liters.toFixed(3), total: (Math.round(liters * 7.185 * 100) / 100).toFixed(2) }); } },
  // A trip meter (TRIP) and a clock above the odometer (ODO).
  'trip-and-odo': { seconds: 2, frame: async () => odometer({ trip: '12345' }) },
  // Printed words beside the pump rows.
  'labelled-pump': { seconds: 2, frame: async () => pump({ labels: true }) },
} satisfies Record<string, { seconds: number; frame: (t: number) => Promise<Rgba> }>;
export type SceneName = keyof typeof SCENES;
export const sceneFile = (name: SceneName) => resolve(REPLAY_DIR, `${name}.y4m`);

/** Full-range BT.601 YUV 4:2:0 (C420jpeg), as Chromium's Y4M reader expects. */
function yuv420(frame: Rgba) {
  const out = Buffer.alloc(W * H * 3 / 2), d = frame.data, u = W * H, v = u + W * H / 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; out[y * W + x] = Math.round(.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]); }
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    let r = 0, g = 0, b = 0;
    for (const [px, py] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) { const i = (py * W + px) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    r /= 4; g /= 4; b /= 4; const o = (y / 2) * (W / 2) + x / 2;
    out[u + o] = Math.max(0, Math.min(255, Math.round(-.168736 * r - .331264 * g + .5 * b + 128)));
    out[v + o] = Math.max(0, Math.min(255, Math.round(.5 * r - .418688 * g - .081312 * b + 128)));
  }
  return out;
}
/** Writes every scene once; a stamp of this file's source keeps them current. */
export async function writeScenes() {
  await mkdir(REPLAY_DIR, { recursive: true });
  const stamp = createHash('sha256').update(await readFile(resolve('e2e/helpers/replay.ts'))).update(await readFile(resolve('src/lib/scan/fixtures.ts'))).digest('hex'), stampFile = resolve(REPLAY_DIR, 'stamp');
  if (existsSync(stampFile) && (await readFile(stampFile, 'utf8')) === stamp && Object.keys(SCENES).every(name => existsSync(sceneFile(name as SceneName)))) return;
  for (const [name, scene] of Object.entries(SCENES)) {
    const file = await open(sceneFile(name as SceneName), 'w');
    await file.write(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
    for (let i = 0; i < scene.seconds * FPS; i++) { await file.write('FRAME\n'); await file.write(yuv420(await scene.frame(i / FPS))); }
    await file.close();
  }
  await writeFile(stampFile, stamp);
}
