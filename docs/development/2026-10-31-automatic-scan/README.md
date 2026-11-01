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
| *(cycle 2)* `ODO 128450` / `128450 ODO` read in one text box gave no number; `TRIP 84.9` lost its label | Numbers and labels in one box are kept with their positions; a label beside one number is placed on it; a label between two numbers is ambiguous; an unknown word beside a number makes it unsure |
| *(cycle 2)* First live scan timed out while the models were still downloading | Separate loading (60 s) and scanning (15 s) bounds; frames are read meanwhile and a corroborated segment reading can still succeed |
| *(cycle 2)* Zero-padded registers (`00236096`) refused by identity, and never recropped | Read as the number they pad, with a second path |
| *(cycle 2)* Verifier blocked correct readings by writing seven-segment digits as letters | Its text is also read with those look-alikes as digits; a dropped or added digit still disagrees |

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
| Cycle 2 rerun, test split (`c482b26`, **regression evidence**, not independent) | 310/713 = 43.5% [39.9, 47.1] | 310/313 = 99.0% [97.2, 99.7] | 3/764 (0 on negatives) |
| Cycle 2 rerun, challenge split (regression evidence) | 49/139 = 35.3% | 49/53 = 92.5% | 4/280 |
| Cycle 2, tuning split (development data) | 198/371 = 53.4% (before: 176/371) | 198/200 = 99.0% | 2/436 |

The cycle-2 test rerun has one wrong acceptance the post-hoc run did not
(`190061` read as `19006`). Both text paths dropped the last narrow "1"
before "km" and the verifier agreed. The pre-cycle recogniser code abstains on
this photo only because its recrop path, cut from a slightly different region
(number plus unit rather than the number), came out identity-ambiguous.
Reverting only the parser restores that abstention; reverting the identity,
verifier or stroke code alone does not. It is the same dropped-"1" weakness,
reached through a different crop, not a new mechanism.

Frozen-run abstentions on the test split: unreadable 369, uncorroborated 108,
conflict 2, implausible 1 (of 764 scored sessions).

Runtime, desktop engines on an Apple M5 (not phones): first scan after
install 1.5 s in Chromium and 1.4 s in WebKit on a local server, and 25.9 s
at an emulated 10 Mbit/s (download-bound). Reopening with the models in
Cache Storage: 1.2 s first scan in Chromium and 1.1 s in WebKit, with 0
bytes downloaded. Warm photo p50/p95: Chromium 766/1,067 ms (accepted
744/992 ms, abstained 816/996 ms); WebKit 702/954 ms. Renderer memory rose
from 80 to 462 MB in Chromium and from 105 to 1,105 MB in WebKit.
Over five open / read 8 photos / cancel / teardown cycles (RESULTS.md,
"Memory"), Chromium returns to about 310–370 MB after each teardown (peak
about 600 MB). WebKit keeps about 950 MB after the first teardown and reuses
it, plateauing at 1.0–1.14 GB rather than growing per scan. The 1.1 GB is a
retained high-water mark of the WebContent process, which hosts both the page
(photo decoding) and the worker (the onnxruntime WASM heap only grows). It is
not released when the worker ends. Recogniser ready, cold / reopened:
Chromium 521 / 187–194 ms, WebKit 432 / 157–184 ms.

### Acceptance criteria

| Criterion | Status |
| --- | --- |
| ≥ 95% correct automatic completion on readable, unambiguous sessions | **Not met**: 39.0% frozen; cycle-2 rerun 43.5% [39.9, 47.1] (regression evidence) |
| ≥ 99.5% correctness among accepted readings | **Not met** frozen (97.9%); post-hoc 99.3% and cycle-2 99.0% [97.2, 99.7] are **unproven** |
| Warm p95 ≤ 6 s per scene on Samsung Galaxy S25 | **Unverified**: no phone. Desktop Chromium p95 is 1.1 s |
| Denominators and confidence intervals published, frozen and post-hoc kept apart | Met |
| Field/session correctness, precision, wrong acceptance, coverage (eligible and all), rejection reasons, display-family breakdown, p50/p95, cold-start bytes, memory | Met for odometers. TRODO publishes no device identity, so there is no device breakdown. Pump field correctness was not measured (no photographs) |
| Pump real-world accuracy | **Incomplete**: three real Commons photographs through the complete pipeline (none filled; two correctly empty, one abstained on decimal commas) and the synthetic suite, now through the complete pipeline with and without labels; no Israeli pump photographs |
| Private calibration photos, prospective Israeli examples | **Incomplete**: not available |
| Physical-device validation (S25, weaker Android, iOS Safari/PWA) | **Not done**: no device |
| Build, rules, offline and browser gates pass without weakened assertions | Met (see the PR test plan); the CI failure from fixed October dates is fixed |

## Cycle 2 (2026-11-01): defects fixed, failures attributed, one measured improvement

The test and challenge splits had been examined after the frozen run, so
every rerun on them below is **regression evidence, not an independent
result**. Decisions in this cycle used the tuning split only. A new
independent accuracy claim needs unseen, grouped data frozen before further
tuning (for example the S25 sessions in "Device validation").

**CI.** Run 41272952452 (job 124749293768) failed
`e2e/unified-vehicle.spec.ts` because its cost fixtures were dated October
2026 and CI ran on 1 November, so "this month" was empty (`overview-month` 0
instead of 590/120). `main` has the same fixtures. They now follow the real
month in the project's timezone (Asia/Jerusalem): the expense on the 1st,
the service today, never in the future. A test that could straddle a month's
last midnight waits for it. The assertions are unchanged.

**Parser.** `fromText()` produced no numeric line for `ODO 128450` or
`128450 ODO`, and `TRIP 84.9` lost its label. A text box is now split into
number runs and words by character position:
- A label read with one number is placed on that number. One between two
  numbers is placed on both, so it stays ambiguous.
- An unknown word directly beside a number (`I 28450`, `l28450` on an
  odometer) makes the number unsure.
- A known label's letters are not taken for a stray "1".
- Punctuation stays inside the number's box, and a clock (`6:16`) is not a
  number.
- Regression cases include ODO and TRIP visible together.

On tuning this is neutral: 175/371 against 176/371 before. Five sessions
gained and six lost, because the recrop region now follows the number rather
than the number plus its unit, which flips a fragile verifier.

**First-use live capture.** Live frames are read without waiting for the
recogniser. The session's 15 s bound ran during the first download and
finalised a timeout before the recogniser was ready. The session now has a
loading bound (60 s) and a scanning bound; see "Pipeline". The browser test
delays every model file by 30 s:
- **Old code:** abstained at 15 s with "הספרות עדיין לא ברורות מספיק".
- **Now:** waits and reads `128450`. 28.9 s from opening the camera to the
  filled form, 27.1 s of it waiting for the files.
- **Cancellation during the download:** stops the stream and fills nothing.
- **Seven-segment display:** still accepted from the segment reader in
  0.84 s, before any model file arrives.

**Where the failures come from.** On tuning, at `98972ae`, 201 of 371 eligible
sessions were not filled correctly. Each was attributed to the first stage
that lost the correct value (`scripts/scan-benchmark/diagnose.mjs`; the
annotated box only locates the odometer and gives an oracle crop):

| Stage | Sessions | Detail |
| --- | --- | --- |
| Correct number read, line marked unsure | 61 | verifier disagreement 40 (+8 combined), adjacent digits 10 |
| Raw recognition wrong | 54 | one digit dropped 24, substituted 8, two off 10, other number 10, inserted 2. The oracle crop has the right digits in only 9 |
| Read by one path only (uncorroborated) | 50 | the full-resolution recrop did not resolve: identity-ambiguous 41 (mostly a line marked unsure), format 8; in 9 the recrop read the number without a "1" |
| Identity | 28 | 13+ were zero-padded registers (`00236096`) that identity refused |
| Conflict / localisation / wrong accepted | 3 / 3 / 2 | two of the conflicts are a dropped "1" in one path (`188331`/`18833`, `118323`/`18323`) |

Variants recomputed from the same recorded paths (all 436 decisions
reproduce):

| Variant | Correct / wrong |
| --- | --- |
| Current | 170 / 2 |
| Verifier disagreements ignored | 200 / 9 |
| Any single path | 220 / 6 |
| Recrop paths dropped | 0 / 0 |
| Segment reader only | 0 / 0 |
| Segment and text must agree | 0 / 0 |

Every acceptance on these photographs was the same text model reading the
number twice, each read checked by the second recogniser. Repeated reads by
one model are correlated evidence. The segment reader, the only independent
family, reads none of these photographs alone, and the oracle crop shows no
dominant localisation problem. Dropping the verifier or the second path would
buy coverage with wrong readings, so neither was done.

What was changed, each measured on its own (RESULTS.md, "Cycle 2 changes"):
1. **Zero-padded registers** are accepted by identity as the number they pad
   (175 → 175). This exposed a second bug: the recrop matched line text to the
   value, so a padded register never got its second path. Fixed: 175 → 190,
   still 2 wrong.
2. **The verifier's text** is also read with seven-segment look-alikes as
   digits (S 5, B 8, Z 2, G/b 6, q/g 9, Y 4) and as written, so `km` misread
   as `im` is not a "1". A verifier that drops or adds a digit still
   disagrees. Also tolerating a dropped "1" added a wrong acceptance on tuning
   and was rejected. 190 → 198, still 2 wrong.

On tuning (development data, post-hoc), cycle 2 moved correct completion from
176/371 (47.4%) to **198/371 (53.4%)**. Accepted precision is 198/200 (99.0%);
the same two wrong acceptances remain, one vehicle photographed twice with a
bloomed leading "1". What still fails (`c482b26`):

| Stage | Sessions |
| --- | --- |
| Line marked unsure | 55 (verifier 34) |
| Raw recognition | 54 |
| Uncorroborated | 46 |
| Identity | 10 |
| Conflict | 3 |
| Localisation | 3 |
| Wrong accepted | 2 |

Ignoring the verifier would now give 233/371 with 12 wrong; accepting any
single path, 244/371 with 6 wrong. Both are below the 99.5% precision target,
so the current rule stays.

Digit recognition (54) is a large share, but not most, of the failures; the
rest are arbitration between two general-purpose models that misread display
fonts in different ways. A trained display-digit recogniser remains the step
most likely to move both, but no training stack (PyTorch/ONNX tooling) is
available here, so it was not attempted in this cycle.

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
7. **Capture session** (`session.ts`): corroboration across paths/frames, rivals outvoted, plausibility for automatic values only, bounded by frames/time. Two bounds: while the recogniser downloads on first use, frames are still read (a corroborated segment reading is accepted) but neither time nor frames count against the scanning bound, and the wait has its own 60 s bound; then the ordinary 15 s / 60-frame bound applies. Decisions report the total wait and the part spent waiting for the recogniser. (Before cycle 2 this paragraph claimed the bound started at readiness; it did not, see "Cycle 2".)

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
| Memory over 5 scan / cancel / teardown cycles: after teardown, peak | 311–369 MB, 597 MB | 950–1,124 MB (not released, reused), 1,137 MB |

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
- **Decimal commas** (`58,57 €`, `52,81 L`, as on the French Commons photograph): a comma is read as a thousands separator only before exactly three digits, so these do not parse and the pump abstains. `1,109` is genuinely ambiguous (a 3-place price or a thousands separator) and is not guessed.
- **Printed labels beside seven-segment digits** lower full-pipeline coverage in the synthetic suite (see RESULTS.md). No synthetic or real scene was filled wrongly.
- **Two general-purpose models disagree on display fonts**: the verifier drops narrow "1"s and writes digits as letters, the main recogniser drops or substitutes digits. After cycle 2 this arbitration, not localisation, is still the largest share of tuning failures (RESULTS.md diagnosis).
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
| First live scan while the models download (slow network) | Verified in Chromium (e2e, files delayed 30 s); not on a phone network |

### Samsung Galaxy S25 validation (to do; nothing here has been run on a phone)

This uses the repository's LAN device setup (see
`docs/development/2026-10-19-cycle5/README.md`) with emulators only. Nothing
is deployed and no photo leaves the phone.

1. **Setup**
   - Computer and S25 on a private network.
   - `.care-device/config.json` with the computer's private IPv4 HTTPS origin,
     plus a development certificate for that address (e.g. mkcert).
   - The phone's owner installs trust in that development CA on the S25.
   - Start the emulators, then `npm run dev:care:device`. It builds
     `.care-device/dist` and serves it over HTTPS.
2. **Cold start**
   - In Chrome on the S25, clear the site's data, open the origin, sign in
     with an emulator account, then Fill-up → "הוספה בשני צילומים" → open the
     camera at a real pump.
   - Record a screen video and measure camera-open → filled form. This time
     includes the 31.4 MB first download.
   - Repeat once on mobile data (hotspot) to see the loading bound. The status
     "מכינים את הקורא המקומי" must stay up and the session must not abstain
     while the files arrive.
3. **Warm sessions, frozen before any further tuning**
   - At least 30 live odometer sessions across 10 or more vehicles (include
     TRIP visible beside ODO) and at least 30 live pump sessions at 5 or more
     Israeli stations (Hebrew labels, 2- and 3-place volumes). Group by
     vehicle/station.
   - For each, the tester notes the displayed values from the device itself
     (photographed on a second phone, kept locally), the outcome (filled
     correctly, filled wrongly, abstained with its message) and
     camera-open → fill time from the screen video.
   - Pass: no wrong fills; warm p95 ≤ 6 s; abstentions reported with
     denominators, not counted as successes.
4. **Memory and lifecycle**
   - With USB debugging, `chrome://inspect` from the computer, and
     `adb shell dumpsys meminfo com.android.chrome` before scanning, after 5
     open / read / close cycles, and 30 s after the last close.
   - Compare with the desktop cycles in RESULTS.md: memory must return after
     teardown rather than ratchet.
   - Also check denial and late permission, backgrounding mid-scan,
     rotation, and an airplane-mode PWA restart (the recogniser keeps reading
     offline).
5. **Optional automated timing**
   - Playwright's experimental Android support (`_android`, over adb) can
     drive Chrome on the S25 with `scripts/scan-benchmark/browser.mjs`'s page
     code for per-photo cold, warm and abstention latency on the phone's own
     SoC. Adapting the script is not done yet.

## Remaining limitations

- Recognition targets are not met: about 6 in 10 readable digital odometers still fall back to typing, and the frozen run accepted 6 wrong readings in 764 scored sessions.
- The evaluated scope is TRODO still photos from one country's vehicle fleet, of digital displays with at least 5 digits. Analog registers (858), 3–4 digit digital readings (20) and label-check exclusions (31) are reported separately and are not in any headline number.
- Pump displays: three real Commons photographs were read through the complete pipeline (none filled wrongly; none filled correctly). That cannot estimate accuracy, and none is an Israeli total-and-volume display. The synthetic suite now also runs through the complete pipeline, with and without printed English/Hebrew labels. The English text recogniser misreads seven-segment fonts and cannot read Hebrew labels; decimal commas are not parsed.
- Live camera behaviour is simulated by deriving frames from still photos. Derived frames share blur, glare, angle and font, so they test the session rules, not a hand-held camera.
- No phone was used. S25 latency, weaker-Android memory, iOS Safari/PWA, real permission prompts and camera lifecycle are unverified. Desktop WebKit holds about 1.1 GB after the first cycles and does not release it when the worker ends; whether iOS keeps the tab alive at that size is unverified.
- On the tuning split the verifier now has a measured effect (cycle-2 diagnosis): ignoring its disagreements adds correct fills and also wrong ones. The Tesseract comparison uses 60 tuning sessions, so it is coarse.
- Cycle-2 reruns on the test and challenge splits are regression evidence only; those splits informed the changes.
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
# cycle 2
node scripts/scan-benchmark/run.mjs --split tuning --text ppocr-v5+v6 --diagnose --out tuning-diagnose.json
node scripts/scan-benchmark/diagnose.mjs tuning-diagnose.json diagnosis.json
node scripts/scan-benchmark/synthetic.mjs 200 synthetic-full.json current ppocr-v5+v6 hebrew   # or none / english
node scripts/scan-benchmark/photos.mjs benchmarks/scan/commons-pump-sessions.json ppocr-v5+v6 commons-pumps.json
CARE_CYCLES=5 node scripts/scan-benchmark/browser.mjs chromium 12 memory-chromium.json
node scripts/scan-benchmark/report.mjs
```

A run with a missing or altered corpus file reports `incomplete` and exits 2.
