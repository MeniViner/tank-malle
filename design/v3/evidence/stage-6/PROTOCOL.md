# Stage 6 — scan accuracy protocol (committed before any held-out run)

Written and committed **before** the test, challenge and pump sets were read by
the v2 code. Every number in `ACCURACY.md` follows this protocol; anything
outside it is labelled post-hoc.

## Code under test

- **Before (v1):** `src/lib/scan/automaticDisplay.ts` (shipped recogniser, unchanged).
- **After (v2):** `src/lib/scan/v2/pipeline.ts` with the defaults frozen in commit
  `3dc56f6` (offsets `[.06, .12, .2]` of the grey range, local-contrast factor `0.8`,
  threshold radius `0.06` × short side, luma greyscale, odometer length prior
  `{4: .55, 5: .9, 6: 1, 7: .8}`). No v2 source change is allowed between this
  protocol commit and the held-out runs.

## Data

| Set | Source | Use |
|---|---|---|
| TRODO `tuning`, role `eligible` (371) | TRODO v2 (Mouheb, Yürekli, Yılmazel; CC BY 4.0), splits/roles from PR #19 (`scripts/scan-v2/trodo-manifest.json`) | **All v2 tuning.** Never independent evidence. |
| TRODO `test`, role `eligible` (713) | same | Held out from v2 tuning; run **once**. PR #19 inspected this split post-hoc for its own pipeline, so it is not pristine for the dataset as a whole, but no v2 decision used it. |
| TRODO `challenge`, role `eligible` (139) | same | Held out; run **once**. Same caveat. |
| 3 Israeli pump photos | Wikimedia Commons via PR #19 `pump-photos-2026-11-01` (`scripts/scan-v2/pump-manifest.json`) | Run **once**. Far too few for an accuracy estimate; reported row by row. |
| Synthetic renderings | `src/lib/scan/fixtures.ts` | Unit tests only; never pooled, never a real-world claim. |
| On-device correction log | — | Empty: the feature is new and has not run on a phone. |

TRODO is odometer-only and mostly Turkish dashboards (dot-matrix/LCD fonts, not
classic seven-segment). There is **no** real pump dataset beyond the 3 photos.

## Conditions

- **Viewfinder stand-in.** TRODO has no guide-box captures. `--crop display` uses the
  annotated display box + 10 % padding (person framed the whole display);
  `--crop number` uses the union of annotated mileage-digit boxes + 25 % (framed the
  number only). Both use annotations, so both are **simulations of good framing**,
  optimistic relative to a real phone. Pump crops are hand-drawn boxes.
- **v1** is run (a) on the whole photo, as the app reads a chosen file today, and
  (b) on the same crop as v2.
- **Context.** `none` (no history), and `simulated`: v2 gets a last odometer drawn
  1..2,000 km below the label (deterministic per image). Simulated context is
  derived from the label and is reported separately, never as a headline.

## Metrics (`scripts/scan-v2/metrics.ts`)

- Field accuracy = exact matches ÷ all sessions (abstentions count against).
- Answered precision = exact ÷ answered.
- Digit accuracy (answered) = 1 − character edits ÷ label characters, answered only.
- Digit accuracy (all) = abstentions count as every character wrong.
- Top-3 hit (v2) = label among the three candidates.
- Abstentions are reported as a separate count, never as successes.
- **v2 confident** operating point: threshold `confidence ≥ 0.8`, chosen on the tuning
  split (146 answered, 144 correct there), applied unchanged to held-out sets.
- Leading zeros are ignored on both sides.

v2 always shows its proposal on a verification screen; "answered" means it
produced a proposal, not that anything was saved.
