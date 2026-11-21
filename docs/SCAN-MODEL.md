# Strip model — groundwork (not in the app)

A small trained reader for the one step of the scan engine that fails most on real displays:
turning a digit row the engine has already found into digits (step 3 in `SCAN-ENGINE.md`,
`decode.ts`). Finding the rows, choosing between them by meaning (litres × price = amount, the
odometer journal) and the accept thresholds stay in code.

Nothing here is wired into the app yet. The app's behaviour does not change until a later,
separate change puts the model behind a flag, and that change has to pass the same benchmarks
with no new wrong answers shown.

## Why this scope

- The engine already finds the right row in most failures; it then misreads a blurred or
  reflective seven-segment digit. A strip reader fixes that without touching the rest.
- The field data is already in this shape: `scanImages` keeps the rows the engine cut out (64 px
  high, grey) with their role (`total`, `liters`, `price`, `odometer`), and `scanSamples.final`
  holds the numbers the person saved, so every strip gets a label.
- What it cannot fix: a row the engine never cut out (night smear, a steep angle where the row is
  not found). Those still need code work, or a later detector.

## Pieces

| | |
|---|---|
| `scripts/scan-model/strips.mjs` | builds labelled strips from the owner's photos (`--photos`, labels in `scan-real/labels.json`) or from field samples downloaded with `scan-learn/pull.mjs` (`--pulled`) |
| `scripts/scan-model/synth.py` | synthetic strips: seven-segment and ordinary fonts, slant, ghost segments, decimal points, both polarities, window edges, neighbouring rows, Hebrew/English labels, blur, glare, noise, JPEG |
| `scripts/scan-model/train.py` | trains `StripReader` (≈0.3 M parameters, convolutions only, CTC) and reports exact-match and "shown wrong at each confidence floor" next to the engine's decoder on the same strips |

```bash
node scripts/scan-model/strips.mjs --photos "<photos folder>" --out /tmp/photo-strips
uv run --no-project --with torch --with numpy --with pillow scripts/scan-model/train.py --out /tmp/model --steps 8000 --real /tmp/photo-strips
```

Field strips (people's data; keep them out of the repository, delete when done):

```bash
FIREBASE_SERVICE_ACCOUNT='…' node scripts/scan-learn/pull.mjs --out /tmp/pulled --days 365
node scripts/scan-model/strips.mjs --pulled /tmp/pulled --out /tmp/field-strips
uv run --no-project --with torch --with numpy --with pillow scripts/scan-model/train.py --out /tmp/model --train-real /tmp/field-strips --real /tmp/photo-strips
```

## Rules for putting it in the app (next step)

1. Convolutions only, so the forward pass can be a few hundred lines of TypeScript with the
   weights in a small binary (no ONNX/TF.js runtime, nothing downloaded at scan time), with a
   parity test against PyTorch.
2. The model proposes digits for a strip; the engine's meaning checks still decide. A reading is
   shown only if it passes the same checks and the model's confidence floor.
3. Evaluate on strips it never trained on: the owner's photos are regression evidence (the engine
   was tuned on them), field strips split by account so one person's pump is never in both sets.
4. Ship behind a flag, compare on `scanSamples` by `engine` version, keep the "no wrong answers
   shown" rule: a floor is chosen so wrong-shown stays at or under the engine's.

## First results (2026-11-19, synthetic data only)

10,000 steps, about 10 minutes on an M-series Mac (MPS), 306,491 parameters (~1.2 MB as float32).
Reported on the 117 strips cut from the owner's 43 photos; the model never saw a real strip.

| | exact |
|---|---|
| engine decoder on the same strips | 113 / 117 |
| strip model v1 | 95 / 117 |

| model confidence ≥ | shown | right | wrong |
|---|---|---|---|
| 0.80 | 85 | 82 | 3 |
| 0.90 | 77 | 75 | 2 |
| 0.95 | 69 | 69 | 0 |

How to read this: these strips are biased toward the engine. A strip is kept only when the engine's
own reading of it was close to the true value (that is how a row is matched to its label), so the
engine scores high here by construction. They are a sanity check, not a verdict. The first version
(without the per-display 7/9/6 shapes and the gear letters beside an odometer) read 63 / 117: most
errors were an extra "1" from the "P" mark and a Gilbarco "7" read as 9 or 0.

Remaining errors are mostly part of a neighbouring row or the "km" mark read as an extra digit.
The real test is field strips the engine failed on, which needs a `pull.mjs` export.
