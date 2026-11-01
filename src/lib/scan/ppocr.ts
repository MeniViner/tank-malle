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
  verifier?: { rec: OrtSession; dictionary: string[] };
  /** Further checks that must also agree (benchmark experiments). */
  verifiers?: Verify[] };
/** A second reading of one detected box. */
export type Verify = (image: Pixels, box: { left: number; top: number; right: number; bottom: number }, rotate: 0 | 90 | 270) => Promise<string>;
/** The compact display-digit recogniser (scripts/scan-train): grey, 32 px high,
 * values in [-1, 1]; classes blank, 0-9, '.', ','. Each input pixel averages
 * the source pixels it covers, as training resized its crops: picking single
 * pixels loses the thin strokes of large digits. It reports a separator as
 * '.', since it confuses a decimal point with a comma. */
export function digitsVerifier(session: OrtSession, runtime: OrtRuntime): Verify {
  const chars = '0123456789..';
  return async (image, box, rotate) => {
    const bw = box.right - box.left, bh = box.bottom - box.top, aspect = rotate === 0 ? bw / bh : bh / bw;
    const width = Math.max(8, Math.min(320, Math.round(32 * aspect))), data = new Float32Array(32 * width);
    const grey = (x: number, y: number) => { const i = (Math.min(image.height - 1, Math.max(0, y)) * image.width + Math.min(image.width - 1, Math.max(0, x))) * 4; return .299 * image.data[i] + .587 * image.data[i + 1] + .114 * image.data[i + 2]; };
    // Source footprint of one input pixel along the box, sampled on a small grid.
    const grid = Math.max(1, Math.min(6, Math.ceil(Math.max(bw, bh) / Math.max(width, 32))));
    for (let y = 0; y < 32; y++) for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let j = 0; j < grid; j++) for (let k = 0; k < grid; k++) {
        const u = (x + (k + .5) / grid) / width, v = (y + (j + .5) / grid) / 32, [fx, fy] = rotate === 0 ? [u, v] : rotate === 90 ? [1 - v, u] : [v, 1 - u];
        sum += grey(Math.floor(box.left + fx * bw), Math.floor(box.top + fy * bh));
      }
      data[y * width + x] = sum / (grid * grid) / 127.5 - 1;
    }
    const output = await session.run({ [session.inputNames[0]]: runtime.tensor(data, [1, 1, 32, width]) }), logits = floats(output[session.outputNames[0]]);
    const [, classes, steps] = output[session.outputNames[0]].dims;
    let text = '', previous = 0;
    for (let t = 0; t < steps; t++) {
      let best = 0; for (let c = 1; c < classes; c++) if (logits[c * steps + t] > logits[best * steps + t]) best = c;
      if (best && best !== previous) text += chars[best - 1];
      previous = best;
    }
    return text;
  };
}

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
  const seen = new Uint8Array(width * height), queue = new Int32Array(width * height), boxes: { left: number; top: number; right: number; bottom: number; score: number; core: { left: number; top: number; right: number; bottom: number } }[] = [];
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
    // `core`: the text region itself, before the unclip expansion.
    boxes.push({ left: Math.max(0, left - distance), top: Math.max(0, top - distance), right: Math.min(width, right + 1 + distance), bottom: Math.min(height, bottom + 1 + distance), score, core: { left, top, right: right + 1, bottom: bottom + 1 } });
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
/**
 * Greedy CTC decoding. `doubts[i]` is, for the gap before emitted character i
 * (the last entry: after the last character), the highest probability the
 * model gave a digit at a blank step there: a digit it nearly read but did
 * not emit, such as a narrow seven-segment "1" beside a number. `centres[i]`
 * is where character i was read, as a share of the input's width (the middle
 * of its run of steps).
 */
export function ctcDecode(probabilities: ArrayLike<number>, steps: number, classes: number, dictionary: string[], offset = 0) {
  // Index 0 is the CTC blank; a final extra class, when present, is the space.
  const characters = classes === dictionary.length + 2 ? [...dictionary, ' '] : dictionary;
  const digits = characters.flatMap((c, i) => (/^\d$/.test(c) ? [i + 1] : []));
  let text = '', confidence = 0, kept = 0, previous = -1, start = 0;
  const doubts = [0], centres: number[] = [];
  for (let t = 0; t < steps; t++) {
    let best = 0, value = -Infinity;
    for (let c = 0; c < classes; c++) { const p = probabilities[offset + t * classes + c]; if (p > value) { value = p; best = c; } }
    if (best === 0) for (const d of digits) doubts[text.length] = Math.max(doubts[text.length], probabilities[offset + t * classes + d]);
    if (best !== 0 && best !== previous && characters[best - 1] !== undefined) { text += characters[best - 1]; confidence += value; kept++; doubts.push(0); centres.push(t + .5); start = t; }
    else if (best !== 0 && best === previous && centres.length) centres[centres.length - 1] = (start + t + 1) / 2;
    previous = best;
  }
  return { text, confidence: kept ? confidence / kept : 0, doubts: doubts.map(d => Math.round(d * 100) / 100), centres: centres.map(c => c / steps) };
}
/** One box read by a recognition model (exported for the component benchmark). */
export async function recognize(rec: OrtSession, dictionary: string[], runtime: OrtRuntime, image: Pixels, box: Parameters<typeof recCrop>[1], rotate: 0 | 90 | 270) {
  const crop = recCrop(image, box, rotate);
  const output = await rec.run({ [rec.inputNames[0]]: runtime.tensor(crop.data, [1, 3, 48, crop.width]) });
  const result = output[rec.outputNames[0]];
  return { ...ctcDecode(floats(result), result.dims[1], result.dims[2], dictionary), rotate };
}
type Edges = { left: number; top: number; right: number; bottom: number };
/**
 * A detector box can end inside a glyph: the sparse first segment of a
 * seven-segment "2" left outside, the right strokes of a last "0" cut off,
 * and the recogniser reads another digit ("287.40" as "187,40"). Where the
 * box's ink (the minority side of its Otsu split) runs across a side edge,
 * that edge moves out to the next blank gap, by at most 0.6 × the box height.
 * Ink that runs on further is not a cut glyph, and the edge stays.
 */
export function widen(image: Pixels, box: Edges): Edges {
  const { width, height, data } = image;
  const top = Math.max(0, Math.round(box.top)), bottom = Math.min(height, Math.round(box.bottom)), left = Math.max(0, Math.round(box.left)), right = Math.min(width, Math.round(box.right));
  const h = bottom - top;
  if (h < 8 || right - left < 8) return box;
  const luminance = (x: number, y: number) => { const i = (y * width + x) * 4; return Math.round(.299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2]); };
  const histogram = new Uint32Array(256); let total = 0, sum = 0;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) { const v = luminance(x, y); histogram[v]++; total++; sum += v; }
  let below = 0, belowSum = 0, best = -1, threshold = 127;
  for (let i = 0; i < 255; i++) {
    below += histogram[i]; belowSum += i * histogram[i]; if (!below || below === total) continue;
    const diff = belowSum / below - (sum - belowSum) / (total - below), variance = below * (total - below) * diff * diff;
    if (variance > best) { best = variance; threshold = i; }
  }
  let bright = 0; for (let i = threshold + 1; i < 256; i++) bright += histogram[i];
  const lightInk = bright < total / 2, minimum = Math.max(2, h * .03);
  const inked = (x: number) => { if (x < 0 || x >= width) return false; let n = 0; for (let y = top; y < bottom; y++) n += +(lightInk ? luminance(x, y) > threshold : luminance(x, y) <= threshold); return n >= minimum; };
  const reach = Math.round(h * .6), gap = Math.max(2, Math.round(h * .1));
  // `outside`: the first column beyond the edge; returns the new edge column, or null.
  const edge = (outside: number, step: number) => {
    if (!inked(outside - step) || !inked(outside)) return null;
    for (let x = outside, blank = 0; Math.abs(x - outside) <= reach; x += step) {
      if (x < 0 || x >= width) return null;
      blank = inked(x) ? 0 : blank + 1;
      if (blank >= gap) return x - step * (gap - 1);
    }
    return null;
  };
  const l = edge(left - 1, -1), r = edge(right, 1);
  return l === null && r === null ? box : { ...box, left: l ?? box.left, right: r === null ? box.right : r + 1 };
}
// Currency signs the second recogniser's wider alphabet reads where the first
// drops or misreads them (a "€" detected alone, read as "C" at 0.17).
const CURRENCY = /^[€$£₺₽¥]$/;
const groups = (text: string) => text.replace(/\s+/g, '').replace(/,(?=\d{3}(?!\d))/g, '').replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2').match(/\d+(?:\.\d+)?/g) ?? [];
// Only the verifier's reading is normalised: its wider alphabet writes some
// digits as look-alike letters (I, l, O, o), and seven-segment digits as the
// letters they are drawn like (S 5, B 8, Z 2, G/b 6, q/g 9, Y 4). The accepted
// value is never altered, and a verifier that drops or adds a digit still
// disagrees.
const LOOKALIKE: Record<string, string> = { I: '1', l: '1', i: '1', '|': '1', O: '0', o: '0', D: '0', Q: '0', S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6', b: '6', q: '9', g: '9', Y: '4', y: '4' };
/** Every digit group of the reading must appear, whole, in the verifier's,
 * read either as written or with look-alikes as digits (a unit misread as
 * "im" after the number is not a "1"). */
export function verifierAgrees(reading: string, verifier: string) {
  const checked = new Set([...groups(verifier), ...groups([...verifier].map(c => LOOKALIKE[c] ?? c).join(''))]);
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
      const checks: Verify[] = [...(models.verifier ? [async (...args: Parameters<Verify>) => (await recognize(models.verifier!.rec, models.verifier!.dictionary, runtime, ...args)).text] : []), ...(models.verifiers ?? [])];
      /** The first verifier reading that disagrees with `text` on this box, if any. */
      const dispute = async (text: string, box: Edges, rotate: 0 | 90 | 270) => { for (const check of checks) { const other = await check(image, box, rotate); if (!verifierAgrees(text, other)) return other; } return null; };
      for (const b of dbBoxes(map, input.width, input.height, models.db)) {
        let box: Edges = { left: b.left * input.sx, right: b.right * input.sx, top: b.top * input.sy, bottom: b.bottom * input.sy };
        const tall = (box.bottom - box.top) >= 1.5 * (box.right - box.left);
        // Sideways text (a phone held across the dashboard) is read both ways;
        // the more confident reading is kept.
        const read = (rotate: 0 | 90 | 270, on = box) => recognize(models.rec, models.dictionary, runtime, image, on, rotate);
        const readings = tall ? [await read(90), await read(270)] : [await read(0)];
        let best = readings.sort((a, b) => b.confidence - a.confidence)[0];
        if (!tall && models.verifier && !/\d/.test(best.text)) {
          // A lone narrow glyph is read with some background either side: the
          // recognisers read little from a crop narrower than it is tall.
          const pad = box.right - box.left < box.bottom - box.top ? (box.bottom - box.top) / 2 : 0;
          const second = await recognize(models.verifier.rec, models.verifier.dictionary, runtime, image, { ...box, left: Math.max(0, box.left - pad), right: Math.min(image.width, box.right + pad) }, 0);
          const signs = second.confidence >= minConfidence ? second.text.split(/\s+/).filter(token => CURRENCY.test(token) && !best.text.includes(token)) : [];
          if (signs.length) best = best.confidence >= minConfidence ? { ...best, text: `${best.text} ${signs.join(' ')}` } : { ...best, text: signs.join(' '), confidence: second.confidence };
        }
        if (!best.text.trim() || best.confidence < minConfidence) continue;
        let contested: TextItem['contested'], verifierText: string | undefined;
        if (/\d/.test(best.text)) {
          let disputed = await dispute(best.text, box, best.rotate);
          // A box cutting a glyph: read again on the widened box. The same
          // reading keeps the widened box; a reading that only the widened box
          // gets agreed by the verifier replaces a disputed one; numbers that
          // change otherwise make the number unsure. (Widening into a glued
          // unit, "159073" and "159073km", changes no number.)
          const wide = tall ? box : widen(image, box);
          if (wide !== box) {
            const again = await read(0, wide), same = groups(again.text).join(' ') === groups(best.text).join(' ');
            if (again.text === best.text) { box = wide; best = again; }
            else if (disputed !== null && !same && again.confidence >= minConfidence && (await dispute(again.text, wide, 0)) === null) { box = wide; best = again; disputed = null; }
            else if (!same) { contested = 'edge'; verifierText = again.text; }
          }
          if (disputed !== null) { contested = 'verifier'; verifierText = disputed; }
        }
        // Report sideways boxes in the reading frame's terms: height is the short side.
        const core = { left: b.core.left * input.sx, right: b.core.right * input.sx, top: b.core.top * input.sy, height: (b.core.bottom - b.core.top) * input.sy };
        const centres = !tall && best.centres.length === best.text.length ? best.centres.map(f => box.left + f * (box.right - box.left)) : undefined;
        items.push({ text: best.text, left: box.left, right: box.right, top: box.top, height: tall ? box.right - box.left : box.bottom - box.top, score: best.confidence * b.score, doubts: best.doubts, core, ...(centres ? { centres } : {}), ...(contested ? { contested, verifierText } : {}) });
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
