import type { TextItem, TextReader } from './pipeline';

/**
 * Local PP-OCR text detection (DB) and recognition (CTC) on ONNX Runtime.
 * The runtime is injected, so the app's worker (onnxruntime-web, WASM, one
 * thread) and the Node benchmark run exactly this pre/post-processing.
 * Nothing leaves the device; weights are fetched once, verified and cached.
 */
// Outputs of these models are float32; the element type is checked on use.
type Tensor = { data: unknown; dims: readonly number[] };
const floats = (tensor: Tensor) => { if (!(tensor.data instanceof Float32Array)) throw new Error('expected float32 output'); return tensor.data; };
// Method syntax: onnxruntime's own session type is accepted as is.
export type OrtSession = { inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, unknown>): Promise<Record<string, Tensor>> };
export type OrtRuntime = { tensor: (data: Float32Array, dims: number[]) => unknown };
type Pixels = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
export type PpocrModels = { det: OrtSession; rec: OrtSession; dictionary: string[]; name: string;
  /** DB post-processing from the model's own inference.yml. */
  db: { thresh: number; boxThresh: number; unclip: number };
  /** An independently trained recogniser that must agree on every number. */
  verifier?: { rec: OrtSession; dictionary: string[] } };

// Detector input: BGR, sides multiples of 32 (inference.yml). PaddleOCR applies
// mean/std in listed order to the BGR planes, so B takes 0.485/0.229.
const MEAN = [.485, .456, .406], STD = [.229, .224, .225];
function detInput(image: Pixels, runtime: OrtRuntime, longSide: number) {
  const ratio = longSide / Math.max(image.width, image.height);
  const width = Math.max(32, Math.round(image.width * ratio / 32) * 32), height = Math.max(32, Math.round(image.height * ratio / 32) * 32);
  const plane = width * height, data = new Float32Array(3 * plane), sx = image.width / width, sy = image.height / height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (Math.min(image.height - 1, Math.floor((y + .5) * sy)) * image.width + Math.min(image.width - 1, Math.floor((x + .5) * sx))) * 4, o = y * width + x;
    // Channel order B, G, R as the model was trained (cv2 decoding).
    data[o] = (image.data[i + 2] / 255 - MEAN[0]) / STD[0];
    data[plane + o] = (image.data[i + 1] / 255 - MEAN[1]) / STD[1];
    data[2 * plane + o] = (image.data[i] / 255 - MEAN[2]) / STD[2];
  }
  return { tensor: runtime.tensor(data, [1, 3, height, width]), width, height, sx, sy };
}
/** DB post-processing: connected regions of the probability map above
 * `thresh`, scored by mean probability, expanded by the unclip distance. */
export function dbBoxes(map: ArrayLike<number>, width: number, height: number, { thresh, boxThresh, unclip }: PpocrModels['db']) {
  const seen = new Uint8Array(width * height), queue = new Int32Array(width * height), boxes: { left: number; top: number; right: number; bottom: number; score: number }[] = [];
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || map[start] <= thresh) continue;
    let head = 0, tail = 1, left = width, right = 0, top = height, bottom = 0, sum = 0; queue[0] = start; seen[start] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = (p - x) / width; sum += map[p];
      if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
      for (const n of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1])
        if (n >= 0 && !seen[n] && map[n] > thresh) { seen[n] = 1; queue[tail++] = n; }
    }
    const w = right - left + 1, h = bottom - top + 1, score = sum / tail;
    if (Math.min(w, h) < 3 || score < boxThresh) continue;
    const distance = w * h * unclip / (2 * (w + h));
    boxes.push({ left: Math.max(0, left - distance), top: Math.max(0, top - distance), right: Math.min(width, right + 1 + distance), bottom: Math.min(height, bottom + 1 + distance), score });
  }
  return boxes;
}
/** Recogniser input: height 48, width by aspect, (x/255 − 0.5)/0.5, BGR. */
function recCrop(image: Pixels, box: { left: number; top: number; right: number; bottom: number }, rotate: 0 | 90 | 270) {
  const bw = box.right - box.left, bh = box.bottom - box.top, upright = rotate === 0;
  const aspect = upright ? bw / bh : bh / bw, width = Math.max(8, Math.min(1280, Math.ceil(48 * aspect))), data = new Float32Array(3 * 48 * width), plane = 48 * width;
  for (let y = 0; y < 48; y++) for (let x = 0; x < width; x++) {
    // (u, v) in the upright text frame; rotated boxes are read along their length.
    const u = (x + .5) / width, v = (y + .5) / 48;
    const [fx, fy] = rotate === 0 ? [u, v] : rotate === 90 ? [1 - v, u] : [v, 1 - u];
    const sx = Math.min(image.width - 1, Math.max(0, Math.floor(box.left + fx * bw))), sy = Math.min(image.height - 1, Math.max(0, Math.floor(box.top + fy * bh)));
    const i = (sy * image.width + sx) * 4, o = y * width + x;
    data[o] = image.data[i + 2] / 127.5 - 1; data[plane + o] = image.data[i + 1] / 127.5 - 1; data[2 * plane + o] = image.data[i] / 127.5 - 1;
  }
  return { data, width };
}
export function ctcDecode(probabilities: ArrayLike<number>, steps: number, classes: number, dictionary: string[], offset = 0) {
  // Index 0 is the CTC blank; a final extra class, when present, is the space.
  const characters = classes === dictionary.length + 2 ? [...dictionary, ' '] : dictionary;
  let text = '', confidence = 0, kept = 0, previous = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0, value = -Infinity;
    for (let c = 0; c < classes; c++) { const p = probabilities[offset + t * classes + c]; if (p > value) { value = p; best = c; } }
    if (best !== 0 && best !== previous && characters[best - 1] !== undefined) { text += characters[best - 1]; confidence += value; kept++; }
    previous = best;
  }
  return { text, confidence: kept ? confidence / kept : 0 };
}
async function recognize(rec: OrtSession, dictionary: string[], runtime: OrtRuntime, image: Pixels, box: Parameters<typeof recCrop>[1], rotate: 0 | 90 | 270) {
  const crop = recCrop(image, box, rotate);
  const output = await rec.run({ [rec.inputNames[0]]: runtime.tensor(crop.data, [1, 3, 48, crop.width]) });
  const result = output[rec.outputNames[0]];
  return { ...ctcDecode(floats(result), result.dims[1], result.dims[2], dictionary), rotate };
}
const groups = (text: string) => text.replace(/\s+/g, '').replace(/,(?=\d{3}(?!\d))/g, '').match(/\d+(?:\.\d+)?/g) ?? [];
// Only the verifier's reading is normalised: its wider alphabet writes some
// digits as look-alike letters (I, l, O, o). The accepted value is never altered.
const LOOKALIKE: Record<string, string> = { I: '1', l: '1', i: '1', '|': '1', O: '0', o: '0', D: '0' };
/** Every digit group of the reading must appear, whole, in the verifier's. */
export function verifierAgrees(reading: string, verifier: string) {
  const checked = new Set(groups([...verifier].map(c => LOOKALIKE[c] ?? c).join('')));
  return groups(reading).every(group => checked.has(group));
}
export function createPpocrReader(models: PpocrModels, runtime: OrtRuntime, { longSide = 960, minConfidence = .5 } = {}): TextReader {
  return {
    name: models.name,
    read: async image => {
      const input = detInput(image, runtime, Math.min(longSide, Math.max(image.width, image.height) < 320 ? 640 : longSide));
      const output = await models.det.run({ [models.det.inputNames[0]]: input.tensor });
      const map = floats(output[models.det.outputNames[0]]);
      const items: TextItem[] = [];
      for (const b of dbBoxes(map, input.width, input.height, models.db)) {
        const box = { left: b.left * input.sx, right: b.right * input.sx, top: b.top * input.sy, bottom: b.bottom * input.sy };
        const tall = (box.bottom - box.top) >= 1.5 * (box.right - box.left);
        // Sideways text (a phone held across the dashboard) is read both ways;
        // the more confident reading is kept.
        const read = (rotate: 0 | 90 | 270) => recognize(models.rec, models.dictionary, runtime, image, box, rotate);
        const readings = tall ? [await read(90), await read(270)] : [await read(0)];
        const best = readings.sort((a, b) => b.confidence - a.confidence)[0];
        if (!best.text.trim() || best.confidence < minConfidence) continue;
        let contested: TextItem['contested'], verifierText: string | undefined;
        if (/\d/.test(best.text) && models.verifier) {
          const check = await recognize(models.verifier.rec, models.verifier.dictionary, runtime, image, box, best.rotate);
          if (!verifierAgrees(best.text, check.text)) { contested = 'verifier'; verifierText = check.text; }
        }
        // Report sideways boxes in the reading frame's terms: height is the short side.
        items.push({ text: best.text, left: box.left, right: box.right, top: box.top, height: tall ? box.right - box.left : box.bottom - box.top, score: best.confidence * b.score, ...(contested ? { contested, verifierText } : {}) });
      }
      return items;
    },
  };
}
/** The recognition dictionary embedded in a PaddleOCR inference.yml. */
export function dictionaryFromYaml(yaml: string) {
  const lines = yaml.split('\n'), start = lines.findIndex(line => /^\s*character_dict:\s*$/.test(line)), dictionary: string[] = [];
  if (start < 0) throw new Error('character_dict missing');
  for (const line of lines.slice(start + 1)) {
    const match = /^\s*- (.*)$/.exec(line); if (!match) break;
    const raw = match[1];
    dictionary.push(raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw.startsWith('"') ? JSON.parse(raw) : raw);
  }
  return dictionary;
}
export function dbFromYaml(yaml: string): PpocrModels['db'] {
  const value = (key: string, fallback: number) => Number(new RegExp(`\\n\\s*${key}:\\s*([\\d.]+)`).exec(yaml)?.[1] ?? fallback);
  return { thresh: value('thresh', .3), boxThresh: value('box_thresh', .6), unclip: value('unclip_ratio', 1.5) };
}
