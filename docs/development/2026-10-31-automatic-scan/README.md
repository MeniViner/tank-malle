# Automatic odometer and pump scanning: reliability upgrade

Branch `codex/automatic-scan-reliability`, from `origin/main`
`4035965f8399037a82eb0c1ea53a021ab37ea87b` (app 1.6.0). Nothing was deployed.
No cloud OCR, no uploads, no Firestore rules or data changes, no change to
global response headers.

- [PROTOCOL.md](PROTOCOL.md): frozen evaluation protocol (v1.0 frozen before tuning; v1.1 amendment)
- [RESULTS.md](RESULTS.md): every measured number, generated from `benchmarks/scan/runs/`
- [`benchmarks/scan/dataset-manifest.json`](../../../benchmarks/scan/dataset-manifest.json): data and model provenance, versions, hashes, licences
- [`benchmarks/scan/trodo-audit.json`](../../../benchmarks/scan/trodo-audit.json) and [`trodo-sessions.json`](../../../benchmarks/scan/trodo-sessions.json): audit and frozen per-image roles/splits

## Inputs that were not available

The request referred to an attached research package (report, dataset
manifest `dataset-sources.json`, source audit, diagnostics, benchmark kit,
`price-prompt.txt`) and to two private photographs. None of these were on this
machine or in the repository. The work proceeded from the repository source,
public dataset pages and the request's own description. Consequences:

- The private-photo regression stays skipped (`CARE_PUMP_PHOTO`, `CARE_ODO_PHOTO`): **incomplete**.
- The pump dataset "listed in dataset-sources.json" could not be identified. The public candidates (Roboflow Universe) need a signed-in account to download, which this work cannot create; none has numeric transcriptions. Pump real-world accuracy: **incomplete** (synthetic mechanism suite only).
- The separate personal-price investigation (`price-prompt.txt`) was not touched.

## What changed in behaviour

| Confirmed failure (1.6.0) | Now |
| --- | --- |
| Dark-on-light odometer LCD never read (only blue/light polarities) | Dark, light, brightest-channel (red/amber/green) and blue polarities; an inverse-polarity "row" of background gaps is rejected by an ink-contrast check |
| Rows of only 1s and 7s never anchored (needed two horizontal bars) | Stacked vertical strokes anchor 1/7 cells; the end-of-row guard also sees vertical strokes, so a truncated row abstains |
| Mileage below 1,000 rejected outright | Short numbers are read; they are accepted only with ODO/TOTAL printed beside them (a "km" alone is also beside trips, ranges and speeds) |
| Pump rows assigned by position (top = amount) | Assignment by image evidence only: recognised labels, displayed precision (a 3-place number is never a shekel amount), and the pump's own amount = volume × price when all three are visible. Any surviving alternative → abstain |
| Swapped values (₪26.092 for 202.73 L) passed `reviewedScan` | Automatic acceptance needs a valid shekel amount and a broad physical ₪/L band; implausible reads also count as disagreement. The review form's own limits for typed values are unchanged |
| Ambiguous field identity (TRIP read as ODO, clock as mileage) | TRIP (and A/B beside the number) and miles labels abstain; a short unlabelled number abstains; dial-scale numbers are ignored; a contested candidate blocks everything else |
| Two identical consecutive frames accepted | Bounded capture session: two different recognition paths must agree (live: across two frames); any rival must be clearly outvoted (still photo: no rival at all); abstention reasons are kept |

Manual entry, the ordinary save action, authored-value protection, the
serializer and the outbox are untouched. Recognition never writes a record.

## Measured results (summary; every number is in RESULTS.md)

TRODO v2 test split, one photo per session, protocol v1.1. "Correct
completion" counts only sessions the app filled in automatically and
correctly; a safe abstention leaves the person to type the value and is not a
success. Accepted precision is a different metric: correct among accepted.

| Run | Correct completion, eligible | Accepted precision | Wrong acceptances, all scored |
| --- | --- | --- | --- |
| 1.6.0 reader (before) | 13/713 = 1.8% | 13/14 = 92.9% | 1/764 |
| New pipeline, **frozen run** (`8992585`, independent) | **278/713 = 39.0%** [35.5, 42.6] | **278/284 = 97.9%** [95.5, 99.0] | 6/764 (3 of them on 51 trip/clock negatives) |
| Same after the dial-number fix (**post-hoc**, `2fd98c9`, not independent) | 283/713 = 39.7% [36.2, 43.3] | 283/285 = 99.3% [97.5, 99.8] | 2/764 |
| Unseen display families (challenge split), frozen run | 47/139 = 33.8% | 47/66 = 71.2% | 19/280 |
| Same, post-hoc | 47/139 = 33.8% | 47/51 = 92.2% | 4/280 |
| Simulated live, 4 derived frames, 143 test sessions (post-hoc code) | 32/76 = 42.1% | 32/32 = 100% [89.3, 100] | 0/83 |

Frozen-run abstentions on the test split: unreadable 369, uncorroborated 108,
conflict 2, implausible 1 (of 764 scored sessions).

Runtime, desktop engines on an Apple M5 (not phones): first scan after
install 1.5 s in Chromium and 1.4 s in WebKit on a local server, and 25.9 s
at an emulated 10 Mbit/s (download-bound). Reopening with the models in
Cache Storage: 1.2 s first scan in Chromium and 1.1 s in WebKit, with 0
bytes downloaded. Warm photo p50/p95: Chromium 766/1,067 ms (accepted
744/992 ms, abstained 816/996 ms); WebKit 702/954 ms. Renderer memory rose
from 80 to 462 MB in Chromium and from 105 to 1,105 MB in WebKit.

### Acceptance criteria

| Criterion | Status |
| --- | --- |
| ≥ 95% correct automatic completion on readable, unambiguous sessions | **Not met**: 39.0% frozen (the whole interval is below 43%) |
| ≥ 99.5% correctness among accepted readings | **Not met** frozen (97.9%); post-hoc 99.3% is **unproven** (interval 97.5–99.8%) |
| Warm p95 ≤ 6 s per scene on Samsung Galaxy S25 | **Unverified**: no phone. Desktop Chromium p95 is 1.1 s |
| Denominators and confidence intervals published, frozen and post-hoc kept apart | Met |
| Field/session correctness, precision, wrong acceptance, coverage (eligible and all), rejection reasons, display-family breakdown, p50/p95, cold-start bytes, memory | Met for odometers. TRODO publishes no device identity, so there is no device breakdown. Pump field correctness was not measured (no photographs) |
| Pump real-world accuracy | **Incomplete**: synthetic mechanism suite only |
| Private calibration photos, prospective Israeli examples | **Incomplete**: not available |
| Physical-device validation (S25, weaker Android, iOS Safari/PWA) | **Not done**: no device |
| Build, rules, offline and browser gates pass without weakened assertions | Met (see the PR test plan) |

## Architecture decision

**Decision.** Keep the model-free seven-segment reader as the first, cheap
path, and add a local PP-OCR recogniser on onnxruntime-web (WebAssembly, one
thread) as the second path: PP-OCRv5 mobile detection + English
recognition, with every number re-read by the independently trained
PP-OCRv6-tiny recogniser before it can be used. Acceptance is decided by a
capture session over several paths, never by one read.

**Why.** On the TRODO tuning split the seven-segment reader reads nothing
from real photographs (0/371 eligible, full frame or annotated crop), while
PP-OCR reads many digital odometers and the printed labels (ODO, TOTAL, km,
TRIP) that identity needs. On the same 60-session tuning subsample (RESULTS.md),
Tesseract.js in sparse-text mode completed 2/33 eligible sessions against
20/33 for the shipped PP-OCR configuration; it was faster per session but
found few display numbers. During tuning, PP-OCR without the later checks
accepted wrong readings (dropped leading "1", dropped last drum, merged
neighbours); the verifier, the stray-stroke check and the session rules were
added for those. The saved runs do **not** isolate the verifier's
contribution: on the 60-session subsample the configuration without it
completed 22/33 with 22/22 accepted correct, against 20/33 and 20/20 with it,
and those intervals are wide. Keeping the 4.5 MB verifier is therefore a
precaution, not a measured gain. The test split was run once per
configuration, after the design was frozen.

**Rejected alternatives.**
- Cloud OCR, paid inference: excluded by the request.
- Multi-threaded WASM: needs cross-origin isolation (COOP `same-origin` + COEP), which breaks Firebase `signInWithPopup`/redirect helpers (firebase-js-sdk #6199, #6467). One thread is used; no header changes.
- WebGPU: optional and not needed; the WASM build used has no WebGPU code.
- Precaching the recogniser: would force ~31 MB on every install. It is fetched on first scan instead.
- Using expected prices, tank capacity or history to choose between candidate fields or to complete digits: excluded; only abstention uses plausibility bands.

**Consequences.** First scan downloads the runtime and models once (see
budget below); afterwards scanning works offline from Cache Storage. If the
recogniser cannot load (offline before first use, no WASM SIMD, failed
integrity check), the seven-segment reader keeps working alone and the UI says
so.

## Pipeline

1. **Frame**: whole camera frame (≤ 1920 px) or chosen photo (≤ 2560 px, EXIF-oriented). Pixels stay in memory and in the worker.
2. **Quality**: brightness, glare and sharpness on a thumbnail. Only unusable frames are skipped (a night display in a black frame is not "too dark"). Hints are shown live.
3. **Segment reader** at 960 px over four polarities and several thresholds; a line is stable only when ≥ 2 thresholds agree and none disagrees.
4. **Text recogniser** on the located display (or the whole working frame, then the central region): DB detection → CTC recognition (sideways boxes read both ways) → independent verifier → stray-stroke check → numeric lines and labels.
5. **High-resolution recrop** of the located display from the full frame (segment reader at two digit heights; the text recogniser re-reads its own located number), each a separate path.
6. **Identity** (`identity.ts`) from labels, precision and arithmetic; abstains on any surviving alternative.
7. **Capture session** (`session.ts`): corroboration across paths/frames, rivals outvoted, plausibility for automatic values only, bounded by frames/time; the bound starts when the recogniser is ready, not during its first download.

Observed versus derived: the form receives the observed amount and volume; the
price per litre stays derived by the existing receipt logic. An observed unit
price is recorded only as evidence.

## Runtime and download budget

| Item | Raw bytes | Transfer (compressed) | When |
| --- | --- | --- | --- |
| onnxruntime-web 1.30.0 `ort-wasm-simd-threaded.wasm` | 14,239,897 | 2,300,583 (brotli 11) / 3,652,793 (gzip 9) | first scan |
| PP-OCRv5 mobile detection | 4,826,518 | 4,532,927 (gzip 9) | first scan |
| PP-OCRv5 English recognition | 7,848,423 | 7,231,601 (gzip 9) | first scan |
| PP-OCRv6-tiny recognition (verifier) | 4,462,639 | 4,107,389 (gzip 9) | first scan |
| Worker chunk incl. ORT glue and dictionaries | ~131 kB JS | precached with the app | install |
| **Total on first scan** | **31,377,477** | **≈ 18.2 MB** if the host compresses all four (brotli WASM, gzip models); up to 31.4 MB if it does not (unverified for Firebase Hosting and `.onnx`) | once, then Cache Storage |

Model files are served at `/scan-models/<version>/` with immutable caching
(`firebase.json`), verified by sha256 in the worker before use, stored in a
versioned Cache Storage entry, and old versions are deleted on upgrade. The
production build fetches them from their pinned URLs and fails if a hash does
not match.

| Measured (desktop, Apple M5; RESULTS.md) | Chromium 156 | WebKit 27.2 |
| --- | --- | --- |
| First scan after install, local server (download + verify + load + read) | 1,498 ms (recogniser ready at 493 ms) | 1,428 ms (445 ms) |
| First scan after install at an emulated 10 Mbit/s, 150 ms RTT | 25,867 ms (24,825 ms) | not measured (no network emulation) |
| First scan after reopening (models from Cache Storage, 0 bytes) | 1,224 ms (193 ms) | 1,145 ms (163 ms) |
| Warm photo p50 / p95, all (39 photos) | 766 / 1,067 ms | 702 / 954 ms |
| …accepted (16) / abstained (23) p50 | 744 / 816 ms | 683 / 735 ms |
| Renderer memory before → after 40 photos | 80 → 462 MB | 105 → 1,105 MB |

## Failure cases (documented, not hidden)

Every wrong acceptance in the frozen runs is listed by session in RESULTS.md.
By cause:

- **Speedometer numbers merged into one box** (`100 120` read as odometer `100120`): 4 of 6 wrong acceptances on the test split and 15 of 19 on the challenge split, mostly on trip-only displays. Fixed after those runs (groups that are all round dial values are kept apart); the re-run is reported separately as post-hoc, not independent.
- **Inserted or dropped digits** that survive the fix on the test split (cause not analysed): `115853` → `1121943`, and `151771` → `15177` (last digit lost).
- **7 read as 1** on some LCD fonts with a faint top bar (`279890` → `219890`, `285077` → `285011`): both recognisers make the same mistake, so the verifier does not catch it.
- **Ghost segments**: unlit segments visible as `888` in front of a trip reading whose decimal point was lost (`84.9` → `888849`).
- **Bloomed leading "1"** on small backlit LCDs (`1 18948` read as `18948` by both recognisers, inside the detected box): neither the verifier nor the stray-stroke check sees it. Two tuning-split acceptances were wrong this way (one vehicle photographed twice).
- **Analog drum registers**: the coloured last drum (usually tenths) is read or skipped inconsistently, and TRODO labels it inconsistently. These are reported separately, both ways; their correctness for the app's integer odometer is **unverified**.
- **Trip meters, clocks and speed on the same display** are common; when only a trip is visible the reader must abstain, and TRODO's 257 trip/clock scenes measure that.
- **Seven-segment pump displays**: the text recogniser misreads the synthetic seven-segment font (for example `287.40` as `1.40`), and a disagreement between paths blocks acceptance, so with the recogniser loaded a synthetic pump can abstain where the segment reader alone would read it. Real pump accuracy is unmeasured.
- **Labels in Hebrew**: the English recogniser cannot read Hebrew labels (סכום, ליטרים, ק״מ). Pump identity then relies on precision alone, and a pump with two 2-place rows abstains.
- **Units**: a reading next to "mi"/"miles" abstains; an odometer with no visible unit is accepted as the app's km. A miles odometer without a visible unit would be wrong.

## Device validation

| Gate | Status |
| --- | --- |
| Samsung Galaxy S25, weaker Android, iOS Safari/PWA real camera sessions | **Unverified**: no physical device was available to this work |
| Permission denial, late permission, background/resume, cancellation | Verified in Chromium and WebKit desktop engines (e2e), not on phones |
| Worker failure / model integrity failure → segment-only fallback, manual route | Verified in Chromium and WebKit (e2e) |
| Offline availability of the recogniser after first use, PWA restart | Verified in Chromium (PWA e2e) |
| Recogniser kept across worker restarts | Chromium and WebKit with a persistent profile: reopen downloads 0 bytes. An ephemeral WebKit context loses entries a worker wrote once the worker is terminated, unless the page read them first (reproduced). Safari private browsing may therefore re-download about 31 MB after each 30 s idle stop; unverified on iOS |
| Duplicate-write prevention, outbox, account/vehicle isolation | Existing suites pass unchanged |

## Remaining limitations

- Recognition targets are not met: about 6 in 10 readable digital odometers still fall back to typing, and the frozen run accepted 6 wrong readings in 764 scored sessions.
- The evaluated scope is TRODO still photos from one country's vehicle fleet, of digital displays with at least 5 digits. Analog registers (858), 3–4 digit digital readings (20) and label-check exclusions (31) are reported separately and are not in any headline number.
- Pump displays: no real photograph was evaluated. The synthetic suite shows only that identity and abstention behave as designed. The English text recogniser misreads seven-segment fonts and cannot read Hebrew labels.
- Live camera behaviour is simulated by deriving frames from still photos. Derived frames share blur, glare, angle and font, so they test the session rules, not a hand-held camera.
- No phone was used. S25 latency, weaker-Android memory (about 1 GB of WebKit renderer memory after 40 photos on desktop), iOS Safari/PWA, real permission prompts and camera lifecycle are unverified.
- The verifier's precision benefit is not demonstrated by the saved runs. The Tesseract comparison uses 60 tuning sessions, so it is coarse.
- First-scan download is 31.4 MB raw. Whether Firebase Hosting compresses `.wasm` and `.onnx` (about 18 MB if it does) is unverified.
- The private calibration photos, the research package, `dataset-sources.json` and `price-prompt.txt` were not available. The personal-price investigation was not touched.

## Reproducing

```bash
# corpus (186.6 MB, CC BY 4.0), verified against the manifest hash
node scripts/scan-benchmark/trodo-audit.mjs .scan-corpus/trodo-v2/trodo-v01 benchmarks/scan
node scripts/scan-benchmark/run.mjs --split test --reader current --text ppocr-v5+v6 --out run.json
node scripts/scan-benchmark/run.mjs --split test --reader baseline --out before.json
node scripts/scan-benchmark/synthetic.mjs 200 synthetic.json current
node scripts/scan-benchmark/run.mjs --split test --limit 150 --reader current --text ppocr-v5+v6 --live 4 --out live.json
npx vite build && node scripts/scan-benchmark/browser.mjs chromium 40 browser.json
CARE_WEBKIT_PATH=<playwright webkit pw_run.sh> node scripts/scan-benchmark/browser.mjs webkit 40 browser-webkit.json
CARE_THROTTLE=10,150 node scripts/scan-benchmark/browser.mjs chromium 3 browser-10mbps.json
node scripts/scan-benchmark/report.mjs
```

A run with a missing or altered corpus file reports `incomplete` and exits 2.
