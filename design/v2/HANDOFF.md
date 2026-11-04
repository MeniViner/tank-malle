# Current recovery checkpoint — 1.7.0 candidate

Updated 2026-11-03T23:17:48.428046+00:00. The user explicitly asked to finish and deploy. The finite
Stage 6 implementation is now complete and saved in this working tree; read
`design/v2/evidence/stage-6/QA.md` first. TypeScript passed; full units are
1,089 passed + 12 private-fixture skips; lint is 18 warnings / 0 errors.
599 source inputs were unchanged during the integrated checks.

**Not deployed. Browser acceptance remains blocked.** Chromium IPC is denied
before assertions; host permission was automatically rejected. GitHub's
correct personal connection returns403 for an actual write; CLI GitHub and
Firebase have no authorized login. Do not repeat these failures or substitute
unrelated credentials. Do not label the recovered Stage5 or Stage6 browser
gates as passed. A checkpoint commit and a clean-build/recovery kit follow.

All agents are finished. No source edit remains intentionally in progress.
The original accepted Stage0–4 history remains intact. Prior notes below are
historical and their “running” processes are stopped. See the current QA report
and `git log -1` for the source checkpoint to resume.

---

# Design v2 handoff

## Resume here

Stage4 is accepted and committed. Stage5 is implemented but **not accepted or committed**. Stage6 code is still held. Do not restart earlier stages or ask for confirmation; continue the authorized redesign through Stage6 and attempt the final branch push without opening a PR.

Current repository: `/workspace/scratch/264b53bb37f3/tank-malle`.
Branch: `feat/design-v2`; HEAD `f2d813d673bce7de9118e308f173dee60f25f399`.
The supplied final ZIP was extracted unchanged and committed on local main (`040267f`) before this branch, based on upstream `ff78c7db5f819deaf09d5b5b99237cc8d194a447`.

## Current verification checkpoint

**Current: full main cycle7 is green and stopped; QA owns active full Unified7, actual session23490.** Main actual session32808 exited0:276 passed,2 expected private-workbook skips,0 failures/flaky/not-run/top-level errors, all278 cases/33files/two base projects, zero retries. Original report `/tmp/tank-design-qa/reports/stage-5-main-cycle7.json`, SHA256 `bc5bceacb9e468b4e8eb483aaf376d322ddfe10f8ff14336b39d58bef3812823`, duration2381734.997ms. Root independently parsed it, matched all510 paths/hash/size/nsmtime/removals/branch/HEAD with QA/canonical, and verified all21 named main/unified/rules ports closed. Barrier: `evidence/stage-5/root-main7-stop-audit.json`, SHA256 `36c858b1b5da9b879536a11d4481cda56fdbfe052a422e071650ce9256918764`.

Unified7 command: `DESIGN_V2_STAGE=5 npx playwright test --config /tmp/tank-design-qa/playwright.stage5-unified-cycle7.config.ts`, all63 cases/nine files/four base projects, zero retries/no filters. QA launched actual session23490 after its17:43:26.760946 exact prelaunch source/closed-port audit. Log `/tmp/tank-design-qa/stage5-unified-cycle7.log`; original reporter `/tmp/tank-design-qa/reports/stage-5-unified-cycle7.json`. Source remains frozen; Stage5 is not yet accepted or committed and Stage6 implementation remains held.

Canonical candidate19 is **510 paths/no removed-tracked paths, `87c8578ac3a843359b51e722e52978e6ee3ecc71a7f4c52a1a1ba60e4cd52e49`**. Root and QA matched all paths, hashes, byte sizes, exact nanosecond mtimes, removals, branch and HEAD; all named owned ports were closed before launch. Never edit app/test/config/nonexcluded input files or run another build/rig while main7 is active. Evidence/PROGRESS/HANDOFF are outside the running input set.

Quick19 actual exit0 for tsc, lint/oxlint17 warnings and0errors,1067 unit passes+12 existing private-fixture skips (7 workbook,5 photo)/79 files, and production build65 precache entries/3962.77KiB. Build uses approved normal permissions because the sandbox rejects Vite's git subprocess. Status: `/tmp/tank-design-qa/stage5-quick-status-preflight19.json`.

All temporary module, Auth, CDP and init-script diagnostic interposition has been removed from acceptance inputs. Its exact sources/observations are preserved under evidence diagnostics. The original Reliability test keeps every original assertion/wait and adds only an independent final Bob profile/journal attachment after completion or failure. DateTime now resets each case before the original real sign-in/wizard; all seven case bodies/assertions remain unchanged. A source-only audit of all nine unified files found no concrete remaining Stage5 selector mismatch; it is not runtime validation.

Preflight17 passed18/18 (all Reliability, seven DateTime and two authored-value/clear Entry cases); original SHA `3e6cac955d6a95d12bfa3d3368c784309a9175ca54467de2b94ba4103bbf49d9`. Preflight18, with late cached-module observation and three nonpausing actual-source logpoints, passed the original A→B→A case; original SHA `7da84d0b66d532b4fcf5d636fe0a3d886c388aa0c1edaf3eff0ec9c0af6a3f0c`. Both actual exits0/stops/audits were independently verified. Its Alice/Bob opening, select entry and server-target-returned events were all recorded without observation errors, followed by real selection ACKs and Bob journal[]. **These passes do not establish the cause of preflight16's unreproduced Bob selection timeout.** No production write change was made on that unproven hypothesis. The new full uninstrumented main/unified gates are still required.

The preserved-main6 direct-review gaps are now closed (Copy55 and A11y35 originals). Fresh main7 Entry Copy/A11y PASS: five direct deltas plus59 exact-byte prior-direct reuses and four identical metric JSONs. Fresh main7 Vehicle A11y PASS:16gallery deltas+four full-conflict deltas directly viewed;109gallery+five supplementary exact-byte prior-direct reuses, zero inventory-only. Current Vehicle Copy is finishing20deltas with no preliminary new blocker. Root has separately verified all68 Entry and138 Vehicle metadata records and directly viewed five Entry and ten Vehicle originals. New reports retain exact current hashes and old reports remain immutable. Full Unified7 and final manifests still gate Stage5 acceptance.

Original uninstrumented main7 Reliability A→B→A passed14.6s, allnine Reliability cases passed, and all12Tank cases passed. Passive reporter attachments directly show selected Alice with empty journal before outage, exactlyone pending fillup.add afterward (30L/7/210/100000/original note), final Bob selected with empty journal, and both Tank journal observations empty. This does not retrospectively establish the cause of preflight16's unreproduced Bob timeout.

### Historical preflight16 checkpoint (superseded)

**Latest: preflight16 stopped with actual exit1; no rig is running.** Original report `reports/stage-5-main-preflight16.json`, SHA256 `62d9a84636363737f8c972bcf3cb5fba9fbf700a3b650d510a7aa22c1fefc513`: 7 passed, one failed, three serial follow-ons not run, zero retries/flaky/top-level errors, 94.696 seconds. Full main7/unified7 remain OFF. Root and QA independently verified all 510 path/hash/size/nanosecond-mtime entries, no removals, branch/HEAD against candidate `4906347f0b6d5b0411e6a550b366d15dfdaeccc55aea2694495ac3ef230501eb`, and all owned ports closed.

The original Alice offline boundary now passed with direct passive attachments: selected profile and empty journal before outage, exactly one pending fillup.add afterward, correct UID/vehicle and original values. Failure moved later: Bob's exact new server vehicle `aqO0ismS5p6GXzBYMsMg` exists, but server settings.activeVehicleId remained null for the unchanged20s readiness bound. Original network confirms profile initialization and vehicle creation HTTP200, with no later captured profile write. It does not prove which selection guard or continuation stopped; no production change is justified yet. QA is preparing a passive exact-operation/receipt diagnostic. Do not force selection or weaken the barrier.

Quick16 all actual exit0: tsc, lint17 warnings/0errors, units1067 passed+12 existing private-fixture skips (7 workbook,5 photo)/79files, build65 precache entries/3962.77KiB. No application/rules changes since the reviewed main6 galleries. Main6 Entry/Vehicle Copy and Accessibility delta reviews PASS with bounded provenance in their current JSON/Markdown reports. All206 reviewed main6 images/metrics/supplements are preserved in diagnostics/main6-reviewed-gallery (manifest SHA `f8135f750d61102f30392e8dc37b745ac19244118ed7456f06a6f6cc5d62ec07`).

After the stopped/audited run, a separately verified DateTime fixture defect was corrected: beforeAll reset plus an immediate header.count could create a second same-name vehicle. It now resets before each test and drives the original real sign-in/wizard unconditionally. All seven test bodies/assertions are unchanged. No further run has been authorized; the next candidate needs a fresh freeze and quick cycle.

### Historical main6 checkpoint (superseded)

**Current: QA owns active full main cycle 6, session 60791.** All 278 cases/33 files/all base projects, no filters, zero retries. Command: `E2E_ISOLATED=1 DESIGN_V2_STAGE=5 npm run test:e2e -- --config /tmp/tank-design-qa/playwright.stage5-main-cycle6.config.ts`. Log `/tmp/tank-design-qa/stage5-main-cycle6.log`; original report will be `reports/stage-5-main-cycle6.json`. Unified remains OFF until the actual full-main result/stop/root audit. Stage 5 is not accepted or committed; Stage 6 code remains held.

Canonical candidate/root-preflight15 is **510 paths, no removals, `507d169efe6a3215be44f46531884dd4a88c6063f44de5928e763a3a1df98d76`**. The only change from main5 is `e2e/tank.spec.ts`: actual server active-vehicle selection readiness followed by the original outbox0 check, exact Save scoped to the existing odometer sheet, and two passive journal attachments. No application/UI/rules change. Quick15 all actual exit0: tsc; lint17 warnings/0errors; units1067 passed+12 existing private-fixture skips (7 workbook,5 photo)/79files/4.46s; build65precache3962.77KiB. Logs/status use preflight15 suffix.

Complete serial tank preflight15 passed **12/12 in71.454s, actual exit0**, including all four previously unrun cases. Original SHA `f7b23af13c547b07e6d6cb632d022fc3b416790ac6e22617e45ec5c690b944df`. Both actual journal attachments were exactly empty before the odometer Save and after the unchanged two-server-observation/no-fillup assertions (SHA `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`). Root independently parsed the original, verified every post-run path/hash/size/nsmtime/removal/branch/HEAD against QA/canonical and all16 named closed ports before main6 GO.

All206 reviewed main5 Entry/Vehicle/calendar/conflict originals are preserved with exact bytes and nsmtimes in `evidence/stage-5/diagnostics/main5-reviewed-gallery/`; manifest SHA `ee06dc0070a971fbffe76f034b568469326bb67c8d8dc5a7174638e2d8212fe6`. Application-identical Copy/RTL and A11y proofs remain explicitly tied to their observed files; current main6 gallery provenance must be verified after regeneration. Prior full-cycle history follows.

Stage 5 remains implemented but unaccepted. Main cycle 5 finished normally with actual exit 1: **271 passed, one strict-locator failure, two existing private-workbook skips, four serial follow-ons not run**, no retries, flaky results or top-level errors. The run covered all 278 collected cases across 33 files and both base projects; three PWA cases passed. Unified was never launched.

Original report: `/tmp/tank-design-qa/reports/stage-5-main-cycle5.json`, SHA256 `6a8fb3eecf4fad852826aa21cd80a1f34266c7e8277161116b0b7917175b1bcd`. Duration 2319.353 seconds. Root independently parsed it; the four follow-ons have expectedStatus passed and workerIndex -1, not an expected fixture exclusion.

Exact failure: `e2e/tank.spec.ts:304` uses unscoped substring button name “שמירה”, matching both the Home attention spotlight and the nested odometer Save. Error-context and original trace are preserved in `/tmp/tank-design-qa/results/stage-5-main-cycle5/tank-an-odometer-update-is-a-reading-not-a-fill-up-chromium/`. No odometer submission occurred. QA is separately tracing why that screenshot had an attention operation before classifying it; do not assume its cause.

QA and root independently matched all 510 canonical path/hash/size/nanosecond-mtime entries, removed paths, branch and HEAD after the stopped run. Canonical source remains `bf7818bc88fb22e02c229a50a13e494bd762fc49b1204863bc6c1a7b456318ba`; post-audits are `stage5-source-{qa,root}-after-main-cycle5.json`. All 16 named main/unified/rules ports are closed. Root has released **only** the bounded selector migration to `tank-odometer-sheet` and exact Save to QA. No production correction is authorized by this locator failure. QA will supply the new candidate, root will rerun quick gates, then explicitly release the complete serial tank.spec.ts diagnostic. Preserve all actual server, receipt and no-invented-fillup assertions. After a green diagnostic, a new unfiltered full main and full unified cycle is required. Stage 6 implementation is still held.

Current Entry/Vehicle Copy and A11y reviews PASS independently. Both verified all 197 current gallery files and nine supplements against preserved preflight14. Every geometry/style JSON is byte-identical; actual minimum contrast 4.762:1 and all sampled native targets at least 44px. Current manifests: `copy-rtl-main5-final-current.json` and `accessibility-main5-current-reviewed.json`. Recovery currently shows pending approval, not rejected; the resolved issue badge correctly reads “נפתרה · חשובה”. An initial reviewer misreading was withdrawn after original-image/source/DOM review. Existing native Care date presentation is explicit Stage 6 cosmetic debt.

Quick preflight14 gates on unchanged application source were green: tsc, lint 17 warnings/0 errors, 1067 unit passes plus 12 existing fixture skips across 79 files, production build 65 precache entries/3962.77 KiB. Rules 240/240 across nine files, actual exit 0; see PROFILE-BOOTSTRAP.md and diagnostics/profile-atomic-settings-rules.json. The only post-rules test changes were comments, independently verified. The corrected eight Entry/Vehicle preflight14 galleries passed 8/8 before main5. Historical checkpoint detail is retained in diagnostics/handoff-before-main5-selector.md.

Stage 6 finite plans remain ready in `/tmp/tank-design-qa/stage6-*.md`, including root notification ownership, Auth UI continuation guards, the real-SDK Auth QA case, Admin, secondary screens, civil fields/RunningCosts, narrow import provider guards, QA, and the four core visual corrections. No Stage 6 implementation has begun.

## Accepted commits

| Stage | Commit |
| --- | --- |
|0|`0e6e2e22f8a5015bb1c2f557a591e087341fe076`|
|1|`8ee554a8331059e6899cc63f17188f58e72df498`|
|2|`9350d3df3873a006ff26fe6dd90135a345654d3b`|
|3|`cce95f3b2c8697407301c7e0931e0edecf22fca9`|
|4|`f2d813d673bce7de9118e308f173dee60f25f399`|

Earlier accepted gates and full evidence are recorded in PROGRESS.md and each stage evidence directory. Do not repeat accepted stage work.

## Stage5 implementation and protections

Vehicle docs have optional test/mandatory/coverage metadata, strict civil dates, exact editable costs, insurer choices and preserved unknown fields. Document cost is metadata only, never a ledger expense. Three permanent rows, document sheets, vehicle edit/list/archive/restore, odometer boundary checks, issues and linked history are implemented. Entry/onboarding/wizard and consent are restyled; manually cleared wizard/edit suggestions retain user-owned nulls.

Document writes use captured coherent raw opening evidence, conditional selected-child writes, exact attempts, parent identity and account/vehicle lifetimes. Outbox.rebase has one optional synchronous predicate checked against the actual entry inside the existing IDB transaction; the old three-argument behavior remains. Vehicle creation retains its real durable operation identity through optimistic first-run unmount and recovery. Vehicle selection is separately receipted and cannot turn a successful primary archive/delete into a misleading failure. See WRITE-REVIEW.md and source tests.

Home/Notifications use document occurrences keyed by document/due-date/phase: month8–30 days, week0–7, expired negative. Coverage:none suppresses due dates; insurer/cost changes do not reset occurrences. Home urgency and notification read/archive/snooze remain independent. No fake treatment is recorded for document reminders.

Rules passed the complete real emulator suite:237/237 in8 files,32.60s, exit0. Final rules SHA `1d4a07d1abefb4be2d7fe5fd44966db5434ae704130433ef01649d339486a108`; document-rules-test SHA `b74c981a78e616d576b2bc95f2e28a4ca931f2d2af6f929924b5e8669de3f578`. Command:

```sh
RULES_FIRESTORE_PORT=18091 npx --no-install firebase emulators:exec --only firestore --project tank-maleh-rules-test --config /tmp/tank-design-qa/firebase.stage5-rules.json 'npx vitest run --config vitest.rules.config.ts'
```

Default8080 was occupied; isolated18091–4 were stopped afterward. Changed known doc leaves are validated additively, unchanged malformed legacy/unknown fields survive; owner/deletion locks remain. No rules change since that run; do not rerun unchanged rules unnecessarily.

## Corrected browser findings

- RouteScroll previously stole focus after document Sheet Escape. An unchanged-source focus probe proved Sheet focus first, route heading second. Same-/vehicle document-query-only changes now preserve placement; real page/hash/subview changes keep existing behavior. All four document opener tests and disabled-fieldset/native-summary traps passed.
- Native consent checkbox inherited20px from later legacy CSS. Scoped input specificity now yields44px. Actual normal/reduced-motion consent shake, Space, persistent error and all four entry appearances passed.
- Former held-journal test manufactured an unowned interval after real enqueue. Diagnostic phase snapshots proved this. The corrected fixture holds before enqueue, returns the actual commit immediately so normal registration runs, then holds writer get for the exact captured operation. Exact IDB, raw concurrent siblings, final server merge, outbox0 and preserved newer sheet all passed. Production write pipeline was not changed to fit the artificial interval.
- Actual native calendar/leap-day/ISO, odometer lower/3000/3001 limits and all11 raw-document cases passed. Remaining18 diagnostic (precise edit, issue Escape, all four deep galleries and12 lookup tiers) passed18/18; original SHA `41c2ed35d667234128551101f42d1a63c2450a9f36423e2571c6e9717f1cbc76`.
- Notification archive was enabled before its baseline, producing wrong version1 SET against existing version1. New notificationBaseline metadata distinguishes cached known rows from unconfirmed absence; raw malformed IDs cannot become creates; knowledge belongs to one subscription object lifetime. No generic write/rules/outbox change. Nine boundary unit cases and independent source review pass. Actual lifecycle now passes exact version2 archive image. See NOTIFICATION-READINESS.md.
- Manager now uses compact ruled rows,16px UI names, inline plate in one NumRun, centered header and the same selection/archive/restore/delete/edit controls and logical focus map. Shared44px Sheet close is outlined/circular. Issue resolution dismisses only its owned pending toast on receipt settlement.
- Preflight7 corrected lifecycle and complete light/plate Vehicle gallery passed2/2. Correct preflight7 SHA: `173f40208536bb49154200bff6737d1c7414c6b46bff82f281a4a4615a00c608`. All ports stopped and exact507/79619cdd audit passed.

## Reviews and remaining Stage5 acceptance

Copy/RTL and Accessibility source reviews pass. Entry52+22 captures and deep Vehicle124 captures were inspected. Current compact Manager/archived/restored, issue resolution and document Sheet light/plate have independent rendered PASS. All four corrected appearances regenerated successfully in diagnostic main cycle2 at12:05:38–12:06:46 UTC. Copy and A11y both PASS the corrected matrix with current hashes retained in copy-rtl-corrected-appearance-final.json and accessibility-cycle2-matrix-reviewed.json. Final complete main4 will regenerate it again after the bounded bootstrap and test-selector fixes. Actual Manager select56.67×44, archive44×44 and restore44×44; logical rows keep visible2px focus. Recorded contrast: light error6.105:1, dark error7.216:1, dark scrolled secondary6.699:1, date readouts18.552/10.553:1. Reports distinguish computed-color ratios from raster inspection and retain exact available hashes.

Full main+unified green, fresh screenshot manifest, exact final source audit and final Copy/A11y reports are still required. Then append the final Stage5 report to PROGRESS, commit `design-v2: stage 5 — <summary>`, record its SHA in the next progress update, and release Stage6. Never call partial diagnostics full acceptance.

## Stage6 prepared work — no implementation yet

- `/root/secondary_stage6` is READY after read-only prep. Owns ImportData/Unsynced/Feedback/Legal + scoped secondary CSS and only the outboxStatusText failed-label string. Detailed plan: `/tmp/tank-design-qa/stage6-secondary-builder-plan.md`; copy prep beside it. Keep actual import/rollback receipts/raw IDs, real matching batch Undo with honest limit50 fallback, UID/action guards, unknown costs and unavailable history. Neutral failed label: “לא אושר · נשמר לבדיקה”. Legal retains all sections, verified factual corrections,3Nov2026/version1.1.
- `/root/admin_stage6` is READY after reading actual boundaries and all16 prototype captures. Plan: `/tmp/tank-design-qa/stage6-admin-builder-plan.md`. Owns Admin/summary/chart/local handled feedback. Four tabs, coarse optional signed monthly breakdown, exact totals and honest unclassified fallback; no private-ledger reads or feedback writes. Local handled status is UID-scoped and labelled “אצלי”; existing appConfig price write only. Preserve claims/read-only/privacy gates. No Stage6 rules changes.
- Root owns Notifications + provider-owned ephemeral action lifetime, corrected single-use/5-second tombstone Undo, read/archive/snooze/bulk guards, actual civil-date field, semantic focus and44px controls. Full plan: `/tmp/tank-design-qa/stage6-notification-write-plan.md`. Keep Undo valid across Home navigation in same vehicle, invalid after account/vehicle A→B→A; do not replace this with mounted-page-only scope.
- `/root/qa_stage6_plan` is preparing Stage6 QA read-only, with no test edits/rigs. `/root/imports_stage6` is preparing the narrow provider guard implementation/test approach read-only. Both await explicit Stage6 GO.
- Import provider's existing account-lifetime gap needs a bounded guard using render-bound captureAccountScope and a tracker captured before the first await. Plan: `/tmp/tank-design-qa/stage6-import-scope-review.md`. Preserve exact IDs/payloads/receipts, non-active target vehicles, issued SDK writes and rollback result truthfulness; no pipeline/dispatcher rewrite.
- `/root/civil_stage6` is READY with read-only implementation plan `/tmp/tank-design-qa/stage6-civil-builder-plan.md` for of CivilDateField optional visible-input data-testid, CareEditor performed/target dates, IssueEditor discovery date, ReceiptImport date/24-hour time and RunningCosts presentation. No code yet. Root implementation notes: `/tmp/tank-design-qa/stage6-root-implementation-notes.md`. Preserve invalid saved local drafts and exact ISO persistence; do not change parsers/receipt ownership/engines. Root retains Notifications snooze and consumes the shared field API.
- Root also owns RunningCosts day-first/numeric/whole-shekel/known-unknown copy, shared Toaster NumericText, existing-code PWA icon palette regeneration, full DESIGN_NOTES rewrite and verified README links. Secondary builder may remove unused Settings/Profile/Previews only after refreshed reference proof; compatibility routes stay.
- Stage6 QA must refresh every screen in four appearances, full copy/accessibility/dark/second-accent pass and full sequential smoke. No new runtime dependencies. Legacy import aliases and protected math toFixed remain when they are not visible currency formatting.

## Runtime and publication

Java21, Node24, Firebase CLI and real emulators are available. Chromium is `/usr/bin/chromium`; bundled download was an HTML failure. QA owns isolated main ports8087/9097/5273/5274/4407/4507/9157 and unified8088/9098/5286/5448/5289. Never run the rigs concurrently or kill unrelated services.

Final publication remains previously blocked: no Git HTTPS CLI credential; the correct personal GitHub integration returned403 Resource not accessible by integration. Correct account is MeniViner, link_6ac4205575b88191af68c00812b4b98a. Do not use the work account or unrelated installation. Finish all local work first, then retry normal authorized branch push, never force-push/deploy/open PR. If still blocked, verify a complete git bundle and make the work available, stating the real access block. Do not mislabel GitHub403 as automatic approval rejection.

Historical detailed checkpoints were preserved in `evidence/stage-5/diagnostics/handoff-before-main-cycle2.md`; authoritative accepted-stage history remains PROGRESS and git.


## Latest read-only Stage6 preparation

`/tmp/tank-design-qa/stage6-auth-qa-plan.md` is ready: actual installed Firebase UserImpl result gate; observer tab stays mounted while a same-context driver tab performs real Google/UI A→B→A. Existing signIn/signOut helpers navigate and must not run on the observer. Hold only already-completed A1 getIdTokenResult, leaving token credential work unblocked. Release after real A2 admin:false; assert Account badge/adminentry and settledpreviouslogin remaincurrent. This proves stale-token publication and no obsolete rotation launch, not separately an already-issued login result. Keep Auth patch small and audit everycontinuation; no new generic asyncframework or productionbridge solely for unusedrefreshClaims.

`/root/copy_stage5_final` is performing only a bounded historical corevisualprep for Stage6, no app/test/rigchanges. AdditionalconfirmedHomegap: trio fuelprice/monthlyMoney directFmt nodes lose displayfont to more-specific .tm-number; scoped .home-trio-value.tm-number should match Karantina32 withoutchangingFmt globally. Fullfinite list willbe `/tmp/tank-design-qa/stage6-final-core-visual-review.md`. Rootowns these CSS-only core corrections after acceptedStage5.
