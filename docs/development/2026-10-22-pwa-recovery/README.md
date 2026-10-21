# PWA recovery and update acceptance — 22 October 2026

Candidate version: **1.5.1**. The completion reply and the annotated release tag identify the qualified commit, CI run and Hosting receipt. This report supplements the [previous UI validation](../2026-10-21-ui-review/VALIDATION.md); it does not replace its historical results.

## What was established

The public site and laptop preview were independently serving **1.5.0 / ec3f58b8644faed1bcd24750e7edd6f34cf4958e** when this investigation began. The public build metadata was HTTP 200 with `no-cache, no-store, must-revalidate`. This establishes server state, not the version on Meni's Android phone. No phone profile was inspected or cleared.

The earlier [successful CI run 39674696049](https://github.com/MeniViner/tank-malle/actions/runs/39674696049) remains a genuine pass. The later [main run 39676613827](https://github.com/MeniViner/tank-malle/actions/runs/39676613827) genuinely failed: its unified job had 42 passes, 2 skips and one failure at `care-pwa.spec.ts:33`, receiving zero server documents after reconnect. The other three jobs passed. Its job log was retrieved directly. The trace mentioned in that log was **not uploaded by that job**, so the exact historical browser interleaving cannot be recovered.

Four unchanged local executions of the PDF case passed. Instead of weakening or blindly retrying the assertion, a controlled browser disk delay reproduced the same failure mode: the independent outbox committed first, the form navigated home before the SDK's IndexedDB transaction completed, and immediate reload cancelled that transaction. After reconnect there were zero server records and one retained outbox input marked `failed/unconfirmed`. **The input was retained; automatic delivery failed.** This is a demonstrated product race consistent with the CI symptom, not proof of that run's exact scheduling.

The regression first failed against the old code because it expected the form to stay open during the blocked disk write but found Home. With the fix it waits for the matching local SDK snapshot, then restarts offline and asserts exactly one server record with the original values after reconnection. A second test covers the same ordering for maintenance. Firebase's installed SDK emits those local mutation snapshots after its local persistence transaction completes; server acknowledgement remains a separate promise.

## Changes

| Before | After |
| --- | --- |
| Outbox enqueue could dismiss a fillup or care form before SDK persistence. | `src/lib/localWriteAcceptance.ts` and `src/context/DataContext.tsx` wait for the exact fillup write marker or matching care record locally, while separately tracking the server receipt. No extra writer or automatic outbox replay was added. |
| A running installed PWA relied on browser navigation to discover a release. | `src/lib/appUpdates.ts` and `src/components/UpdatePrompt.tsx` check on registration, visible resume/focus, reconnect and hourly while visible. Checks are throttled; discovery never activates an update. |
| A dismissed waiting update had no explicit way to reopen its prompt. | `src/components/UpdateCheckButton.tsx` and `src/screens/Settings.tsx` provide **בדיקת עדכון**, distinguish offline/error/current/waiting states and reopen the waiting prompt. |
| Update activation could reload an editor whose draft storage failed. | `src/hooks/useAppUpdateBlocker.ts`, `src/screens/FillupForm.tsx`, `src/components/maintenance/CareEditor.tsx` and `UpdatePrompt.tsx` refuse activation/reload while a local save is incomplete. This also protects against activation in a second tab. |
| Loading buttons lost their accessible name. | `src/components/Button.tsx` preserves that name and exposes `aria-busy`, including while a delayed disk save keeps the form open. |
| No deterministic test of the disk gap or real waiting-worker upgrade. | `e2e/helpers/disk.ts`, `e2e/care-pwa.spec.ts`, `e2e/care-pwa-upgrade.spec.ts` and `scripts/pwa-upgrade-test.mjs` exercise disk ordering, waiting/activation, both drafts, an offline queue, existing records, dismissal and cross-tab protection. |
| No upgrade fixture in the unified rig. | `playwright.unified.config.ts` serves two optimized emulator builds on loopback port 5289. Its previous version label is synthetic (`acceptance-before`); these tests do not claim a physical-device or deployed-1.5.0 upgrade. `playwright.config.ts` excludes this fixture from the legacy rig. |
| The failed unified job discarded its trace when the runner exited. | `.github/workflows/ci.yml` retains failure diagnostics for seven days. Only synthetic fixtures run in CI; the supplied personal photographs are local-only. |
| Release string was 1.5.0. | `src/lib/version.ts` identifies this actual repair as 1.5.1. This report records fresh evidence only. |

The new controls retain the existing RTL typography and a minimum 40-pixel touch target. Activation remains an explicit **רענון** action; **אחר כך** leaves the current document open. Durable drafts restore after activation. A draft that cannot be saved keeps the current document and its inputs open instead.

## Validation

| Check | Result |
| --- | --- |
| Focused receipt/update unit coverage | 8 passed. |
| Full local unit suite, including the two supplied private photographs | 701 passed, 7 private-workbook cases skipped. |
| Types and lint | Passed; 20 existing warnings, no new warning or error. |
| Legacy reliability suite | 9 passed, including rejection, immutable versions, retry and Undo. |
| Full unified Chromium, offline PWA, HTTPS and mobile WebKit | 70 passed, no skipped or failed case. Includes the 3 two-build upgrade scenarios and both deterministic disk-delay regressions. |

The first exploratory upgrade run exposed two harness issues: the test clock also changed `performance.timeOrigin`, and a dismiss-button selector differed from its accessible name. The final assertions use a per-document random marker to detect reloads and the visible, accessible **אחר כך** label. No durability, duplicate-prevention or update-acceptance assertion was removed or relaxed.

The two supplied photographs were again read locally through the normal test flow. This is evidence about those files, not a physical camera session. Real provider receipts and Meni's installed Android/iPhone remain manual acceptance items.

All destructive browser/storage tests use disposable contexts and dedicated demo emulators (9098/8088; legacy 9097/8087). The guided-demo pair 9096/8086 and unrelated emulators are not reset. No production document test writes, schema migration, Functions activation, AI/OCR model, image upload or private data from another app is part of this repair. Publication is Hosting-only; Firestore rules remain unchanged.

## Android follow-up — about five minutes

1. Open [Tank Maleh](https://tank-malle.web.app/) in Chrome. This public HTTPS URL needs no local certificate installation. If the installed app shows the older build, refresh its Chrome page once and wait for **גרסה חדשה זמינה**; use **רענון**. Do not clear site storage or uninstall the PWA to update it.
2. In Settings, verify **1.5.1** and the commit displayed below it. Tap **בדיקת עדכון**. With no later release available, expect **לא נמצא עדכון חדש**. Offline, expect the request to reconnect, not a claim that the installed version is current.
3. Enter a recognizable unsaved fillup draft, leave and return. Expect the same values. Create a maintenance draft with two jobs and repeat. Existing history must still be present.
4. For an offline save, wait until the save finishes and the editor closes, then close/reopen the app. Expect the pending entry and its data to survive. Reconnect and verify one history record and no pending operation. Do this with an account/vehicle intended for acceptance data.
5. If another release is offered, **אחר כך** must preserve the current document. **בדיקת עדכון** must make the prompt available again. **רענון** should preserve saved drafts and pending data. If storage reports a failed draft, finish saving it before updating; the app must keep the current input open.

The prior [20–30 minute acceptance checklist](../2026-10-21-ui-review/ACCEPTANCE.md) still covers multiple jobs, refunds, reminder recurrence, photographs, receipt extraction and duplicate prevention. Its physical-device/provider steps are not marked complete by desktop automation here.
