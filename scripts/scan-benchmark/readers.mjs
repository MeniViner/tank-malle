// Local text recognisers for the Node benchmark. They run the same
// pre/post-processing as the app (src/lib/scan/ppocr.ts) on onnxruntime-web's
// WASM backend with one thread, i.e. the configuration the PWA ships.
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), models = join(repo, '.scan-corpus/models');
const VARIANTS = {
  'ppocr-v5-mobile': { det: 'PP-OCRv5_mobile_det_onnx', rec: 'en_PP-OCRv5_mobile_rec_onnx' },
  'ppocr-v6-tiny': { det: 'PP-OCRv6_tiny_det_onnx', rec: 'PP-OCRv6_tiny_rec_onnx' },
  // v5 detection and recognition; every number must be read the same by the
  // independently trained v6-tiny recogniser.
  'ppocr-v5+v6': { det: 'PP-OCRv5_mobile_det_onnx', rec: 'en_PP-OCRv5_mobile_rec_onnx', verifier: 'PP-OCRv6_tiny_rec_onnx' },
};
export async function createTextReader(name, options = {}) {
  if (name === 'tesseract') return createTesseract();
  const variant = VARIANTS[name]; if (!variant) throw new Error(`unknown text reader ${name}`);
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = join(repo, 'node_modules/onnxruntime-web/dist') + '/';
  const { runnerImport } = await import('vite');
  const ppocr = (await runnerImport(join(repo, 'src/lib/scan/ppocr.ts'))).module;
  const session = async dir => ort.InferenceSession.create(await readFile(join(models, dir, 'inference.onnx')), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const detYaml = await readFile(join(models, variant.det, 'inference.yml'), 'utf8'), recYaml = await readFile(join(models, variant.rec, 'inference.yml'), 'utf8');
  const verifier = variant.verifier ? { rec: await session(variant.verifier), dictionary: ppocr.dictionaryFromYaml(await readFile(join(models, variant.verifier, 'inference.yml'), 'utf8')) } : undefined;
  return ppocr.createPpocrReader({ name, det: await session(variant.det), rec: await session(variant.rec), dictionary: ppocr.dictionaryFromYaml(recYaml), db: ppocr.dbFromYaml(detYaml), verifier }, { tensor: (data, dims) => new ort.Tensor('float32', data, dims) }, options);
}
async function createTesseract() {
  const { createWorker, PSM } = await import('tesseract.js');
  const sharp = (await import('sharp')).default;
  const start = async () => {
    const worker = await createWorker('eng', 1, { cachePath: join(repo, '.scan-corpus/models/tesseract'), logger: () => {} });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300' });
    return worker;
  };
  let worker = await start(), timeouts = 0;
  return {
    name: 'tesseract',
    get timeouts() { return timeouts; },
    // The Tesseract worker keeps the event loop alive until it is terminated.
    close: () => worker.terminate(),
    read: async image => {
      // Tesseract takes an encoded image; PNG keeps the pixels exact.
      const png = await sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length), { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer();
      // Some inputs never return; such a read counts as "no text" and the
      // Tesseract worker is replaced. Timeouts are reported with the run.
      let timer;
      const result = await Promise.race([worker.recognize(png, {}, { blocks: true }), new Promise(resolve => { timer = setTimeout(() => resolve(null), 20_000); })]);
      clearTimeout(timer);
      if (!result) { timeouts++; await worker.terminate().catch(() => {}); worker = await start(); return []; }
      const words = (result.data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)));
      return words.filter(w => w.confidence >= 50).map(w => ({ text: w.text, left: w.bbox.x0, right: w.bbox.x1, top: w.bbox.y0, height: w.bbox.y1 - w.bbox.y0, score: w.confidence / 100 }));
    },
  };
}
