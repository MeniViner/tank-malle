# Stage 6 — OCR pipeline behind `scanV2` — QA

Branch: worktree branch cut from `feat/design-v3` @ `f73555b`. Commits: see the
report; all prefixed `design-v3: stage 6 —`.

## What was built

| Item | Where | State |
|---|---|---|
| Flag `scanV2` (default **off**, per device, localStorage `tank-malle:scanV2`) | `src/lib/scan/v2/flag.ts`, `src/components/scan/v2/useScanV2.ts` | done. Not a synced `UserSettings` field, so no Firestore/rules change. |
| 1 Viewfinder crop | `src/lib/scan/v2/guide.ts`; `LiveCamera` gets an optional `guide` overlay (v2 only) | done. Camera frames are read only inside the box. A photo chosen from the device has no box, so v2 reads the whole picture. |
| 2 Preprocessing (greyscale, adaptive threshold with local-contrast term, deskew + italic deshear) | `src/lib/scan/v2/preprocess.ts` | done, pure, unit-tested |
| 3 Seven-segment recogniser, top-3 per cell and per field | `src/lib/scan/v2/recognise.ts`, `pipeline.ts` | done. Segment-sampling decoder, no dependencies, no weights. Missing decimal points are inserted as low-confidence characters. |
| 4 Constraint selection over top-3 | `src/lib/scan/v2/constraints.ts` | done. Includes exhaustive tests (all 216 rankings of a 3×3×3 pump case vs brute force; odometer window swept). |
| 5 Verification screen | `src/components/scan/v2/ScanVerify.tsx` (+ `scanV2.css`) | done: crop beside values, least-confident character highlighted, editable inputs, top-3 chips, Hebrew check list, all targets ≥ 44 px (measured 44–56 px) |
| 6 On-device correction log + export | `src/lib/scan/v2/correctionLog.ts`; export/clear rows in Account | done: IndexedDB, never synced, ≤ 2,000 entries, ≤ 192×96 1-bit thumbnail, JSON export |
| 7 A/B switch in Account | `src/components/scan/v2/ScanV2Toggle.tsx`, mounted in `src/components/account/AccountPreferences.tsx` directly after the existing "כפתור תדלקתי פותח מצלמה" row (same `tm-group`) | done. The quick-scan toggle already existed and is unchanged. |
| 8 Cloud fallback | `src/lib/scan/v2/cloud.ts` | **typed seam only**: `CLOUD_FALLBACK_ENABLED = false`, no endpoint, no network code; crop-only structured request builder + JSON schema |

Wiring outside the scan folders (minimal): `ScanWizard` picks v1/v2 by the flag;
`FillupForm` passes `context={{ lastOdometer: bounds.min, tankCapacity: capacity.liters }}`
(one line); `AccountPreferences` imports and mounts `<ScanV2Toggle />` (two lines).
With the flag off the v1 flow is byte-for-byte the same component.

## Gates

| Gate | Result |
|---|---|
| `npx tsc -b` | pass (exit 0) |
| `npm run lint` | pass: 0 errors; 18 warnings, none in files touched by this stage |
| `npm test` | pass: 103 files, 1410 passed, 12 skipped (skips are pre-existing env-gated photo tests) |
| `npx vite build` | pass; `v2.worker` 16 kB, `ScanWizard` chunk 23.8 kB (lazy) |
| Main Playwright e2e | **not run** (ports owned by another agent, per instructions). `camera-zoom` and `scan-maintenance` specs exercise the v1 path, which is unchanged with the flag off; not verified by running them. |
| Visual check | Verification screen rendered with a **synthetic** pump/odometer result in a temporary harness (Vite on 127.0.0.1:5391, Chromium 390×844, RTL, light). Screenshot: `verify-screen-390-synthetic.jpg`. Dark mode and the camera overlay were **not** visually verified (no camera in the pane; harness had no ThemeContext). |
| Real device | **not run**: no phone test of camera, guide box, worker timing or IndexedDB |

## Tests added (no existing test changed)

- `src/lib/scan/v2/preprocess.test.ts` (10), `recognise.test.ts` (8),
  `constraints.test.ts` (14), `pipeline.test.ts` (7, synthetic), `support.test.ts`
  (9: flag, guide box, correction log with fake-indexeddb, cloud seam).
- `scripts/scan-v2/metrics.test.ts` (4).

## Accuracy

See `ACCURACY.md`. Headline (held-out TRODO test, 713 odometer photos, simulated
framing): v1 2–4 % exact, v2 40.7 % exact with 257 wrong proposals; v2 confident tier
91 % precision at 23 % coverage. Real pumps: 0/3. Tuning used only the TRODO tuning
split; protocol frozen before held-out runs.

## Known gaps / follow-ups

- Account deletion's "local data" step does not clear the correction log
  (`DataContext` is owned by the data-layer agent). Follow-up: call
  `clearCorrections()` in the `local` step. Meanwhile Account offers a two-tap
  "מחיקת תיקוני הסריקה מהמכשיר".
- `ScanV2Toggle` opens the IndexedDB on Account mount to count entries (creates an
  empty database once).
- The Account screen is being redone by another agent: `ScanV2Toggle` is
  self-contained (renders `GroupRow`s) and can be moved as one line.
- `design/v3/HANDOFF.md` says agents do not commit; this stage committed because
  the coordinator's Stage 6 brief asked for small commits.
- Pump reading on real photos fails (row finding on unlit grey LCDs, tiny
  displays). Needs real captures from the viewfinder before any user exposure.
