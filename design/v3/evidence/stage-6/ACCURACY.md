# Stage 6 — scan accuracy, before (v1) vs after (v2)

Protocol: [`PROTOCOL.md`](PROTOCOL.md) (committed in `ae03d94` before any held-out
run). Script: `node scripts/scan-v2/accuracy.mjs` (+ `scripts/scan-v2/metrics.ts`,
unit-tested). Raw per-image results: [`runs/`](runs/). v2 code frozen at `3dc56f6`.

## Read this first

- **Real pump accuracy is unmeasured.** Only 3 real Israeli pump photos exist;
  v2 got **0 of 3** right (details below). Nothing here supports a claim that v2
  reads pumps.
- **Odometer numbers come from TRODO** (public, Turkish dashboards, mostly
  dot-matrix/LCD fonts rather than seven-segment), not from Israeli cars or from
  this app's camera. The guide box is **simulated from annotations** (good framing),
  which is optimistic.
- **v2 is wrong far more often than v1.** v1 almost always abstains; when it
  answers it is usually right. v2 proposes a value most of the time and about
  half of those proposals are wrong. That is only acceptable because v2 always
  stops on the verification screen; it must never auto-fill.
- The tuning split was used for every v2 decision; its numbers are **not**
  independent evidence and are shown only to expose the tuning→test drop.
- The on-device correction log is empty (new feature, not yet run on a phone),
  so it contributes no data. No synthetic result is included below.

## Dataset

| Set | Images | Role in this work |
|---|---|---|
| TRODO tuning, eligible | 371 | tuned on (not evidence) |
| TRODO test, eligible | 713 | held out, read once |
| TRODO challenge, eligible | 139 | held out, read once (hard cases: glare, blur, angle) |
| Israeli pump photos (Commons) | 3 | read once |

All files hash-checked; every run `complete` (0 missing). Leading zeros ignored.

## Odometer (TRODO) — held-out test split, 713 images, no history

Guide box = annotated display box + 10 %.

| Reader | Answered | Abstained | Correct | Wrong | Field accuracy | Answered precision | Digit acc. (answered) | Digit acc. (abstain = wrong) | Top-3 hit |
|---|---|---|---|---|---|---|---|---|---|
| v1, whole photo (as the app reads a file today) | 13 | 700 | 13 | 0 | 1.8 % | 100 % | 100 % | 1.9 % | — |
| v1, same crop as v2 | 34 | 679 | 27 | 7 | 3.8 % | 79.4 % | 86.1 % | 4.2 % | — |
| **v2** | 547 | 166 | 290 | **257** | **40.7 %** | 53.0 % | 77.2 % | 59.7 % | 43.9 % |
| v2, confidence ≥ 0.8 only | 182 | 531 | 166 | 16 | 23.3 % | 91.2 % | 97.4 % | 25.9 % | — |

Same split, guide box = mileage digits + 25 % (`runs/test-number.json`):
v1 crop 27/713 correct (28 answered, 1 wrong); v2 297/713 = 41.7 % (548 answered,
251 wrong, digit acc. answered 78.4 %, top-3 44.9 %); v2 ≥ 0.8: 178 correct of 194
answered (91.8 %).

**With simulated history** (last odometer 1–2,000 km below the label; derived from
the label, so an upper-bound illustration of the constraint, not evidence):
v2 306/713 = 42.9 % (+16 vs no history), wrong 241; v2 ≥ 0.8 precision 94.9 %.
The constraint can only choose among the top-3, which contain the label in 43.9 %
of images, so it cannot add more than that.

## Odometer — held-out challenge split, 139 images

| Reader | Answered | Correct | Wrong | Field acc. | Answered precision | Digit acc. (answered) | Top-3 |
|---|---|---|---|---|---|---|---|
| v1 whole photo | 0 | 0 | 0 | 0 % | — | — | — |
| v1 crop (display) | 11 | 1 | 10 | 0.7 % | 9.1 % | 45.5 % | — |
| v2 (display) | 100 | 40 | 60 | 28.8 % | 40.0 % | 76.0 % | 39.6 % |
| v2 ≥ 0.8 (display) | 26 | 20 | 6 | 14.4 % | 76.9 % | 95.5 % | — |
| v1 crop (number box) | 2 | 1 | 1 | 0.7 % | 50 % | 66.7 % | — |
| v2 (number box) | 96 | 48 | 48 | 34.5 % | 50.0 % | 77.3 % | 43.2 % |
| v2 ≥ 0.8 (number box) | 33 | 30 | 3 | 21.6 % | 90.9 % | 98.0 % | — |

## Tuned-on split (NOT evidence) — tuning, 371 images, display box

v1 whole photo 3/371; v1 crop 14/371; v2 187/371 = 50.4 % (answered precision
64.5 %); v2 ≥ 0.8: 144/146. Test is ~10 points lower (40.7 %) and the confident
tier drops from 98.6 % to 91.2 % precision: the expected optimism of tuning.

## Pump — 3 real Israeli photos (hand-drawn guide box), per field

| Photo | Expected total / litres | v1 whole | v1 crop | v2 total (top-3) | v2 litres (top-3) |
|---|---|---|---|---|---|
| il-paz-2019 | 150.00 / 23.734 | abstain | abstain | none found | **23.734**, 237.34, 23.794 |
| il-sonol-2016 | 163.06 / 26.514 | abstain | abstain | none found | 6.584, 65.84, 6.504 |
| il-sonol-jordan-valley-2011 | 320.08 / 44.332 | abstain | abstain | 0.08, 8.08, 0.88 | 243.32, 293.32, 843.32 |

Per field: total 0/3, litres 1/3 top-1. As a pair: v2 0/3 correct, 1 wrong
proposal, 2 abstained (no total row found). v1 abstained on all three.
These three photos are far too few to estimate anything; the pump path is
otherwise exercised only by synthetic unit tests.

## What this means

- On simulated-framing odometer crops, v2 turns v1's near-total abstention
  (≈2–4 % read) into ≈41 % exact reads, and a confident tier (≥ 0.8) at ≈23–25 %
  coverage with ≈91 % precision on held-out data.
- About half of v2's proposals are wrong at digit level in ~1 of 4–5 characters;
  the least-confident highlight and top-3 alternatives on the verification
  screen are what make that usable. Whether people catch those errors is
  untested.
- Pump reading is not shown to work on real photos. Before enabling scanV2 for
  anyone, collect real Israeli pump and odometer captures from the app's
  viewfinder (the correction log export is built for this) and evaluate on a
  set frozen before reading.
