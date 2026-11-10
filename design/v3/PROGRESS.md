# Design v3 — progress

| Stage | Status | Key commits | Evidence |
|---|---|---|---|
| 0 Baseline | accepted | `f73555b`, `ebd1e24` | `evidence/stage-0/` (checklists: 611 behaviours, before gallery, prototype set, e2e baseline) |
| 1 Tokens and tone | accepted | `3ce24ea`…`302cd22`, `3f37658` | `evidence/stage-1/` (QA, CONTRAST, DIFF) |
| 2 Home | accepted | `12c3b7c`…`6525f9f` | `evidence/stage-2/` |
| 3 Facts strip, Insights, Vehicle, Account | accepted | `00e7c5e`…`b25c212` | `evidence/stage-3/` |
| 4 Forms and sheets | accepted | `8188d59`…`9b35a13`, `9d79521`, `fbc4bf1` | `evidence/stage-4/` (QA, QA-merged, DIFF) |
| 5 New features | accepted (EV charge records out of scope) | `49e6849`…`7b0351e`, `3021a0a`…`5104f8d` | `evidence/stage-5/` (DATA, MIGRATION, EV-AUDIT, DIFF, QA) |
| 6 OCR v2 (flag `scanV2`, off) | implemented; accuracy below target, see ACCURACY | `3dc56f6`…`4d296a2` | `evidence/stage-6/` |
| 7 Acceptance | done | `2140048` | `evidence/stage-7/` (QA, DIFF, FIXES) |

## Final gate results (after the Stage 7 fixes)

- `tsc -b` passes. `oxlint` 0 errors; the 20 warnings are all in files v3 didn't touch. `vitest`: 1,528 passed, 12 skipped (private fixtures). Rules: 287 passed. `vite build` passes.
- Main e2e (chromium + pwa): 318 passed, 1 failed, 8 skipped. The failure was `mobile-fuel-release.spec.ts:21`, which already failed at Stage 0 on `main`. It is now fixed (see below).
- CI follow-up: automatic spec fill-in (tank size, declared consumption) could run against the cached vehicle list before the server copy arrived; the write was refused and never retried. It now waits for the listener's copy (`activeVehicleVerified`). `audit-fixes.spec.ts:234` raced a history-back with the next navigation; the test now waits for the back navigation to land. The specs under other configs: 53 passed, 2 skipped.
- Smoke walk at 390/430, light and dark: 42 of 43 steps pass in each run. The failing step is "fill(charge)": production has no charge (kWh) record type. Console: 0 errors and 0 React key warnings on every route.
- Offline: a fill-up and an expense made while offline reach "confirmed" when back online, and the journal shows the pending state meanwhile.

## Known gaps

- EV charge records (kWh fill-ups, "טענתי", consumption per 100 km in kWh) don't exist in production and weren't added. For EVs, per-litre figures show "—" with a note.
- Battery kWh and WLTP range aren't in the ministry registry; the owner enters them in the wizard.
- OCR v2 is experimental and off by default. On held-out odometer photos it reads 40.7% exactly (current scanner 1.8%), but it proposes many wrong values, and it got 0 of 3 real pump photos. Not validated on a phone.
- Production differs from DESIGN-V3 §6 in about 25 places; production behaviour was kept (`evidence/stage-0/checklists/README.md`, the stage DIFF files).
- Not run: WebKit, real devices, 768px visual review.
