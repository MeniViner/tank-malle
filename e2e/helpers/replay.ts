import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { blank, drawDigits } from '../../src/lib/scan/fixtures';
import { resample } from '../../src/lib/scan/frame';
import { drawText, FONT_SHA256 } from './glyphs';

/**
 * Camera replay: scenes rendered frame by frame into Y4M files that Chromium's
 * fake capture device plays as the camera (`--use-file-for-fake-video-capture`,
 * looping). The app then runs unchanged: getUserMedia, the preview, frame
 * sampling, the production worker with the real models, the session and the
 * form. These are synthetic displays shown to a fake camera, not a phone.
 *
 * Every pixel is computed here (seven-segment shapes, a pinned font drawn by
 * ./glyphs.ts, a box blur, the app's own resampler), never by a system font
 * renderer, and each scene file is checked against its pinned SHA-256
 * (e2e/fixtures/replay-scenes.json), so every machine replays the same frames.
 *
 * Each scene also states what it shows at every moment (`truth`): what is on
 * the display, and what a scan may fill from it.
 */
export const REPLAY_DIR = resolve('.care-device/replay');
const MANIFEST = resolve('e2e/fixtures/replay-scenes.json');
const W = 1280, H = 720, FPS = 3;
type Rgba = { width: number; height: number; data: Uint8ClampedArray };
const NIGHT = [8, 15, 24], AMBER = [255, 196, 80], BLUE = [40, 170, 255];

export type PumpValues = { total: string; liters: string };
export type OdometerValues = { odometer: string };
/**
 * positive: complete and readable; a scan should fill exactly `fill`.
 * blurred / partial: the true values, out of focus or partly out of frame;
 *   filling `fill` is right, abstaining is acceptable.
 * counting: the pump is still running; `displayed` is not final, nothing may be filled.
 * negative: nothing may be filled (a trip meter, a foreign currency).
 * absent: this kind of display is not in the frame; nothing may be filled.
 */
export type Truth<V> = { state: 'positive' | 'blurred' | 'partial' | 'counting' | 'negative' | 'absent'; displayed: V | null; fill: V | null; note?: string };
export type SceneTruth = { pump: Truth<PumpValues>; odometer: Truth<OdometerValues> };
type Scene = { seconds: number; frame: (t: number) => Rgba; truth: (t: number) => SceneTruth };

const PUMP: PumpValues = { total: '287.40', liters: '40.000' }, ODO: OdometerValues = { odometer: '128450' };
const ABSENT = { state: 'absent', displayed: null, fill: null } as const;
const positive = <V>(values: V): Truth<V> => ({ state: 'positive', displayed: values, fill: values });
const pumpOnly = (pump: Truth<PumpValues>): SceneTruth => ({ pump, odometer: ABSENT });
const odometerOnly = (odometer: Truth<OdometerValues>): SceneTruth => ({ pump: ABSENT, odometer });

/** Printed display lettering: the pinned font, condensed. */
const print = (frame: Rgba, text: string, x: number, y: number, color: number[], size = 230) => drawText(frame, text, { x, y, size, color, stretch: .8 });
const word = (frame: Rgba, text: string, x: number, y: number, color: number[], size = 60) => drawText(frame, text, { x, y, size, color });

/** A pump display in printed lettering: amount above volume, optionally with printed words. */
function pump({ total = PUMP.total, liters = PUMP.liters, labels = false, currency = '₪' } = {}) {
  const frame = blank(W, H, NIGHT);
  const end = Math.max(print(frame, total, 300, 300, AMBER), print(frame, liters, 300, 560, AMBER));
  if (labels) { word(frame, `SALE ${currency}`, end + 40, 240, AMBER); word(frame, 'LITRES', end + 40, 500, AMBER); }
  return frame;
}
/** A dashboard odometer in printed lettering, optionally with a trip meter and a clock above it. */
function odometer({ value = ODO.odometer, trip = null as string | null } = {}) {
  const frame = blank(W, H, NIGHT);
  const end = print(frame, value, 320, 600, BLUE); word(frame, 'km', end + 30, 590, BLUE);
  if (trip) { print(frame, trip, 320, 330, BLUE); word(frame, 'TRIP', 150, 320, BLUE, 52); word(frame, 'ODO', 160, 590, BLUE, 52); print(frame, '12:34', 1050, 110, BLUE, 90); }
  return frame;
}
/** A trip meter and a clock with no odometer in view. */
function tripOnly() {
  const frame = blank(W, H, NIGHT);
  const end = print(frame, '117.9', 380, 420, BLUE); word(frame, 'TRIP A', 150, 410, BLUE, 52); word(frame, 'km', end + 30, 410, BLUE);
  print(frame, '12:34', 1050, 110, BLUE, 90);
  return frame;
}
/** The original seven-segment pump: right-aligned rows of large segments. */
function segmentPump() {
  const frame = blank(W, H, NIGHT);
  drawDigits(frame, PUMP.total.padStart(6, ' '), 300, 170, AMBER, 1.2); drawDigits(frame, PUMP.liters.padStart(6, ' '), 300, 420, AMBER, 1.2);
  return frame;
}
/** The original seven-segment odometer with its unit. */
function segmentOdometer() {
  const frame = blank(W, H, NIGHT);
  drawDigits(frame, ODO.odometer, 330, 400, BLUE, 1.2); word(frame, 'km', 920, 510, BLUE, 56);
  return frame;
}
/** The original crowded scene: a seven-segment pump panel beside a dashboard
 * with a trip meter (TRIP) above the odometer (ODO). */
function dashboard() {
  const frame = blank(W, H, NIGHT);
  drawDigits(frame, PUMP.total.padStart(6, ' '), 60, 60, AMBER); drawDigits(frame, PUMP.liters.padStart(6, ' '), 60, 240, AMBER);
  drawDigits(frame, ODO.odometer, 640, 560, BLUE); drawDigits(frame, '12345', 718, 410, BLUE);
  word(frame, 'km', 1130, 640, BLUE, 44); word(frame, 'TRIP', 590, 490, BLUE, 40); word(frame, 'ODO', 530, 640, BLUE, 40);
  return frame;
}

/** Three passes of a box blur (close to a Gaussian), in integers. */
function blur(frame: Rgba, radius: number) {
  const size = 2 * radius + 1;
  let source = frame.data;
  for (let pass = 0; pass < 6; pass++) {
    const out = new Uint8ClampedArray(source), horizontal = pass % 2 === 0, lines = horizontal ? H : W, length = horizontal ? W : H;
    const at = (line: number, i: number) => (horizontal ? line * W + Math.min(length - 1, Math.max(0, i)) : Math.min(length - 1, Math.max(0, i)) * W + line) * 4;
    for (let line = 0; line < lines; line++) for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let i = -radius; i <= radius; i++) sum += source[at(line, i) + c];
      for (let i = 0; i < length; i++) { out[at(line, i) + c] = Math.round(sum / size); sum += source[at(line, i + radius + 1) + c] - source[at(line, i - radius) + c]; }
    }
    source = out;
  }
  return { width: W, height: H, data: source };
}
/** The scene seen through a moving camera (the app's own resampler). */
const move = (frame: Rgba, { dx = 0, dy = 0, zoom = 1 } = {}) => resample(frame, { x: (W - W / zoom) / 2 - dx, y: (H - H / zoom) / 2 - dy, w: W / zoom, h: H / zoom }, W, H);
/** The camera panning from one display to the next: `from` slides out to the left. */
function pan(from: Rgba, to: Rgba, progress: number) {
  const out = blank(W, H, NIGHT), shift = Math.round(progress * W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x + shift, source = sx < W ? from : to, px = sx < W ? sx : sx - W;
    out.data.set(source.data.subarray((y * W + px) * 4, (y * W + px) * 4 + 4), (y * W + x) * 4);
  }
  return out;
}
/** The whole fill-up: the pump for 8 s, a 1 s pan, then the odometer. */
const twoStep = (pumpFrame: () => Rgba, odometerFrame: () => Rgba): Scene => ({ seconds: 30,
  frame: t => (t < 8 ? pumpFrame() : t < 9 ? pan(pumpFrame(), odometerFrame(), (t - 7.75) / 1.25) : odometerFrame()),
  truth: t => (t < 8 ? pumpOnly(positive(PUMP)) : t < 9 ? { pump: { state: 'partial', displayed: PUMP, fill: PUMP }, odometer: { state: 'partial', displayed: ODO, fill: ODO } } : odometerOnly(positive(ODO))) });
const counting = (t: number): PumpValues => { const liters = Math.min(40, 40 * t / 5); return { liters: liters.toFixed(3), total: (Math.round(liters * 7.185 * 100) / 100).toFixed(2) }; };

/** Each scene: frames at 3 fps; the camera loops the file. */
export const SCENES = {
  // Printed lettering, crisp and still: the basic integration fixtures.
  pump: { seconds: 2, frame: () => pump(), truth: () => pumpOnly(positive(PUMP)) },
  odometer: { seconds: 2, frame: () => odometer(), truth: () => odometerOnly(positive(ODO)) },
  // Out of focus for 6 s, then sharp.
  'blur-to-clear': { seconds: 16, frame: t => (t < 6 ? blur(pump(), 8) : pump()), truth: t => pumpOnly(t < 6 ? { state: 'blurred', displayed: PUMP, fill: PUMP } : positive(PUMP)) },
  // A hand-held phone: drift of up to ±50 px and ±5% zoom.
  movement: { seconds: 8, frame: t => move(odometer(), { dx: 50 * Math.sin(t * 1.3), dy: 30 * Math.sin(t * 1.9 + 1), zoom: 1 + .05 * Math.sin(t * .7) }), truth: () => odometerOnly(positive(ODO)) },
  // The pump still counting for 5 s, then stopped at its final values.
  'counting-pump': { seconds: 25, frame: t => pump(counting(t)), truth: t => pumpOnly(t < 5 ? { state: 'counting', displayed: counting(t), fill: null } : positive(PUMP)) },
  // A trip meter (TRIP) and a clock above the odometer (ODO).
  'trip-and-odo': { seconds: 2, frame: () => odometer({ trip: '12345' }), truth: () => odometerOnly({ ...positive(ODO), note: 'TRIP 12345 above, must never be filled' }) },
  // Printed words beside the pump rows.
  'labelled-pump': { seconds: 2, frame: () => pump({ labels: true }), truth: () => pumpOnly(positive(PUMP)) },
  // The original difficult cases: seven-segment displays and the crowded dashboard.
  'segment-pump': { seconds: 2, frame: () => segmentPump(), truth: () => pumpOnly(positive(PUMP)) },
  'segment-odometer': { seconds: 2, frame: () => segmentOdometer(), truth: () => odometerOnly(positive(ODO)) },
  dashboard: { seconds: 2, frame: () => dashboard(), truth: () => ({ pump: positive(PUMP), odometer: { ...positive(ODO), note: 'TRIP 12345 above' } }) },
  // The whole fill-up, printed and seven-segment.
  'pump-then-odometer': twoStep(() => pump(), () => odometer()),
  'segment-pump-then-odometer': twoStep(segmentPump, segmentOdometer),
  // Nothing may be filled from these.
  'trip-only': { seconds: 2, frame: () => tripOnly(), truth: () => odometerOnly({ state: 'negative', displayed: null, fill: null, note: 'TRIP A 117.9 and a clock, no odometer' }) },
  'euro-pump': { seconds: 2, frame: () => pump({ labels: true, currency: '€' }), truth: () => pumpOnly({ state: 'negative', displayed: PUMP, fill: null, note: 'amount in euros' }) },
} satisfies Record<string, Scene>;
export type SceneName = keyof typeof SCENES;
export const sceneFile = (name: SceneName) => resolve(REPLAY_DIR, `${name}.y4m`);
/** The frames of a scene at 3 fps, as the file holds them. */
export const sceneTimes = (name: SceneName) => Array.from({ length: SCENES[name].seconds * FPS }, (_, i) => i / FPS);

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
const sha256 = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');
/**
 * Writes every scene (once per source change) and checks each file against its
 * pinned hash. `REPLAY_PIN=1` re-pins after an intended change to a scene.
 */
export async function writeScenes() {
  await mkdir(REPLAY_DIR, { recursive: true });
  const sources = ['e2e/helpers/replay.ts', 'e2e/helpers/glyphs.ts', 'src/lib/scan/fixtures.ts', 'src/lib/scan/frame.ts'];
  const stamp = createHash('sha256'), stampFile = resolve(REPLAY_DIR, 'stamp');
  for (const source of sources) stamp.update(await readFile(resolve(source)));
  const digest = stamp.digest('hex');
  if (!(existsSync(stampFile) && (await readFile(stampFile, 'utf8')) === digest && Object.keys(SCENES).every(name => existsSync(sceneFile(name as SceneName))))) {
    for (const [name, scene] of Object.entries(SCENES) as [SceneName, Scene][]) {
      const file = await open(sceneFile(name), 'w');
      await file.write(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
      for (const t of sceneTimes(name)) { await file.write('FRAME\n'); await file.write(yuv420(scene.frame(t))); }
      await file.close();
    }
    await writeFile(stampFile, digest);
  }
  const hashes = Object.fromEntries(await Promise.all(Object.keys(SCENES).map(async name => [name, await sha256(sceneFile(name as SceneName))])));
  if (process.env.REPLAY_PIN === '1') { await writeFile(MANIFEST, JSON.stringify({ format: 'tank-maleh-replay-scenes-v1', font: { file: 'e2e/fixtures/fonts/Assistant-Bold.ttf', sha256: FONT_SHA256 }, width: W, height: H, fps: FPS, scenes: hashes }, null, 1) + '\n'); return hashes; }
  const pinned = JSON.parse(await readFile(MANIFEST, 'utf8')).scenes as Record<string, string>;
  const differ = Object.keys(SCENES).filter(name => pinned[name] !== hashes[name]);
  if (differ.length) throw new Error(`replay scenes differ from their pinned pixels (e2e/fixtures/replay-scenes.json): ${differ.map(n => `${n} ${hashes[n]}`).join(', ')}`);
  return hashes;
}
