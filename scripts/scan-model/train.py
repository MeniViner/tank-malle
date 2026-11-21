"""Trains the strip model: a small convolutional reader (CTC) that turns one digit strip into its digits.

It is meant to replace only the engine's seven-segment decoder (decode.ts); finding the rows stays in
code. Trains on synthetic strips (synth.py) plus, when given, labelled field strips (strips.mjs
--pulled); reports on held-out real strips next to what the engine's decoder read from the same strip.

    uv run --no-project --with torch --with numpy --with pillow scripts/scan-model/train.py \
        --out <dir> [--steps 6000] [--real <strips dir>]... [--train-real <strips dir>]...

Writes <dir>/model.pt and <dir>/report.json. Nothing here touches the app.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import synth  # noqa: E402

H_IN = 32          # the 64 px strips are halved
MAX_W = 320
BLANK = 10         # CTC blank; classes 0-9 are the digits


def prepare(a: np.ndarray) -> np.ndarray:
    """Grey strip (any size) -> float32 H_IN×w, zero mean, unit spread."""
    img = Image.fromarray(a)
    w = max(16, min(MAX_W, round(img.width * H_IN / img.height)))
    x = np.asarray(img.resize((w, H_IN), Image.BILINEAR), dtype=np.float32)
    return (x - x.mean()) / (x.std() + 8.0)


class StripReader(nn.Module):
    """~0.2 M parameters. Width is divided by 4: one output column per 4 input pixels."""

    def __init__(self) -> None:
        super().__init__()

        def block(i, o, pool):
            return nn.Sequential(nn.Conv2d(i, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True), nn.MaxPool2d(pool) if pool else nn.Identity())

        self.features = nn.Sequential(
            block(1, 16, 2),            # 16×w/2
            block(16, 32, 2),           # 8×w/4
            block(32, 64, None),
            block(64, 64, (2, 1)),      # 4×w/4
            block(64, 96, (2, 1)),      # 2×w/4
            nn.Conv2d(96, 128, (2, 1), bias=False), nn.BatchNorm2d(128), nn.ReLU(inplace=True),   # 1×w/4
        )
        self.sequence = nn.Sequential(
            nn.Conv1d(128, 128, 5, padding=2, bias=False), nn.BatchNorm1d(128), nn.ReLU(inplace=True),
            nn.Conv1d(128, 128, 5, padding=2, bias=False), nn.BatchNorm1d(128), nn.ReLU(inplace=True),
            nn.Conv1d(128, 11, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:   # (N,1,32,W) -> (N,11,W/4) logits
        return self.sequence(self.features(x).squeeze(2))


def batchify(items: list[tuple[np.ndarray, str]]) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    xs = [prepare(a) for a, _ in items]
    W = max(x.shape[1] for x in xs)
    W += (-W) % 4
    batch = np.zeros((len(xs), 1, H_IN, W), dtype=np.float32)
    for i, x in enumerate(xs):
        batch[i, 0, :, : x.shape[1]] = x
    lengths = torch.tensor([x.shape[1] // 4 for x in xs])
    targets = torch.tensor([int(c) for _, t in items for c in t])
    target_lengths = torch.tensor([len(t) for _, t in items])
    return torch.from_numpy(batch), lengths, targets, target_lengths


class SynthStream(torch.utils.data.IterableDataset):
    def __init__(self, batch: int, real: list[tuple[np.ndarray, str]], real_share: float) -> None:
        self.batch, self.real, self.real_share = batch, real, real_share

    def __iter__(self):
        info = torch.utils.data.get_worker_info()
        rng = random.Random((info.id if info else 0) * 7919 + int(time.time()))
        while True:
            items = []
            for _ in range(self.batch):
                if self.real and rng.random() < self.real_share:
                    a, t = rng.choice(self.real)
                    items.append((a, t))
                else:
                    items.append(synth.render(rng))
            yield batchify(items)


def decode(logits: torch.Tensor, length: int) -> tuple[str, float]:
    """Greedy CTC: the digits and a confidence (the least sure emitted digit's probability)."""
    p = logits[:, :length].softmax(0)
    best, idx = p.max(0)
    out, conf, prev = [], 1.0, BLANK
    for k, c in zip(idx.tolist(), best.tolist()):
        if k != BLANK and k != prev:
            out.append(str(k))
            conf = min(conf, c)
        prev = k
    return "".join(out), conf if out else 0.0


def load_strips(folder: str) -> list[dict]:
    rows = [json.loads(l) for l in (Path(folder) / "manifest.jsonl").read_text().splitlines() if l.strip()]
    for r in rows:
        r["image"] = np.asarray(Image.open(Path(folder) / r["file"]).convert("L"))
    return rows


@torch.no_grad()
def evaluate(model: nn.Module, rows: list[dict], device: str) -> dict:
    model.eval()
    results = []
    for i in range(0, len(rows), 64):
        chunk = rows[i: i + 64]
        x, lengths, _, _ = batchify([(r["image"], r["label"] or "0") for r in chunk])
        logits = model(x.to(device)).cpu()
        for r, lg, n in zip(chunk, logits, lengths.tolist()):
            text, conf = decode(lg, n)
            results.append({"file": r["file"], "label": r["label"], "model": text, "confidence": round(conf, 4), "engine": r.get("engine")})
    model.train()
    n = len(results)
    right = sum(r["model"] == r["label"] for r in results)
    engine_right = sum(r["engine"] == r["label"] for r in results if r["engine"] is not None)
    # The rule that matters: how many would be shown wrong at each confidence floor.
    floors = {}
    for floor in (0.5, 0.7, 0.8, 0.9, 0.95, 0.98):
        shown = [r for r in results if r["confidence"] >= floor]
        floors[str(floor)] = {"shown": len(shown), "right": sum(r["model"] == r["label"] for r in shown), "wrong": sum(r["model"] != r["label"] for r in shown)}
    return {"n": n, "model_exact": right, "engine_exact": engine_right, "floors": floors, "rows": results}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--steps", type=int, default=6000)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--real", action="append", default=[], help="labelled strips to report on (never trained on)")
    ap.add_argument("--train-real", action="append", default=[], help="labelled strips mixed into training")
    ap.add_argument("--real-share", type=float, default=0.3)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    torch.manual_seed(args.seed)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    device = "mps" if torch.backends.mps.is_available() else "cpu"

    train_real = [(r["image"], r["label"]) for f in args.train_real for r in load_strips(f) if r["label"]]
    real = [r for f in args.real for r in load_strips(f) if r["label"]]
    synth_val = [{"file": f"synth-{i}", "label": t, "image": a, "engine": None} for i, (a, t) in enumerate(synth.render(random.Random(10_000 + i)) for i in range(500))]

    model = StripReader().to(device)
    print(f"{sum(p.numel() for p in model.parameters()):,} parameters on {device}; {len(train_real)} real training strips, {len(real)} real report strips")
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=args.steps, pct_start=0.1)
    ctc = nn.CTCLoss(blank=BLANK, zero_infinity=True)
    loader = torch.utils.data.DataLoader(SynthStream(args.batch, train_real, args.real_share), batch_size=None, num_workers=args.workers, persistent_workers=True, prefetch_factor=4)
    started, running = time.time(), None
    for step, (x, lengths, targets, target_lengths) in enumerate(loader, 1):
        logits = model(x.to(device))
        log_probs = logits.permute(2, 0, 1).log_softmax(2).cpu()   # CTC runs on CPU (MPS has no CTC kernel)
        loss = ctc(log_probs, targets, lengths, target_lengths)
        opt.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 5.0)
        opt.step()
        sched.step()
        running = loss.item() if running is None else running * 0.98 + loss.item() * 0.02
        if step % 250 == 0 or step == args.steps:
            v = evaluate(model, synth_val, device)
            line = f"step {step:5d}  loss {running:.3f}  synth {v['model_exact']}/{v['n']}"
            if real:
                r = evaluate(model, real, device)
                line += f"  real {r['model_exact']}/{r['n']} (engine {r['engine_exact']})"
            print(line + f"  {time.time() - started:.0f}s", flush=True)
        if step >= args.steps:
            break
    torch.save(model.state_dict(), out / "model.pt")
    report = {"steps": args.steps, "parameters": sum(p.numel() for p in model.parameters()), "synth": evaluate(model, synth_val, device)}
    report["synth"].pop("rows")
    if real:
        report["real"] = evaluate(model, real, device)
    (out / "report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
    if real:
        r = report["real"]
        print(f"\nreal strips: model exact {r['model_exact']}/{r['n']}, engine decoder exact {r['engine_exact']}/{r['n']}")
        for floor, f in r["floors"].items():
            print(f"  confidence >= {floor}: shown {f['shown']}, right {f['right']}, WRONG {f['wrong']}")


if __name__ == "__main__":
    main()
