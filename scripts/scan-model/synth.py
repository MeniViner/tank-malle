"""Synthetic digit strips that look like the rows the scan engine cuts out (64 px high, grey).

Seven-segment digits (pumps, most digital odometers) and a share of ordinary fonts, with what real
strips carry: italic slant, unlit "ghost" segments, decimal points, both polarities, an LCD window
edge, neighbouring rows peeking in above and below, Hebrew/English labels and "km" beside the number,
blur, glare, noise and JPEG artefacts. Nothing here is a person's data.

    uv run --with numpy --with pillow scripts/scan-model/synth.py --out <dir> --n 200   # writes samples to look at
"""
from __future__ import annotations

import argparse
import io
import json
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

H = 64
# a b c d e f g
SEGMENTS = {
    "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
    "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg",
}
# Displays differ in a few digits: a 7 with its left bar (Gilbarco pumps), a 9 without the bottom bar,
# a 6 without the top bar. One display draws each digit one way, so the choice is per strip.
VARIANTS = {"7": ["abc", "abcf"], "9": ["abcdfg", "abcfg"], "6": ["afgedc", "fgedc"]}
# Things beside an odometer that are not digits: gear letters, ODO/TRIP marks, window edges.
SIDE_MARKS = ["P", "D", "R", "N", "ODO", "TRIP A", "A", "B", "E", "F", "km", "|"]
FONT_DIRS = ["/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts", "/usr/share/fonts"]
LABELS = ["km", "KM", "ODO", "TRIP", "ליטרים", "Litres", "This Sale", "סה\"כ לתשלום", "מחיר לליטר", "95", "₪", "L", "mi"]


def _fonts() -> list[str]:
    found = []
    for d in FONT_DIRS:
        p = Path(d)
        if p.is_dir():
            found += [str(f) for f in p.rglob("*") if f.suffix.lower() in (".ttf", ".otf", ".ttc")]
    return found


FONTS = _fonts()
# Fonts that can draw Hebrew, for the labels beside the number (PIL draws in logical order, so the
# Hebrew labels are reversed before drawing).
HEBREW = [f for f in FONTS if any(k in Path(f).name for k in ("ArialHB", "SFHebrew", "Arial Unicode", "NotoSansHebrew", "DejaVuSans."))] or FONTS
# Digit fonts: ordinary families known to draw 0-9 (many system fonts are symbol or script-only and
# draw empty boxes for digits, which would teach the model wrong labels).
DIGIT_FAMILIES = ("arial", "helvetica", "courier", "menlo", "monaco", "futura", "avenir", "din", "verdana", "georgia",
                  "times", "tahoma", "trebuchet", "gill sans", "optima", "andale", "sfns", "sf-pro", "dejavu", "liberation", "noto sans")
DIGIT_FONTS = [f for f in FONTS if any(k in Path(f).name.lower() for k in DIGIT_FAMILIES) 
               and not any(k in Path(f).name.lower() for k in ("ding", "symbol", "emoji", "hebrew", "hb.", "georgian", "armenian"))]


def segment_polygons(seg: str, x: float, y: float, w: float, h: float, t: float) -> list[tuple[float, float]]:
    """One bar of a seven-segment digit as a hexagon, in a w×h cell at (x, y), bar thickness t."""
    g = t * 0.12  # gap between bars
    hh = h / 2

    def horiz(cy):
        x0, x1 = x + g + t / 2, x + w - g - t / 2
        return [(x0 - t / 2, cy), (x0, cy - t / 2), (x1, cy - t / 2), (x1 + t / 2, cy), (x1, cy + t / 2), (x0, cy + t / 2)]

    def vert(cx, y0, y1):
        y0, y1 = y0 + g + t / 2, y1 - g - t / 2
        return [(cx, y0 - t / 2), (cx + t / 2, y0), (cx + t / 2, y1), (cx, y1 + t / 2), (cx - t / 2, y1), (cx - t / 2, y0)]

    return {
        "a": lambda: horiz(y + t / 2), "g": lambda: horiz(y + hh), "d": lambda: horiz(y + h - t / 2),
        "f": lambda: vert(x + t / 2, y, y + hh), "b": lambda: vert(x + w - t / 2, y, y + hh),
        "e": lambda: vert(x + t / 2, y + hh, y + h), "c": lambda: vert(x + w - t / 2, y + hh, y + h),
    }[seg]()


def random_digits(rng: random.Random) -> tuple[str, int | None]:
    """A number as a display would show it: digits and the index after which a decimal point sits."""
    kind = rng.random()
    if kind < 0.4:   # odometer
        n = rng.choice([4, 5, 5, 6, 6, 6, 6, 7])
        s = str(rng.randint(10 ** (n - 1) if rng.random() < .9 else 0, 10 ** n - 1)).zfill(n)
        return s, None
    if kind < 0.7:   # amount: 2 decimals
        whole = str(rng.randint(1, 999))
        return whole + f"{rng.randint(0, 99):02d}", len(whole) - 1
    if kind < 0.9:   # litres: 2 or 3 decimals
        whole, dec = str(rng.randint(1, 99)), rng.choice([2, 3, 3])
        return whole + str(rng.randint(0, 10 ** dec - 1)).zfill(dec), len(whole) - 1
    whole = str(rng.randint(5, 9))   # price per litre
    return whole + f"{rng.randint(0, 99):02d}", 0


def draw_seven(draw: ImageDraw.ImageDraw, text: str, dot: int | None, x: float, y: float, h: float, rng: random.Random,
               ink: int, ghost: int | None, slant: float) -> float:
    w = h * rng.uniform(0.42, 0.62)
    t = h * rng.uniform(0.09, 0.17)
    pitch = w * rng.uniform(1.25, 1.6)
    # Some displays centre the "1" in its cell; most leave it on the right, where b and c already are.
    centre_one = w * rng.uniform(0.15, 0.4) if rng.random() < 0.4 else 0.0
    shapes = {**SEGMENTS, **{d: rng.choice(v) for d, v in VARIANTS.items()}}
    cells = []
    for i, ch in enumerate(text):
        cells.append((x - (centre_one if ch == "1" else 0), shapes[ch]))
        if dot is not None and i == dot:
            r = t * rng.uniform(0.5, 0.8)
            cx, cy = x + pitch - (pitch - w) / 2, y + h - r
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ink)
        x += pitch
    # Unlit segments first, lit ones over them: a ghost must never cover a lit bar of the next digit.
    for lit in (False, True):
        for cell_x, on in cells:
            for seg in "abcdefg":
                if (seg in on) != lit or (not lit and ghost is None):
                    continue
                if lit and rng.random() < 0.004:   # a dead segment
                    continue
                poly = [(px + (y + h - py) * slant, py) for px, py in segment_polygons(seg, cell_x, y, w, h, t)]
                draw.polygon(poly, fill=ink if lit else ghost)
    return x


def draw_font(draw: ImageDraw.ImageDraw, text: str, dot: int | None, x: float, y: float, h: float, rng: random.Random, ink: int) -> float:
    font = ImageFont.truetype(rng.choice(DIGIT_FONTS), int(h * 1.35))
    s = text if dot is None else text[: dot + 1] + "." + text[dot + 1:]
    box = draw.textbbox((0, 0), s, font=font)
    draw.text((x - box[0], y - box[1] + (h - (box[3] - box[1])) / 2), s, font=font, fill=ink)
    return x + box[2] - box[0]


def label_text(draw, x, y, size, rng, ink) -> float:
    """A word beside the number; returns where it ends."""
    word = rng.choice(LABELS)
    if any("\u0590" <= c <= "\u05ff" for c in word):
        word = word[::-1]
    font = ImageFont.truetype(rng.choice(HEBREW), max(8, int(size)))
    draw.text((x, y), word, font=font, fill=ink)
    return draw.textbbox((x, y), word, font=font)[2]


def render(rng: random.Random) -> tuple[np.ndarray, str]:
    """One strip and its digits. Every digit of the label is visible: panels and edges never cover it."""
    text, dot = random_digits(rng)
    scale = 3   # draw large, then shrink: smooth edges like a camera
    dh = rng.uniform(0.42, 0.78) * H * scale              # digit height
    HH = H * scale
    big = int(dh * (len(text) + 4) * 1.4 + HH * 4)
    dark_on_light = rng.random() < 0.55
    bg = rng.randint(150, 235) if dark_on_light else rng.randint(5, 80)
    ink = rng.randint(0, 70) if dark_on_light else rng.randint(150, 255)
    # Ink is drawn as coverage (0..255) on its own layer and laid over the background at the end.
    mask = Image.new("L", (big, HH), 0)
    d = ImageDraw.Draw(mask)
    ghost = int(255 * rng.uniform(0.08, 0.25)) if rng.random() < 0.35 else None
    y = (HH - dh) / 2 + rng.uniform(-0.08, 0.08) * HH
    slant = rng.uniform(0.05, 0.22) if rng.random() < .55 else 0.0
    x0 = rng.uniform(0.1, 3.0) * dh
    seven = rng.random() < 0.82 or not DIGIT_FONTS
    for side in (-1, 1):   # neighbouring rows, cut off by the strip edges
        if rng.random() < 0.4:
            other, odot = random_digits(rng)
            oy, ox = y + side * dh * rng.uniform(1.15, 1.5), x0 + rng.uniform(-1, 1) * dh
            if seven:
                draw_seven(d, other, odot, ox, oy, dh, rng, 255, ghost, slant)
            else:
                draw_font(d, other, odot, ox, oy, dh, rng, 255)
    x_end = draw_seven(d, text, dot, x0, y, dh, rng, 255, ghost, slant) if seven else draw_font(d, text, dot, x0, y, dh, rng, 255)
    x_end += slant * dh
    right = x_end + rng.uniform(0.1, 0.6) * dh
    if rng.random() < 0.6:
        right = label_text(d, right, y + rng.uniform(0, dh * 0.6), dh * rng.uniform(0.3, 0.6), rng, 255) + rng.uniform(0.1, 0.8) * dh
    if rng.random() < 0.3 and x0 > dh:
        label_text(d, rng.uniform(0, x0 * 0.2), y + rng.uniform(-.2, .6) * dh, dh * rng.uniform(0.25, 0.4), rng, 255)
    if rng.random() < 0.45 and x0 > 0.6 * dh:   # a gear letter, ODO mark or a bar just left of the number
        mark = rng.choice(SIDE_MARKS)
        size = dh * rng.uniform(0.5, 1.1)
        mx = rng.uniform(0, max(1, x0 - 0.9 * size * max(1, len(mark) * 0.6)))
        if mark == "|":
            bw = dh * rng.uniform(0.06, 0.18)
            d.rectangle([mx, y - rng.uniform(0, .3) * dh, mx + bw, y + dh * rng.uniform(.8, 1.3)], fill=255)
        else:
            font = ImageFont.truetype(rng.choice(DIGIT_FONTS), max(8, int(size)))
            d.text((mx, y + rng.uniform(-0.5, 0.4) * dh), mark, font=font, fill=255)
    W = int(min(big, right + rng.uniform(0, 2.0) * dh))
    mask = mask.crop((0, 0, W, HH))
    back = Image.new("L", (W, HH), bg)
    b = ImageDraw.Draw(back)
    if rng.random() < 0.6:   # the display window's edge and the panel around it, never over the number
        panel = rng.randint(0, 255)
        b.rectangle([0, 0, rng.uniform(0, max(1, x0 - 0.15 * dh)), HH], fill=panel)
        edge = rng.uniform(x_end + 0.1 * dh, max(x_end + 0.2 * dh, W))
        if edge < W:
            b.rectangle([edge, 0, W, HH], fill=panel)
        if rng.random() < 0.4:
            b.rectangle([0, 0, W, max(0, y - rng.uniform(0.05, 0.4) * dh)], fill=panel)
    alpha = np.asarray(mask, dtype=np.float32) / 255
    a = np.asarray(back, dtype=np.float32) * (1 - alpha) + ink * alpha
    width = max(H, round(W / scale))
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).resize((width, H), Image.BILINEAR)
    if rng.random() < 0.7:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.2, 1.8)))
    a = np.asarray(img, dtype=np.float32)
    xs = np.linspace(-1, 1, width)[None, :]
    ys = np.linspace(-1, 1, H)[:, None]
    a = a * (1 + rng.uniform(-0.35, 0.35) * xs + rng.uniform(-0.2, 0.2) * ys)   # uneven light
    if rng.random() < 0.25:   # glare
        gx, gy, gr = rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.2, 0.8)
        a = a + rng.uniform(40, 160) * np.exp(-(((xs - gx) * width / H) ** 2 + (ys - gy) ** 2) / gr ** 2)
    a = (a - a.mean()) * rng.uniform(0.35, 1.1) + a.mean() + rng.uniform(-30, 30)
    a = a + np.random.default_rng(rng.randint(0, 2**31)).normal(0, rng.uniform(0, 12), a.shape)
    a = np.clip(a, 0, 255).astype(np.uint8)
    if rng.random() < 0.6:   # field strips are JPEG at quality .82
        buf = io.BytesIO()
        Image.fromarray(a).save(buf, "JPEG", quality=rng.randint(55, 92))
        a = np.asarray(Image.open(io.BytesIO(buf.getvalue())).convert("L"))
    return a, text


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    lines = []
    for i in range(args.n):
        a, text = render(rng)
        Image.fromarray(a).save(out / f"synth-{i:05d}.png")
        lines.append(json.dumps({"file": f"synth-{i:05d}.png", "source": "synth", "label": text}))
    (out / "manifest.jsonl").write_text("\n".join(lines) + "\n")
    print(f"{args.n} strips -> {out}")
