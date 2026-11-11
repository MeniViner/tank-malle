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
   whole-agora price. If the first pass is not confident, a lower ink threshold
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
