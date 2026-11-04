"""Exports the trained recogniser to ONNX and checks CPU onnxruntime parity.

Writes digits.onnx, its sha256, and parity-samples.json (inputs and PyTorch
logits) for the browser WASM check (scripts/scan-train/parity.mjs).

    .scan-corpus/venv-train/bin/python scripts/scan-train/export.py .scan-corpus/train/digits
"""
import hashlib, json, sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from train import Net, to_input  # noqa: E402

out = Path(sys.argv[1] if len(sys.argv) > 1 else '.scan-corpus/train/digits')
net = Net(); net.load_state_dict(torch.load(out / 'digits.pt', map_location='cpu')); net.eval()
onnx_file = out / 'digits.onnx'
torch.onnx.export(net, (torch.zeros(1, 1, 32, 128),), str(onnx_file), input_names=['x'], output_names=['logits'], opset_version=17,
                  dynamic_axes={'x': {3: 'width'}, 'logits': {2: 'steps'}}, dynamo=False)
session = ort.InferenceSession(str(onnx_file), providers=['CPUExecutionProvider'])
rows = [json.loads(l) for l in Path('.scan-corpus/train/trodo-rows/rows.jsonl').read_text().splitlines() if '"val"' in l][:24]
samples, worst = [], 0.0
for r in rows:
    x = to_input(Image.open(r['file']).convert('RGB'))[None, None]
    with torch.no_grad():
        expected = net(torch.from_numpy(x)).numpy()
    got = session.run(None, {'x': x})[0]
    worst = max(worst, float(np.abs(expected - got).max()))
    samples.append({'shape': list(x.shape), 'x': [round(float(v), 6) for v in x.ravel()], 'logits': [round(float(v), 5) for v in expected.ravel()], 'logitsShape': list(expected.shape)})
(out / 'parity-samples.json').write_text(json.dumps(samples))
digest = hashlib.sha256(onnx_file.read_bytes()).hexdigest()
print(json.dumps({'onnx': str(onnx_file), 'bytes': onnx_file.stat().st_size, 'sha256': digest, 'cpuOrtMaxAbsDiff': worst, 'samples': len(samples), 'torch': torch.__version__, 'onnxruntime': ort.__version__}))
