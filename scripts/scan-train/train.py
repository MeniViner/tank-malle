"""A compact display-digit sequence recogniser (conv features + CTC).

Training data: TRODO tuning-split digit rows (scripts/scan-train/prepare.py,
train groups only) and synthetic display lines with exact labels: seven-
segment glyphs drawn as polygons and several system fonts, both polarities,
decimal points and commas, blur, noise, JPEG, slant, neighbouring labels and
narrow edge "1"s. Validation: the held-out tuning groups. Test and challenge
images are never used.

    .scan-corpus/venv-train/bin/python scripts/scan-train/train.py --steps 6000 --out .scan-corpus/train/digits
"""
import argparse, io, json, math, random, time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

CHARS = '0123456789.,'
H, MAXW = 32, 320
FONTS = [p for p in ['/System/Library/Fonts/Supplemental/Andale Mono.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Supplemental/Courier New Bold.ttf',
                     '/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf', '/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf', '/System/Library/Fonts/Monaco.ttf', '/System/Library/Fonts/Menlo.ttc'] if Path(p).exists()]
SEG = {'0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg'}


class Net(nn.Module):
    """32×W grey → (classes, W/4) logits; class 0 is the CTC blank."""
    def __init__(self, classes=len(CHARS) + 1):
        super().__init__()
        def block(i, o, pool):
            return [nn.Conv2d(i, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True), nn.MaxPool2d(pool)]
        self.features = nn.Sequential(*block(1, 32, (2, 2)), *block(32, 64, (2, 2)), *block(64, 96, (2, 1)), *block(96, 128, (2, 1)), *block(128, 128, (2, 1)))
        self.sequence = nn.Sequential(nn.Conv1d(128, 128, 3, padding=1), nn.ReLU(inplace=True), nn.Conv1d(128, 128, 3, padding=1), nn.ReLU(inplace=True))
        self.out = nn.Conv1d(128, classes, 1)

    def forward(self, x):
        return self.out(self.sequence(self.features(x).squeeze(2)))


def to_input(image):
    """Grey, 32 px high, width by aspect (≤ 320), values in [-1, 1]; padded right with the edge."""
    g = ImageOps.grayscale(image)
    w = max(8, min(MAXW, round(g.width * H / max(1, g.height))))
    a = np.asarray(g.resize((w, H), Image.BILINEAR), dtype=np.float32) / 127.5 - 1
    return a


def seven(draw, text, x, y, h, ink, thick, slant):
    """Seven-segment glyphs; '1' sits at the right of its cell, as on displays."""
    w = h * .5
    for ch in text:
        if ch in '.,':
            draw.rectangle([x, y + h - thick, x + thick, y + h], fill=ink)
            if ch == ',':
                draw.polygon([(x + thick, y + h), (x, y + h + thick * 1.5), (x + thick * .3, y + h)], fill=ink)
            x += thick * 2.2; continue
        segs = {'a': (0, 0, w, 0), 'b': (w, 0, w, h / 2), 'c': (w, h / 2, w, h), 'd': (0, h, w, h), 'e': (0, h / 2, 0, h), 'f': (0, 0, 0, h / 2), 'g': (0, h / 2, w, h / 2)}
        for s in SEG[ch]:
            x0, y0, x1, y1 = segs[s]
            sk = lambda yy: (h - yy) * slant
            if x0 == x1:
                draw.line([(x + x0 + sk(y0), y + y0 + thick * .6), (x + x1 + sk(y1), y + y1 - thick * .6)], fill=ink, width=int(thick))
            else:
                draw.line([(x + x0 + sk(y0) + thick * .6, y + y0), (x + x1 + sk(y1) - thick * .6, y + y1)], fill=ink, width=int(thick))
        x += w * 1.45
    return x


def synthetic(rng):
    n = rng.randint(2, 8)
    digits = ''.join(rng.choice('0123456789' if rng.random() > .25 else '1117') for _ in range(n))
    if rng.random() < .45 and n >= 3:
        places = rng.choice([1, 2, 3])
        digits = digits[:-places] + rng.choice('.,' if rng.random() < .3 else '.') + digits[-places:]
    light = rng.random() < .55
    bg = tuple(rng.randint(0, 60) for _ in range(3)) if light else tuple(rng.randint(150, 235) for _ in range(3))
    ink = tuple(rng.randint(150, 255) for _ in range(3)) if light else tuple(rng.randint(0, 70) for _ in range(3))
    h = rng.randint(28, 60)
    img = Image.new('RGB', (int(h * (len(digits) + 4) * .9) + 40, int(h * 1.9)), bg)
    d = ImageDraw.Draw(img)
    x0 = rng.randint(4, int(h * .6))
    if rng.random() < .6:
        end = seven(d, digits, x0, int(h * .45), h, ink, max(2, int(h * rng.uniform(.09, .16))), rng.uniform(0, .12))
    else:
        font = ImageFont.truetype(rng.choice(FONTS), int(h * 1.25))
        d.text((x0, int(h * .2)), digits, font=font, fill=ink)
        end = x0 + d.textlength(digits, font=font)
    # A neighbouring label is part of real crops; it is not a digit.
    if rng.random() < .35:
        d.text((end + h * .3, int(h * .55)), rng.choice(['km', 'L', 'Km', 'ODO', '₪', 'TRIP']), font=ImageFont.truetype(FONTS[0], int(h * .6)), fill=ink)
        end += h * 1.6
    img = img.crop((0, 0, min(img.width, int(end + rng.uniform(4, h * .5))), img.height))
    if rng.random() < .5:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(.3, 1.8)))
    if rng.random() < .4:
        b = io.BytesIO(); img.save(b, 'JPEG', quality=rng.randint(30, 85)); img = Image.open(b).convert('RGB')
    a = np.asarray(img, dtype=np.float32) + np.random.default_rng(rng.randint(0, 1 << 30)).normal(0, rng.uniform(0, 12), (img.height, img.width, 1))
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)), digits


def real_augment(img, rng):
    if rng.random() < .3:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(.3, 1.2)))
    if rng.random() < .3:
        img = ImageOps.invert(img.convert('RGB'))
    w, h = img.size
    dx, dy = rng.uniform(-.06, .06) * w, rng.uniform(-.08, .08) * h
    return img.crop((max(0, dx), max(0, dy), min(w, w + dx), min(h, h + dy)))


def batch(samples):
    arrays = [to_input(img) for img, _ in samples]
    width = max(a.shape[1] for a in arrays)
    x = np.stack([np.pad(a, ((0, 0), (0, width - a.shape[1])), mode='edge') for a in arrays])[:, None]
    targets = [torch.tensor([CHARS.index(c) + 1 for c in t]) for _, t in samples]
    return torch.from_numpy(x), torch.cat(targets), torch.tensor([len(t) for t in targets]), torch.tensor([a.shape[1] // 4 for a in arrays])


def decode(logits):
    best = logits.argmax(0).tolist(); out, prev = '', 0
    for b in best:
        if b and b != prev: out += CHARS[b - 1]
        prev = b
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--steps', type=int, default=6000); ap.add_argument('--batch', type=int, default=64); ap.add_argument('--seed', type=int, default=20261101); ap.add_argument('--out', default='.scan-corpus/train/digits')
    args = ap.parse_args()
    rng = random.Random(args.seed); torch.manual_seed(args.seed)
    rows = [json.loads(l) for l in Path('.scan-corpus/train/trodo-rows/rows.jsonl').read_text().splitlines()]
    train = [(Image.open(r['file']).convert('RGB'), r['text']) for r in rows if r['split'] == 'train']
    val = [(Image.open(r['file']).convert('RGB'), r['text'], r) for r in rows if r['split'] == 'val']
    device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    net = Net().to(device)
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=args.steps, pct_start=.1)
    ctc = nn.CTCLoss(blank=0, zero_infinity=True)
    started, log = time.time(), []
    for step in range(1, args.steps + 1):
        net.train()
        samples = []
        for _ in range(args.batch):
            if rng.random() < .5:
                img, text = rng.choice(train); samples.append((real_augment(img, rng), text))
            else:
                samples.append(synthetic(rng))
        x, targets, target_lengths, input_lengths = batch(samples)
        logits = net(x.to(device))
        loss = ctc(logits.permute(2, 0, 1).log_softmax(2).cpu(), targets, input_lengths, target_lengths)
        opt.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(net.parameters(), 5); opt.step(); sched.step()
        if step % 500 == 0 or step == args.steps:
            net.eval(); correct = 0
            with torch.no_grad():
                for img, text, _ in val:
                    correct += decode(net(torch.from_numpy(to_input(img))[None, None].to(device))[0].cpu()) == text
            log.append({'step': step, 'loss': round(loss.item(), 4), 'valExact': correct, 'val': len(val), 'seconds': round(time.time() - started)})
            print(json.dumps(log[-1]), flush=True)
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    torch.save(net.state_dict(), out / 'digits.pt')
    (out / 'train-log.json').write_text(json.dumps({'device': str(device), 'steps': args.steps, 'batch': args.batch, 'seed': args.seed, 'trainRows': len(train), 'valRows': len(val), 'params': sum(p.numel() for p in net.parameters()), 'log': log}, indent=1))


if __name__ == '__main__':
    main()
