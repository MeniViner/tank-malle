/**
 * The local recogniser's runtime files, pinned by content. They are served
 * from this origin under a versioned path, fetched only when scanning is first
 * used (never precached on install), verified against these hashes, and kept
 * in a versioned Cache Storage entry so scanning works offline afterwards.
 * Sources: onnxruntime-web 1.30.0 (MIT), the official PaddlePaddle ONNX
 * exports on Hugging Face (Apache-2.0) at the commits named in `source`, and
 * the display-digit verifier trained in this repository (scripts/scan-train;
 * TRODO, CC BY 4.0, and synthetic displays), committed under models/.
 */
export type ScanModelFile = { name: string; source: string; sha256: string; bytes: number };
export const SCAN_MODEL_VERSION = 'ppocr5-digits1-ort1.30.0';
/** onnxruntime-web's WebAssembly binary: Vite emits it as a content-hashed
 * asset; the worker still checks it against this hash before use. */
export const SCAN_RUNTIME: ScanModelFile = { name: 'ort-wasm-simd-threaded.wasm', source: 'npm:onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.wasm', sha256: '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2', bytes: 14239897 };
export const SCAN_MODEL_FILES: ScanModelFile[] = [
  { name: 'det.onnx', source: 'https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/e6f4fa85f00e168c862bc462aebca69eef9b3d3d/inference.onnx', sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d', bytes: 4826518 },
  { name: 'rec.onnx', source: 'https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx/resolve/3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b/inference.onnx', sha256: 'b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f', bytes: 7848423 },
  // The verifier: a compact display-digit recogniser (digits, '.', ',').
  { name: 'digits.onnx', source: 'repo:models/display-digits-v1.onnx', sha256: 'ac547e43c689d7dce68841cbcb037d1f687016653c90368325a18913f9577bc4', bytes: 1735338 },
];
/** DB post-processing values from PP-OCRv5_mobile_det's inference.yml. */
export const SCAN_DETECTION = { thresh: .3, boxThresh: .6, unclip: 1.5 };
export const scanModelPath = (name: string) => `/scan-models/${SCAN_MODEL_VERSION}/${name}`;
export const SCAN_MODEL_CACHE = `tank-maleh-scan-${SCAN_MODEL_VERSION}`;
