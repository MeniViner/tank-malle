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
   reading only re-weighting (it may be stale). Pump: amount and litres must be
   stacked, the litres row under the amount; litres × price must equal the
   amount to the agora — the price row when one is read, otherwise some
   whole-agora price. If the first pass is not confident, a lower ink threshold
   is tried for faint displays, and the rows just above and below a well-read
   pump row are cut out directly.
5. **Answer only when confident** (`index.ts`): below `ACCEPT` the app says the
   digits were not clear and the person types them.

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

## Developer tools

- `node scripts/scan-real/run.mjs --dir <photos> [--history] [--verbose]` — the
  benchmark above.
- `node scripts/scan-real/debug-read.mjs --dir <photos> --file <name> [--near x,y,r] [--want digits] [--ascii 1] [--out strips.png]` — every row the engine saw, its reading and the ink mask.
- `node scripts/scan-real/debug-mask.mjs` — the ink mask of one pyramid level.
- `src/lib/scan/engine/engine.test.ts` — synthetic displays (`src/lib/scan/fixtures.ts`).

Earlier readers (v1 `automaticDisplay`, the flagged v2 pipeline and its
Account switch) were removed in this release; `legacyCorrections.ts` deletes
what v2 may have stored on a device.
