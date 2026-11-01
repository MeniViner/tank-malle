"""Digit rows from the TRODO tuning split, with exact per-digit annotations.

Each annotated digit box (classes 0-9 and ',') is grouped into rows; a row's
crop and its string (left to right) become one training example. Only the
tuning split is used, and it is split again by vehicle group so no vehicle is
in both training and validation. Test and challenge images are never read.

    .scan-corpus/venv-train/bin/python scripts/scan-train/prepare.py
"""
import hashlib, json, sys
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image, ImageFile, ImageOps

# 78 TRODO JPEGs are truncated; decode what is there, as the benchmark does.
ImageFile.LOAD_TRUNCATED_IMAGES = True

ROOT = Path('.scan-corpus')
OUT = ROOT / 'train' / 'trodo-rows'
ANNOTATIONS = ROOT / 'trodo-v2/trodo-v01/pascal voc 1.1/Annotations'


def rows(boxes):
    """Groups digit boxes into rows: overlapping vertical extents, then by x."""
    boxes = sorted(boxes, key=lambda b: (b[1] + b[3]) / 2)
    out = []
    for b in boxes:
        h = b[3] - b[1]
        for row in out:
            top, bottom = min(r[1] for r in row), max(r[3] for r in row)
            overlap = min(bottom, b[3]) - max(top, b[1])
            if overlap > .5 * min(h, bottom - top):
                row.append(b); break
        else:
            out.append([b])
    return [sorted(r, key=lambda b: b[0]) for r in out]


def main():
    sessions = json.loads(Path('benchmarks/scan/trodo-sessions.json').read_text())['sessions']
    tuning = [s for s in sessions if s['split'] == 'tuning']
    OUT.mkdir(parents=True, exist_ok=True)
    written = []
    for s in tuning:
        name = Path(s['frames'][0]['file']).stem
        xml = ANNOTATIONS / f'{name}.xml'
        if not xml.exists():
            continue
        boxes = []
        for obj in ET.parse(xml).getroot().iter('object'):
            label = obj.findtext('name')
            if label not in list('0123456789') + [',']:
                continue
            bb = obj.find('bndbox')
            boxes.append((*(float(bb.findtext(k)) for k in ('xmin', 'ymin', 'xmax', 'ymax')), label))
        if not boxes:
            continue
        image = ImageOps.exif_transpose(Image.open(ROOT / s['frames'][0]['file'])).convert('RGB')
        # Group 0-19 of 100 buckets (by vehicle group) is validation.
        bucket = int(hashlib.sha256(s['group'].encode()).hexdigest(), 16) % 100
        part = 'val' if bucket < 20 else 'train'
        for i, row in enumerate(rows(boxes)):
            text = ''.join(b[4] for b in row)
            if len(text) < 2:
                continue
            left, top = min(b[0] for b in row), min(b[1] for b in row)
            right, bottom = max(b[2] for b in row), max(b[3] for b in row)
            h = bottom - top
            # Margins as a text detector leaves them: a third of the height
            # around, so neighbouring glyphs (labels, a missed "1") stay visible.
            crop = image.crop((max(0, left - h * .35), max(0, top - h * .3), min(image.width, right + h * .35), min(image.height, bottom + h * .3)))
            file = OUT / f'{name}-{i}.png'
            crop.save(file)
            written.append({'file': str(file), 'text': text, 'split': part, 'group': s['group'], 'role': s['role'], 'session': s['id']})
    (OUT / 'rows.jsonl').write_text(''.join(json.dumps(w) + '\n' for w in written))
    counts = {}
    for w in written:
        counts[w['split']] = counts.get(w['split'], 0) + 1
    print(json.dumps({'rows': len(written), 'byPart': counts, 'groups': len({w['group'] for w in written})}))


if __name__ == '__main__':
    sys.exit(main())
