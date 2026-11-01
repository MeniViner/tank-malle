// Component comparison on the held-out tuning rows (annotated digit rows with
// margins; scripts/scan-train/prepare.py): exact digit strings read by
// PP-OCRv5 mobile, PP-OCRv6-tiny and the compact digit recogniser, each on the
// whole crop. Diagnostic only: real localisation is not involved.
//   node scripts/scan-train/compare-rows.mjs [digits.onnx] [out.json]
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { runnerImport } from 'vite';
const [onnx = '.scan-corpus/train/digits/digits.onnx', out] = process.argv.slice(2);
const ort = await import('onnxruntime-web/wasm');
ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = resolve('node_modules/onnxruntime-web/dist') + '/';
const ppocr = (await runnerImport(resolve('src/lib/scan/ppocr.ts'))).module;
const models = resolve('.scan-corpus/models'), runtime = { tensor: (data, dims) => new ort.Tensor('float32', data, dims) };
const session = async file => ort.InferenceSession.create(await readFile(file), { executionProviders: ['wasm'] });
const v5 = { rec: await session(join(models, 'en_PP-OCRv5_mobile_rec_onnx/inference.onnx')), dictionary: ppocr.dictionaryFromYaml(await readFile(join(models, 'en_PP-OCRv5_mobile_rec_onnx/inference.yml'), 'utf8')) };
const v6 = { rec: await session(join(models, 'PP-OCRv6_tiny_rec_onnx/inference.onnx')), dictionary: ppocr.dictionaryFromYaml(await readFile(join(models, 'PP-OCRv6_tiny_rec_onnx/inference.yml'), 'utf8')) };
const digits = ppocr.digitsVerifier(await session(resolve(onnx)), runtime);
const LOOK = { I: '1', l: '1', i: '1', '|': '1', O: '0', o: '0', D: '0', S: '5', B: '8', Z: '2', G: '6', b: '6', q: '9', g: '9', Y: '4' };
const digitsOf = (text, lookalikes) => [...text].map(c => (lookalikes ? LOOK[c] ?? c : c)).join('').replace(/[^\d]/g, '');
const rows = (await readFile('.scan-corpus/train/trodo-rows/rows.jsonl', 'utf8')).trim().split('\n').map(l => JSON.parse(l)).filter(r => r.split === 'val');
const tally = { v5: 0, v6: 0, v6lookalikes: 0, digits: 0, v5AndDigitsAgreeCorrect: 0, v5AndDigitsAgreeWrong: 0, v5AndV6AgreeCorrect: 0, v5AndV6AgreeWrong: 0 }, rowsOut = [];
for (const r of rows) {
  const { data, info } = await sharp(r.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const image = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) }, box = { left: 0, top: 0, right: info.width, bottom: info.height };
  const truth = r.text.replace(/\D/g, '');
  const a = (await ppocr.recognize(v5.rec, v5.dictionary, runtime, image, box, 0)).text, b = (await ppocr.recognize(v6.rec, v6.dictionary, runtime, image, box, 0)).text, c = await digits(image, box, 0);
  const da = digitsOf(a), db = digitsOf(b, true), dc = digitsOf(c);
  tally.v5 += da === truth; tally.v6 += digitsOf(b) === truth; tally.v6lookalikes += db === truth; tally.digits += dc === truth;
  if (da === dc) tally[da === truth ? 'v5AndDigitsAgreeCorrect' : 'v5AndDigitsAgreeWrong']++;
  if (da === db) tally[da === truth ? 'v5AndV6AgreeCorrect' : 'v5AndV6AgreeWrong']++;
  rowsOut.push({ file: r.file.split('/').pop(), truth, v5: a, v6: b, digits: c });
}
const report = { note: 'Held-out tuning groups (never used for training); whole annotated row crops; digits compared exactly. Diagnostic only.', rows: rows.length, digitsModel: onnx, ...tally };
if (out) await writeFile(out, JSON.stringify({ ...report, perRow: rowsOut }, null, 1) + '\n');
console.log(JSON.stringify(report));
