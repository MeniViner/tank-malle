# Scan engine — reading pumps and odometers

One reader for both the live camera and a chosen photo: `src/lib/scan/engine/`.
Code only — no trained model, no network, nothing leaves the device. It only
proposes; the person checks the numbers in the fill-up form and saves there.

## How it reads a picture

1. **Find rows of digits anywhere, at any size** (`proposals.ts`). The grey
   image goes through a pyramid of halvings. On every level, local-contrast ink
   marks are grouped into rows of three or more similar, upright marks standing
   side by side (both polarities: lit digits on a dark dash, dark digits on a
   grey pump). Segment gaps are closed first so a seven-segment digit is one
   mark; a small or blurred display whose digits run together is taken as one
   long mark. Rows are ranked by contrast and length and capped.
2. **Cut each row out upright** (`rectify`), measure the digits actually in it
   (tilt, top and bottom) and cut again from that measurement, so the strip is
   centred and level.
3. **Decode the strip as seven-segment digits** (`decode.ts`): adaptive ink
   mask, italic shear, a digit grid tracked along the row at one pitch, seven
   stroke windows per cell matched against the ten patterns, with a penalty for
   ink the pattern does not explain (letters, icons). A lone upright stroke is a
   "1"; a small low mark is a decimal point.
4. **Choose by what the numbers mean** (`read.ts`). Odometer: a 4–7 digit
   integer row, preferring the longer reading of a row, the journal's last
   reading only re-weighting (it may be stale); when two close readings (one
   digit apart, or one with an extra digit at an end, typically a missed
   segment or a narrow "1") are both plausible, both are doubted. Pump: amount and litres must be
   stacked, the litres row under the amount; litres × price must equal the
   amount to the agora — the price row when one is read, otherwise some
   whole-agora price. The fill-up form passes the price it would suggest
   (`pricePerLiter`), which counts for more than an unexplained exact sum. A
   decimal point that is not seen is assumed at a cost; when both rows are read
   end to end, litres to the millilitre, and the sum is exact, most of that cost
   is given back, in proportion to how unlikely the exact sum is by chance (none
   for a few litres). If the first pass is not confident, a lower ink threshold
   is tried for faint displays, and the rows just above and below a well-read
   pump row are cut out directly.
5. **Answer only when confident** (`index.ts`): below `ACCEPT` the app says the
   digits were not clear and the person types them. An odometer reading with no
   previous reading in the journal to check it against needs more confidence
   (`ACCEPT.odometerFirst`).

## Measured on the owner's photos (2026-11-11)

43 real photos of one Hyundai i20 and Israeli pumps (Gilbarco, Dor Alon),
phone JPEGs and gallery screenshots, read whole with no crop
(`scripts/scan-real/run.mjs`, labels in `scripts/scan-real/labels.json`;
the photos are private and not in the repository).

| | correct first answer | wrong answer shown | not read |
|---|---|---|---|
| odometer (29) | 25 | 0 | 4 |
| pump amount + litres (14) | 11 | 0 | 3 |

Every miss is below the accept threshold, so the app shows "not clear enough"
rather than a wrong number. The seven misses: two night photos where the
display is blurred to a smear, two gallery screenshots of those, a pump with a
heavy reflection, and two photos of the same Dor Alon pump taken at a steep
angle. Median time: about 2 s per 12 MP photo on an M-series Mac in Node; the
app runs it in a worker with a 45 s limit for files.

Raw per-photo results: `docs/releases/2026-11-11-scan-engine/real-photos.json`.

## Pumps photographed off a screen (2026-11-20, engine 4)

A screen recording of the live camera pointed at web photos of five Gilbarco
pumps on a laptop: 218 frames, each read at two sizes. The displays are small
and their decimal points are a pixel or two.

| | right reading above the threshold | wrong reading above the threshold |
|---|---|---|
| engine 3 | 35 | 2 |
| engine 4 (points placed by the exact sum) | 61 | 2 |

The two wrong readings are the same in both: an amount that lost its leading
"1" paired with the price row taken as litres. The recording is private and
this set has not been run on the owner's 43 photos; run
`scripts/scan-real/run.mjs` on them before trusting the change further.

## Measured on other cars: TRODO (2026-11-11)

TRODO is a public set of odometer photos from a Turkish delivery fleet, taken
with phones by drivers (Mouheb, Yürekli, Yılmazel, *Data in Brief* 38, 2021;
[Mendeley Data, doi:10.17632/6y8m379mkt.2](https://data.mendeley.com/datasets/6y8m379mkt/2),
CC BY 4.0). Many makes and display styles, night and day, glare, tilt. It is not
in the repository; `scripts/scan-real/trodo.mjs` reads the unzipped folder.
The 1,274 digital odometers with a usable label, whole photos, no crop:

| | shown right | shown wrong | not read |
|---|---|---|---|
| no journal (first fill-up of a car) | 792 (62.2%) | 13 (1.0%) | 469 |
| journal reading a few hundred km back | 864 (67.8%) | 4 (0.3%) | 406 |

Before the two rules above (close-rival doubt, stricter first reading) the
same set showed 57 wrong readings without a journal and 14 with one; right
readings fell from 867 to 792 and from 880 to 864. The owner's photos are
unchanged with a journal (36 of 43 read, none wrong); without one, two
odometer photos fall below `odometerFirst`. At least one remaining
"wrong" reading looks like a TRODO label error (a digit after the mileage left
out of the label).

For comparison, [ssocr](https://www.unix-ag.uni-kl.de/~auerswal/ssocr/), the
established code-only seven-segment reader, given a hand-made crop of exactly
the mileage digits (which our engine never gets) and the best of four settings
per photo, read 11 of 242 sampled photos: it expects a fixed camera, level
digits and closed segments. 858 TRODO photos are mechanical (analog) odometers,
which this engine does not read.

## Learning from use (since 1.9.0)

No model and no Cloud Function. Three pieces:

1. **Collection** (`src/lib/scan/samples.ts`). Every attempt — one camera session or
   one chosen file — writes a small record to `scanSamples` (kind, source, attempt
   number in the session, shown or not, best guess and its confidence, timing,
   platform, app and engine version) and, under the same id in `scanImages`, the
   rows the engine cut out (64 px high, grey JPEG, at most three) or, when nothing
   was read, a grey copy of the picture at most 320 px wide. The full photo never
   leaves the device. When the fill-up is saved, the saved numbers are attached
   once as the label (`final`, `result`: match / corrected / manual). Writes are
   fire-and-forget and queue offline. Rules: `firestore.rules` (`scanSamples`,
   `scanImages`), tests in `tests/rules/scan-samples.rules.test.ts`; account
   deletion erases both. The privacy policy (§6) and terms (§3) describe it.
2. **Measurement** (Admin → סריקה, `src/components/admin/ScanAccuracy.tsx`, figures in
   `src/lib/scan/sampleStats.ts`): share shown, share right and share wrong of the
   labelled attempts, by day, by attempt number, by display, source, platform and
   version; how many tries each display needed; the failed attempts with the rows
   the engine saw.
3. **Tuning** (`scripts/scan-learn/learn.mjs`, daily in
   `.github/workflows/scan-learn.yml`, same service-account secret as the fuel
   price job). For each threshold it takes the labelled attempts of the current
   engine and picks the lowest value that would have kept wrong readings at or
   under 1% of those shown; at most 0.05 per run, always inside `ACCEPT_RANGE`.
   Lowering a threshold needs 200+ labelled attempts; raising it needs 20 and
   two wrong readings shown. A run stops after one count query unless 10 scans
   were labelled since the last tuning (or a week passed), and reads at most
   the 1,500 newest samples: GitHub minutes are free for this public
   repository, the Firestore free read quota is the real limit. The result goes to
   `appConfig/scanTuning`; devices read it on their next scan and the engine
   clamps it again. It also deletes scan pictures older than a year.
   `scripts/scan-learn/selftest.mjs` checks it against the emulator.

What this loop can and cannot do: it tunes *when to answer*, automatically. It
does not teach the engine a display it cannot decode; for that,
`scripts/scan-learn/pull.mjs --only problems` downloads the failed attempts with
their true numbers, and a rule is written against them (bump `ENGINE_VERSION`
when one is). A label is what the person saved: a wrong reading nobody
corrected counts as right.

## Developer tools

- `node scripts/scan-real/run.mjs --dir <photos> [--history] [--verbose]` — the
  benchmark above.
- `node scripts/scan-real/trodo.mjs --dir <trodo-v01> [--journal] [--fails] [--out file.json]`
  — the TRODO benchmark.
- `node scripts/scan-real/debug-read.mjs --dir <photos> --file <name> [--near x,y,r] [--want digits] [--ascii 1] [--out strips.png]` — every row the engine saw, its reading and the ink mask.
- `node scripts/scan-real/debug-mask.mjs` — the ink mask of one pyramid level.
- `src/lib/scan/engine/engine.test.ts` — synthetic displays (`src/lib/scan/fixtures.ts`).

Earlier readers (v1 `automaticDisplay`, the flagged v2 pipeline and its
Account switch) were removed in this release; `legacyCorrections.ts` deletes
what v2 may have stored on a device.

## Automatic cloud fallback in the internal pilot

The personal pilot build enables `VITE_SCAN_AI_PILOT=1`. A web pilot also needs
`VITE_SCAN_RECAPTCHA_SITE_KEY` (the registered public Enterprise site key).
Distribute this build only to adult testers in a free-tier eligible region.
Public builds keep the local reader. The public app currently admits drivers
aged 16 and above; review audience and regional eligibility before wider rollout.

A local miss with a detected display region can trigger one request for that
photo, or one per live session after at least three local frames. The worker locates a candidate display and cuts a grayscale region. For a backlit dashboard it can locate tilted illuminated digits against the dark instrument panel. For a pump it prioritizes large digit rows over small instruction text. No region means no upload. Only its re-encoded
JPEG and a fixed transcription prompt go to Firebase AI Logic. The journal
context stays on-device. Validated suggestions use the ordinary review form.
A failed request, an unavailable attestation or an exhausted quota leaves manual
entry available. Cloud suggestions have no local confidence score and never
feed the local threshold tuner. In Admin → סריקה, the fallback breakdown compares
suggestions with what users saved. The pilot also records a Firebase Performance
trace per processed photo/camera session with timing and categorical attributes.

The provider is the Gemini Developer API on Spark, using `gemini-3.5-flash-lite`.
On 2026-11-25 the project's free quotas were 15 requests/min and 500/day for
both 3.5 and 3.1 Flash-Lite, and 5/min and 20/day for 3.8 Flash. The AI Logic
proxy limit is 4 generation requests/min/user. Firebase applies this setting to every user, including the owner, and offers no per-account override. All apps share model
quotas. Check live limits before expanding the pilot.

Use the existing native preparation commands. Supply the matching Firebase
Android JSON with `TANK_MALLE_ANDROID_GOOGLE_SERVICES`, or the iOS plist with
`TANK_MALLE_IOS_GOOGLE_SERVICES`. These profile-specific files stay out of Git.
Configured builds initialize native Crashlytics. Android uses Play Integrity
and needs its Play signing SHA-256 and linked Play project. iOS uses App Attest
and needs a matching team and signed entitlement. Web uses reCAPTCHA Enterprise.
Local emulator tests never contact Gemini.

In the live Web pilot on November 25, the local reader declined two synthetic
printed displays. Through the normal photo picker, the fallback returned
287.60 shekels and 40.000 L for the pump, and 128450 km for the odometer.
A separate direct model check returned no number for a blank crop. The probe
used an ephemeral registered App Check development token, revoked after testing.
These checks establish the pipeline, not accuracy on field photos.


### Real-photo check, 2026-11-25

Three original photos from the owner’s album went through the Web pilot’s file
picker with no journal context. One odometer photo was accepted locally
(168053 km, zero model requests). The worker declined the second odometer photo
and the pump photo. Each automatically triggered exactly one successful
`gemini-3.5-flash-lite` request. The UI returned 169358 km and a pump sale of
64.32 shekels for 5.637 L. The model also returned the displayed unit price of
11.41 shekels/L, used to validate the pump reading. All matched the existing
human labels. The UI probe used a temporary App Check development registration,
revoked after the check. These examples cover one vehicle and one pump.
