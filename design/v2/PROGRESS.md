# Current status — Plate v2 finishing checkpoint

- Stage0–4: accepted history preserved.
- Stage5: recovered source and Vehicle Copy review preserved; final Unified
  acceptance remains environment-blocked.
- Stage6: finite source implementation complete; integrated static/unit gates
  pass. Browser release acceptance and deployment remain blocked.
- Current app version:1.7.0 candidate. Source branch:feat/design-v2.
- Latest upstream main checked:ff78c7db (1.6.2).
- See `evidence/stage-6/QA.md` for current evidence and exact remaining steps.

---

# Design v2 implementation progress

## Reference and baseline

- Repository: `MeniViner/tank-malle`.
- Latest upstream `main` checked at start: `ff78c7db5f819deaf09d5b5b99237cc8d194a447` (release 1.6.2 merge).
- Supplied final attachment: `tank-malle-design-v2-final.zip`, SHA-256 `3388016111e25a7aff4ff17fa7c55e199b9ddf01e7a7feee17744807254fe42f`.
- The ten supplied reference files were extracted without edits at the repository root and committed on local `main`: `040267f` (`docs: add final Design v2 reference package`).
- Implementation branch: `feat/design-v2`, created from that local reference commit.
- Remote publication is blocked: Git HTTPS has no writable credential (`could not read Username`); the connected personal GitHub integration also rejected `create_tree` with HTTP 403 `Resource not accessible by integration`. Neither branch has been published by this session. No production deployment or PR was attempted.
- Read the complete design reference, AGENTS.md, README.md and old DESIGN_NOTES.md, then tank-intelligence sections 1, 8, 9, 10 and relevant production source.
- Clicked and captured prototype screens at 390×844 in light/dark and plate/mint, including every tab, saved states, document sheets, wizard steps, onboarding slides, all Insights/Admin tabs and the rejection-to-Unsynced route. Local licensed font files and pinned copies of existing prototype runtime resources were used for deterministic loading; the committed reference remains unchanged.

### Baseline commands

- `npx tsc -b --noEmit`: passed.
- `npm run lint` and `npx oxlint --format json`: passed, 20 warnings.
- `npm test`: 734 passed, 12 skipped, 54 files.
- `npm run build`: passed; 782 modules, 60 PWA precache entries.
- `E2E_ISOLATED=1 npm run test:e2e -- --config /tmp/tank-design-qa/playwright.system.config.ts`: passed on detached upstream `ff78c7db`, 141 passed / 2 existing private-workbook skips / 0 failed (12.6 minutes). All three full offline PWA restart tests passed.
- The unified suite will run against the completed stage 0; any ambiguous failure is compared with the corresponding upstream test instead of duplicating the entire baseline suite.

### Test environment

Java 21.0.12.1, Node 24.22.1, Firebase CLI 15.34.0 and Firestore emulator 1.22.0 are available. Browser download returned an invalid HTML payload, so Playwright uses the installed Chromium 155 via a temporary, uncommitted launch override. Google auth bootstrap requires the managed session proxy certificate. A persistent shared-trust change was rejected by automatic approval review; instead, a disposable test-only NSS database selected through process-scoped `XDG_DATA_HOME` was used successfully with TLS validation enabled. No shared trust store, HOME, production code or browser security flags were changed.

## Stage 0 — Foundation (accepted)

Builder source and root integration are complete. Copy/RTL, accessibility, visual review and the complete DEV smoke cycle pass. Implementation commit: `0e6e2e22f8a5015bb1c2f557a591e087341fe076` (`design-v2: stage 0 — foundation, accents and atmosphere`).

### Smoke cycle, first integration pass

- `npx tsc -b --noEmit`: passed.
- `npm run lint`: passed. `npx oxlint --format json`: 20 warnings, 0 errors.
- `npm test`: 744 passed, 12 skipped, 56 files. All original protected-engine unit tests remain unchanged.
- `npm run build`: passed, 63 precache entries. All 14 local WOFF2 files (181,224 bytes) precached; no external font request remains. Removed 14 unused legacy font files (342,178 bytes).
- Main/unified e2e: incomplete, not accepted. A first main run stopped at 50 passing cases on two explained unit-label selector failures; the visible numeric labels retained their LTR islands and gained complete accessible names. Both failures passed the focused rerun.
- The next main run passed 108 cases with 2 existing skips before being stopped for a real visual mismatch; the concurrent unified run passed 36 with 2 existing skips and found one sheet/toast close-selector ambiguity. No data/engine assertion was removed.
- Expanded visual review found opaque legacy screen backgrounds covering the atmosphere in FillupForm (normal and edit-state), ImportData, Unsynced and VehicleWizard. These covers were removed. SignIn's old full-width hero/panel and Admin/Notifications header strips now permit the atmosphere to show. Cards, inputs and sheets retain solid surfaces. Toast dismissal is named separately from sheet dismissal.
- Focused runtime verification passed: six palette swatches and persistence, legacy/custom fallback, system appearance, unit conversion, numeric islands, short confirmation scrolling, nested Escape preserving the draft, and keyboard Undo inside a modal restoring the exact server record.
- Final standalone scroll profile: 40 loaded entries, 3,649px scroll, Chromium renderer CPU slowed 4× at 390×844, p95 16.8ms / maximum 16.8ms, no long tasks. This is a DevTools emulation, not a physical Android measurement.
- Required Home/History/Settings evidence has exact 390×844 primary captures in light/dark × plate/mint, with separate full-page versions. The route atmosphere preflight is being expanded to every existing screen before the complete main/unified restart.

### Preservation decisions

- Keep legacy import column aliases `מד אוץ` and `מיכל מלא` in `src/lib/import/schema.ts`: these are input compatibility keys, not user-facing labels.
- Keep `toFixed` in `src/lib/receipt.ts` (derived editable input strings) and `src/lib/import/rows.ts` (stable deduplication identity). Neither is read-only currency display. Removing them would violate the stated receipt/import guarantees.
- Text-only terminology edits in protected engines leave calculations and storage unchanged.
- Use `--ink-2` for ordinary secondary text on dark surfaces; the specified `--ink-3` does not reach 4.5:1 on those surfaces.
- Native dialogs retain focus containment and Escape. Production controls use minimum 44px targets even where the illustrative prototype uses smaller controls.

### Open

- Remote publication still requires a writable authorization for this repository.

### Accepted DEV smoke cycle

- `npx tsc -b --noEmit`: exit 0.
- `npm run lint`: exit 0. `npx oxlint --format json`: 20 warnings, 0 errors.
- `npm test`: 744 passed, 12 existing skips, 56 files. No protected-engine test was weakened or removed.
- `npm run build`: exit 0, 63 PWA precache entries (3,701.65 KiB); all 14 local WOFF2 subsets included. The existing large-bundle advisory remains informational.
- Main: `E2E_ISOLATED=1 npm run test:e2e -- --config /tmp/tank-design-qa/playwright.stage0.config.ts`: 151 passed, 2 existing private-workbook skips, 0 failed, 15.2 minutes. Both Chromium and PWA projects ran, including all three fully offline cold-restart cases.
- Unified: `npx playwright test --config /tmp/tank-design-qa/playwright.stage0-unified.config.ts`: 61 passed, 2 existing private-fixture skips, 0 failed, 5.1 minutes. All four projects ran: unified-chromium, unified-pwa, unified-https and unified-updates. Temporary launch/config environment details and exact skip names are recorded in `evidence/stage-0/QA.md`.
- The final expanded visual preflight passed all four appearance cases at 390×844: light/dark × plate/mint. Eighty primary route/slide captures cover 20 surfaces per appearance; 12 full-page supplements and 5 control/profile captures bring the inventory to 97 PNGs. The complete list is `evidence/stage-0/screenshot-manifest.json`.
- Final corrections verified visually: every routed screen exposes the atmosphere, the Wizard step label has adequate ink contrast, onboarding reads `1 / 3` as one isolated LTR run, and toast dismissal is distinct from sheet dismissal.
- The full-run performance case was measured before overlapping the isolated unified suite: 40 journal entries, 3,649px scrolling, 4× renderer CPU slowdown, p95/max approximately 16.8ms, zero long tasks. This is Chromium DevTools emulation, not a physical Android measurement.
- Source and test files remained unchanged throughout the accepted full runs. Earlier interrupted runs above are diagnostic history, not part of this acceptance verdict.

### Changed files and review

- Tokens, atmosphere, typography and app shell: `src/index.css`, `src/design.css`, `src/vehicle-design.css`, `src/admin.css`, `src/design-primitives.css`, `src/fonts-v2.css`, `src/App.tsx`, `index.html`, `vite.config.ts`.
- Accent choice and compatibility: `src/lib/accents.ts`, `src/lib/types.ts`, `src/context/ThemeContext.tsx`, `src/screens/Settings.tsx`.
- Shared components: `Atmosphere`, `Button`, `Card`, `Segmented`, `Sheet`, `Toaster`, `Num`, `Fmt`, `DesignPrimitives`, `SpotlightCard`, `ConsumptionSparkline`, its pure model, modal-layer hosting, icons and the centralized maintenance category map.
- Local licensed font binaries, three OFL licences and source/hash manifest under `public/fonts/`; unused legacy font assets removed.
- Screen/component terminology and numeric presentation updates across `src/components/` and `src/screens/`; the protected stats/tank/Auth/Data modules contain only necessary copy/comment changes at this stage.
- Existing e2e selectors updated without removing behavioral assertions; `e2e/design-v2-foundation.spec.ts` adds ten focused foundation cases; offline PWA coverage verifies actual local-font availability.
- Builder, Copy & RTL, QA and independent Accessibility roles completed. Concrete findings were fixed and verified before acceptance.

## Stage 1 — Shell and Account (accepted)

Implementation began after the accepted stage 0 commit `0e6e2e2`. Builder implementation, root integration, Copy & RTL review and independent Accessibility review are complete. The third complete smoke cycle passes on frozen source, with225 browser cases passed and4 existing private-fixture skips. QA source/evidence audit, Copy & RTL and Accessibility all pass. The implementation commit is recorded at the start of the next stage to avoid a self-referential commit hash.

### Changed files and resulting behavior

- `src/components/TabBar.tsx`, `AppHeader.tsx`, new `CarSwitchSheet.tsx`, `src/shell-design.css` and `src/App.tsx`: five navigation slots, the labeled 72px refuel button, active accent pills, Home plate/name vehicle switch, unread notification dot and Account avatar. Tabs appear only on the four primary routes, including their trailing-slash forms. Pushed screens keep real back controls. The existing quick-scan preference continues to determine the FAB's entry flow.
- New `src/screens/Account.tsx`, `src/account-design.css` and `src/components/account/`: identity, fuel, display, notifications, community sharing, data, claims-gated admin and account actions in the requested order. Both `/settings` and `/settings/profile` redirect to `/account`. Import, backup, unsynced and vehicle deep links remain reachable.
- Account retains all-account/active-vehicle CSV choices, separate tank exports, full and legacy backups, import identities, community withdrawal states, install/share/legal/feedback, sign-out cache protection, deletion/reauthentication/recovery and version/update behavior. Unknown outbox health remains actionable; pending writes are counted once. There is no sync toggle or offline-demo control.
- `VehicleUI.tsx`, `Maintenance.tsx`, `ImportData.tsx`, `MyTankCard.tsx` and the existing FillupForm capacity link: management entry points now pass through Vehicle or the car-switch sheet. All-archived imports return through Vehicle; archived records remain intact.
- `Fmt.tsx` adds mixed-label numeric isolation without changing formatting or stored values. It distinguishes a grammatical hyphen before a number from a signed numeric run. `DesignPrimitives.tsx` adds compatible GroupRow test/accessible-name props.
- `Sheet.tsx` and `modalLayers.ts` keep focus inside the remaining parent modal when a nested sheet closes while its original opener is disabled. `UnifiedTransfer.tsx` permits Escape during an authorized offline restore; the operation continues under its captured account scope and the outer status stays visible. `LegacyCareTransfer.tsx`, `maintenance/CareTransfer.tsx`, `NotificationPreferences.tsx` and `FuelDiscountSheet.tsx` receive presentation and scoped-completion fixes.
- Existing e2e navigation/selectors are migrated without removing behavioral assertions. New `e2e/design-v2-shell.spec.ts` covers navigation, car switching/archive/restore, quick scan, no-vehicle routes, unknown storage, late selection/export completions and the four appearance galleries. New `e2e/design-v2-account-restore.spec.ts` covers a real offline restore, Escape/Tab focus, navigation and exactly-once server completion.

### Reviews and corrections

Copy & RTL and Accessibility both pass after concrete corrections: visible names and plates are included in accessible names, management actions measure at least 44px, leading numbers remain physically right-aligned, numeric labels keep LTR islands, and all account/vehicle asynchronous completions are scoped to the originating mounted session. Nested sheets preserve Escape, focus and reachable Undo. Root and QA inspected native captures in light/dark × plate/mint, including the archived-only and pending-restore states.

### Smoke-cycle diagnostic history

- Focused preflight caught test timing assumptions around local journal acceptance and export reads; the tests now wait for the actual relevant state. Production data contracts were retained.
- The first complete main run passed 164 cases with 2 existing private-workbook skips and 0 failures. The first unified run passed 60 cases with 2 existing private-photo skips and 1 failure: a test tried to use a tab from a pushed reminder detail page. It now uses the visible back link before opening Vehicle costs; the same invoice amount and recurrence assertions passed the targeted rerun.
- Baseline Account galleries also wait for settings acknowledgement so a legitimate transient pending-write row does not vary their layout. Separate pending/rejected/unknown-state coverage remains.
- After those test corrections, the entire quick cycle was repeated: `npx tsc -b --noEmit` exit 0; `npm run lint` exit 0; `npx oxlint --format json`: 20 warnings / 0 errors; `npm test`: 744 passed / 12 existing skips / 56 files; `npm run build` exit 0,62 precache entries / 3714.11 KiB. `git diff --check` is clean.
- Cycle2 frozen input: 388 source/test/assets/config files, SHA256 `5884f07cd40ca492d69e6051280eef7abad5f45a6e762fde7deb561c7662a615`. Source bytes remained unchanged; the development watcher still reacted to documentation edits, as detailed below. This diagnostic cycle is not accepted.
- The second cycle ended with main156passed / 2failed / 2existing skips / 6not-run, and unified61passed / 2existing skips / 0failed. The progress monitor missed earlier failures while reporting later passes; the complete result corrected that mistake before any acceptance or commit.
- Both main failures were interrupted by Vite full-document reloads during report edits: the sign-out dialog detached, and an active CSV parse was abandoned by a reload. The import trace's new document request occurred31ms after HANDOFF.md changed. A controlled edit reproduced the reload. `vite.config.ts` now excludes the two stage reports and evidence directory from development watching; repeating combined report edits plus an evidence JSON write caused no reload or HMR. The exact report bytes were restored afterward.
- `e2e/helpers/app.ts` now scopes the confirmation click to its actual alertdialog, preventing a detached dialog from silently retargeting the underlying Account action. No import parser, payload or preservation assertion changed. The focused rerun passed15 cases with2 existing private-workbook skips and0 failures. The complete quick cycle then passed again: tsc0, lint20warnings/0errors,744unit tests passed/12existing skips/56files, build62precache/3714.11KiB. Third full main/unified suites are running against388 frozen files, SHA256 `6a02070fea17f3c7fadb6b704267295af6fef96c6457f162de6b36e111961959`; their final results are still pending.

### Open

- Remote publication remains blocked by repository write authorization; this does not prevent the local implementation or emulator verification.

### Accepted DEV smoke cycle

- `npx tsc -b --noEmit`: exit0.
- `npm run lint`: exit0. `npx oxlint --format json`:20 warnings,0 errors.
- `npm test`:744 passed,12 existing private-fixture skips,56 files.
- `npm run build`: exit0;62 PWA precache entries,3714.11KiB;14 licensed local WOFF2 subsets remain precached.
- Main: `E2E_ISOLATED=1 DESIGN_V2_STAGE=1 npm run test:e2e -- --config /tmp/tank-design-qa/playwright.stage1.config.ts`:164 passed,2 existing private-workbook skips,0 failed,0 flaky,17.4 minutes. Chromium161 passed/2 skipped; PWA3 passed, including all offline cold-restart flows.
- Unified: `DESIGN_V2_STAGE=1 npx playwright test --config /tmp/tank-design-qa/playwright.stage1-unified.config.ts`:61 passed,2 existing private-photo skips,0 failed,0 flaky,5.1 minutes. All four projects ran: unified-chromium49 passed/2 skipped, unified-pwa6 passed, unified-https1 passed, unified-updates5 passed.
- All388 frozen source/test/assets/config files and the full path set stayed unchanged. SHA256 `6a02070fea17f3c7fadb6b704267295af6fef96c6457f162de6b36e111961959`. Accepted logs use explicit `stage1-main-cycle3.log` and `stage1-unified-cycle3.log`, with runner JSON hashes and complete spec lists recorded in `evidence/stage-1/QA.md` and `screenshot-manifest.json`.
- All218 PNGs were regenerated after the freeze:192 native390×844 matrix captures (20 foundation and28 shell/Account states in light/dark × plate/mint),5 further native captures,20 full-page supplements and1 short390×220 confirmation. The screenshot manifest lists each file, dimensions, capture time and SHA256. Root independently verified every image hash and inspected native Account/car-switch captures; QA reviewed all four appearance galleries.
- Isolated performance sample:40 journal entries,3649px scroll,4× Chromium CPU slowdown, p95 16.7ms, maximum16.8ms,0 long tasks. Unified started afterward. This is DevTools emulation, not a physical Android device.
- Actual flows passed: active vehicle selection/archive/restore with both ledgers preserved; quick-scan preference with typed draft retention; account isolation; scoped late selection/export completions; offline restore with Escape and parent focus followed by exactly-once server delivery; imports, duplicate prevention and batch rollback; real fill-up/pricing/tank/outbox contracts; full offline PWA restart and upgrade preservation.
- Source freeze was maintained through both complete accepted suites. Earlier diagnostic cycles are retained above and are not acceptance evidence. No Stage1 functional, visual or accessibility failure remains.

## Stage 2 — Home (accepted)

Stage1 committed as `8ee554a8331059e6899cc63f17188f58e72df498` (`design-v2: stage 1 — shell, account and vehicle switching`). Stage2 implementation, tank extraction and source Copy & RTL review are complete; Accessibility and QA are checking rendered behavior. No Stage2 acceptance is claimed.

### Implementation and first checks

- `Home.tsx`, `home-design.css`, `components/home/*`, `hooks/useSpotlight.ts`, `lib/home/*` and the shared consumption presentation helper implement the prioritised private-dismissal carousel, canonical consumption view, price/history provenance, concise empty states, trio and three recent entries. Missing or unreadable records are not represented as a first-fill history or a personal record; unknown costs remain unknown.
- `components/tank/*`, `tank-design.css` and the estimate-fed TankPreferences controls preserve one Home estimate/enrichment lifetime, expected versus recommended forecasts, observation/capacity/trip flows, mixed habit ranges, and local-journal versus server-acknowledgement wording. Unused MyTankCard was retired.
- `JournalEntryRow.tsx` is shared with the existing Journal. Pending and failed/conflicting paths remain distinct; titles, dates and notes retain numeric isolation. Home-to-entry links and History sessions are bound to the original account/vehicle; asynchronous delete/Undo completions cannot retarget another session.
- Accessibility corrections include the headline's actual visible value/unit in its accessible name, 44px actual Field input targets, opaque readable placeholders, and an ink focus ring. Source Copy & RTL findings are closed; rendered review is still underway.
- First quick preflight: `npx tsc -b --noEmit` exit0; `npm run lint` exit0; `npx oxlint --format json`19warnings/0errors; `npm test`754passed/12existing skips/57files; `npm run build` exit0,62precache entries/3747.08KiB. These precede the final shared-detail scope guard and are not an accepted complete cycle.
- First light/plate gallery exercised the main/nested sheets and full, partial, no-history, unknown and low-tank states. Its final return-to-car test exposed an insufficient harness wait for the active-vehicle settings acknowledgement; QA is adding that wait and a settled care-listener guard before baseline screenshots. No accepted visual evidence or complete e2e result is claimed yet.

### Review corrections and focused verification

- Focused Home preflight2:11passed/3failed. One source defect omitted the actual observation reading in the Home→Journal details sheet; the sheet now shows recorded odometer and gauge values with Fmt. The other failures were harness setup: a virtual clock attempted to move backwards, and a refused settings update without a before-image correctly entered conflict rather than the failed status the test expected.
- The carousel test now measures actual seven-second transitions, touch stopping and reduced-motion behavior. The rejection test uses a real versioned fill-up note edit, verifies the unchanged server base and exact amount/odometer, then retries once without adding a record. Both passed the next focused run.
- Source/runtime Accessibility review found dark atmosphere strokes behind small empty-state/trio text, inadequate empty slider boundaries, and missing descriptive values in the tank button. Local background-colored text halos preserve the specified atmosphere; the failing caption improved from3.57:1 to6.77:1, the incomplete-state trio sample measures6.78:1, and the empty editable gauge outline measures5.18:1. Actual Field inputs measure44px; placeholder contrast is9.37:1 light/6.01:1 dark. Tank accessible descriptions include current level, habit and source. The dark hero inset border, read-only gauge spacing and type now follow the prototype more closely.
- Repeated quick gates after source fixes: `npx tsc -b --noEmit` exit0; `npm run lint` exit0; `npx oxlint --format json`19warnings/0errors; `npm test`754passed/12existing skips/57files; `npm run build` exit0,62precache entries/3748.65KiB. Logs use `stage2-*-reviewed` under `/tmp/tank-design-qa`.
- Focused main preflight3:30passed/2failed,5.7minutes; unified preflight3:23passed/1failed,2.4minutes. The observation-value fix passed. Remaining failures are exact test migrations: comparing Home innerText to Journal textContent, the expanded unknown-level accessible wording, and an old assumption that stale tank data must produce a known level. QA is correcting these assertions while retaining their data contracts.
- New external vehicle-switch coverage passed: an open Home→Journal delete confirmation closes, both vehicles' same-ID expense records remain exact, both fuel ledgers retain8/1 records and no delete is queued. All canonical consumption/continuity cases passed. All four regenerated Home galleries passed their runtime assertions; root and QA inspected native captures against the prototype, and independent Accessibility review now passes. The complete final smoke cycle remains outstanding.

### Open

- Complete the focused assertion reruns, final quick/main/unified smoke on frozen input, screenshot manifest and Stage2 commit. No acceptance is claimed until those finish.
- Remote publication remains blocked as described above.

### Stage2 full-cycle checkpoint (not acceptance)

- Targeted final reruns passed: main2/2 and unified1/1. Full quick cycle repeated on the final inputs: tsc0; lint19warnings/0errors;754unitpassed/12existing private-fixture skips; build62precache entries/3748.65KiB. Logs: `/tmp/tank-design-qa/stage2-{tsc,lint,unit,build}-frozen.log`, warning JSON `stage2-oxlint-frozen.json`.
- Freeze:411source/test/asset/config files, captured2026-11-03T00:56:19.674334+00:00, SHA256 `a95a60fefd174f20a9a00658ff689eb7742b82082f9ad9771f801c7a8d18234b`. Full main cycle1 is in progress; unified follows the isolated CPU profile. Final reports and manifests remain required.
- Independent Copy/RTL and Accessibility PASS reports are in `evidence/stage-2/`. QA inspected all20Home contact sheets across light/dark × plate/mint after the contrast corrections, without additional visual findings.

### Stage2 cycle1 findings (acceptance withheld)

- Full main exposed actual manual-data loss in the automatic specification completion path: a post-reload generated45/trusted write replaced manuallysaved47/user. Trace confirms the write; the existing test's exact47/14.8 assertions remain required. A narrow automatic-enrichment server guard plus deterministic delayed/offline regression is being prepared. No protected calculation/serializer/rules changes are planned.
- Full unified exposed old Journal title selectors in care.ts, scan-maintenance.spec.ts and care-pwa.spec.ts. The intended rows and amounts are present; assertions will move to stable row IDs/collection attributes without removing any data-preservation contracts.
- Current runs continue to collect failures with their inputs unchanged. Final counts/reports will be recorded, then all fixes and the whole smoke cycle will repeat. Stage2 is not accepted and Stage3 implementation has not started.

### Stage2 rejected cycle1 completion and regression proof

- Main full run:178passed,2existing private-fixture skips,1failure,0flaky,21.7minutes. Unified full run:53passed,2existing private-fixture skips,8old-selector failures,0flaky,9.7minutes. Structured reports are `/tmp/tank-design-qa/reports/stage-2-{main,unified}-cycle1.json`. All411frozenfiles and their pathset stayed unchanged.
- QA updated the three affected Journal test files to actual row IDs/collection attributes and exact fixture titles; all data/versions/Undo assertions remain.
- The added delayed/offline/remote-manual-update regression failed against unchanged production code at the actualserverassertion: allfourmanual fields were replaced (47→45,user→trusted,14.8→16.4,user→co2-estimate) aftertheoutboxdrained. Report `stage-2-enrichment-red.json`, log `stage2-enrichment-red.log`. This confirms the test detects the bug independently of selector readiness.
- Approved narrow guard is beingimplemented. The same original/newcases mustpass, thenfullquick/main/unifiedcycle2 andfreshaccepted evidence remainmandatory.

### Stage 2 corrected acceptance candidate — cycle 2 in progress

- The automatic-enrichment guard preserves complete value/source/URL groups and original vehicle identity. It covers initial journaled transactions, retry, conflict handling without rebasing the original lookup, fresh read-only collection reconciliation, and separately grouped orphan recovery. Ordinary explicit vehicle edits keep their existing path. Protected calculations, prices, outbox, serializers, import, rules and package files remain unchanged.
- The deterministic red case now passes unchanged. All five mobile/enrichment cases passed, including original reload preservation and real recovered Retry/Overwrite controls. Complete affected unified files: 31 passed, 2 existing supplied-photo skips, no failures. Focused logs: `stage2-enrichment-green.log` and `stage2-unified-migration-green.log` under `/tmp/tank-design-qa`.
- Complete quick cycle: `npx tsc -b --noEmit` passed; `npm run lint` passed; `npx oxlint --format json` returned 19 warnings / 0 errors; `npm test` returned 776 passed / 12 existing skips / 58 files; `npm run build` passed with 62 precache entries / 3752.99 KiB. Logs use the `stage2-*-cycle2` prefix.
- Final candidate freeze: 413 files, captured 2026-11-03T01:30:01.079665+00:00; SHA256 `290b73d800cc7b296888a127236d1a8468c5c187cb60f6280bbc8ac1a164f9db`. Full main cycle 2 runs all 183 cases; full unified follows the isolated CPU profile. Neither full acceptance nor a Stage 2 commit is claimed yet.


### Accepted Stage 2 DEV smoke cycle

The second full cycle is accepted. Independent Copy & RTL and Accessibility reviews pass; QA and root verified all 413 frozen input files and all 354 image hashes. Source digest: `290b73d800cc7b296888a127236d1a8468c5c187cb60f6280bbc8ac1a164f9db`. The implementation commit is recorded at the start of Stage 3 to avoid a self-referential commit hash.

| Gate | Exact command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc -b --noEmit` | Exit 0 |
| Lint | `npm run lint` | Exit 0 |
| Warning budget | `npx oxlint --format json` | 19 warnings, 0 errors |
| Unit tests | `npm test` | 776 passed, 12 existing private-fixture skips, 58 files |
| Build | `npm run build` | Exit 0; 62 precache entries, 3752.99 KiB |
| Main e2e | `E2E_ISOLATED=1 DESIGN_V2_STAGE=2 npm run test:e2e -- --config /tmp/tank-design-qa/playwright.stage2-cycle2.config.ts` | 181 passed, 2 existing skips, 0 failures/flaky, 21.8 minutes |
| Unified e2e | `DESIGN_V2_STAGE=2 npx playwright test --config /tmp/tank-design-qa/playwright.stage2-unified-cycle2.config.ts` | 61 passed, 2 existing skips, 0 failures/flaky, 5.1 minutes |

All 24 main and 9 unified spec files ran, without retries or file/project filters. The four existing browser skips require private workbook/photo fixtures; no preservation test was removed or newly skipped. The environment wrappers select installed Chromium and isolated emulator/report paths while preserving repository projects, server commands and assertions. Full commands, suite inventory, source/report hashes and limitations are recorded in `design/v2/evidence/stage-2/QA.md` and `screenshot-manifest.json`.

Changed source groups: `Home.tsx`, `home-design.css`, `components/home/*`, `hooks/useSpotlight.ts`, `lib/home/*`, `lib/consumptionPresentation.ts`; extracted `components/tank/*`, `tank-design.css`, connected `TankPreferencesSection.tsx` and shared Gauge; `JournalEntryRow.tsx`, `journal-entry.css` and scoped History detail integration; compatible shared Fmt, Field, SpotlightCard and sparkline changes; narrow automatic-enrichment conditional writes in DataContext/useVehicleEnrichment and `lib/vehicleEnrichment*`. The unused MyTankCard was removed. Behavioral e2e selectors were migrated to actual sheets and stable rows; new Home and deterministic enrichment regressions retain exact server-value assertions. Protected calculation engines, price resolver, receipt, outbox, serializers, import pipeline and Firestore rules remain unchanged.

Evidence: **354 PNGs** under `design/v2/evidence/stage-2/`, comprising 313 native 390×844 views, 40 full-page supplements and one short-viewport capture. The light/dark × plate/mint matrix covers the 29 changed Home/sheet/shared-row states plus preserved foundation and Account routes. Every filename, dimension and SHA-256 is listed in the manifest. Root inspected native views and QA compared the complete matrix with the prototype. The isolated 4× CPU scroll sample recorded p95 16.7 ms, maximum 16.8 ms and zero long tasks; it is emulation, not a physical-device certification.

Open: no known Stage 2 functional, visual or accessibility blocker. Licensing/insurance and document spotlight entries remain scheduled for Stage 5. Private-fixture and physical-device coverage limits remain explicit. Remote publication remains blocked by the previously recorded Git credential/integration access failures; local implementation continues.


## Stage 3 — Fill-up form and saved screen (accepted)

Stage 2 implementation commit: `9350d3df3873a006ff26fe6dd90135a345654d3b` (`design-v2: stage 2 — home, spotlight and consumption`). All Stage 2 gates and evidence are accepted. Stage 3 starts from that clean commit. Builder, pure pricing builder and QA are active; root handles mutation receipts, exact-image private-rule writes and linked creation/Undo recovery. The accepted five-second Undo/ACK sequencing and preservation decisions are recorded in HANDOFF. No Stage 3 gate is claimed yet.

### Stage 3 integration checkpoint

Controlled form/Saved UI, pure scoped pricing and root mutation/Undo integration are implemented and held for review. Preliminary checks: TypeScript exit0,831 unit passes/12 existing skips/61files,19 lint warnings/0errors, production build exit0 (62precache entries3787.37KiB). The first build attempt hit the environment's git-subprocess EPERM; the authorized local build succeeded. No runtime dependency or protected receipt/stats/continuity/tank/prices/outbox/serializer/rules file was changed. New optional scope checks in writesConditional preserve default behavior.

Independent write review led to exact-origin retirement for captured updates/restores as well as initial creations, current-conflict rereads, and typed raw snapshot encoding for private rule timestamps. Fourteen meaningful IDB Undo tests and20 raw codec tests pass;21 pure pricing tests pass. QA is migrating old selectors and preserving all numeric/data/offline assertions. Full source Copy/RTL, rendered Accessibility and focused browser preflight are in progress; final full smoke/freeze/evidence and stage commit remain pending.

### Stage 3 first browser preflight and correction

The first focused preflight was stopped gracefully (exit130), with partial reports/traces retained. Main:1passed,4real failures,1interrupted;5serial dependents and remaining cases did not run. Unified:19passed,1existing private-photo skip,1interrupted,0real failures. These are rejected/incomplete runs, not acceptance. Two failures exposed an implementation error: the new account guard allowed users/<uid>/children but rejected the exact owner settings document users/<uid>. The guard now accepts that exact root or slash-delimited descendants, while rejecting another account or prefix collision. The other two failures came from a timestamp browser fixture: Firestore emulator stored microseconds, truncating the supplied REST nanoseconds before the app read it. Browser tests now verify actual raw storage and use a sub-millisecond microsecond difference; the nanosecond/type codec unit proofs remain unchanged.

Accessibility trigger/error associations and visible account-scoped retry/conflict errors were also fixed. Final preflight2 quick gates:tsc0,lint0,19warnings/0errors,831unitpasses/12existing skips/61files;git diff --check clean. Logs use stage3-*-preflight2 under /tmp/tank-design-qa. QA source/tests are frozen for gallery-first and affected unified, followed by the complete79-case focused main subset. New cases include absent/null price preservation alongside explicitzero/highprecision values. Final full smoke and stage commit are still required.

### Stage 3 focused preflight2 findings and repair batch

Held candidate433files SHA256465ba570edc6a4a57dd0d180c2e9d93754be874beed3d440da395926bf3331ad stayed unchanged in pathset/hash/size/mtime. Main finished51passed/11failed/17serialnot-run/0flaky in9.1minutes; affected unified40passed/2existing private-photo skips/2failed/0flaky. Reports use stage-3-main-preflight2.json and stage-3-unified-preflight2.json. Neither result is acceptance.

Real rendered findings: Saved13.3 used IBM Plex Sans Hebrew196px/weight400 because shared numeric CSS outranked the intended Karantina style; document width was414atviewport390. Successful pump confirmation removed the focused control and left BODYfocus. Fixes now use scoped higher-specificity display-font rules (including existing170px small-screen override), focus the accepted/attention status only if focus was lost from that region, and preserve deliberate focus elsewhere. Local form/Saved icon buttons now match the prototype circles; disabled pump labels use opacity.8 to meet4.5:1 across all12accent/theme pairs (minimum5.183:1). Accessibility source review passes; fresh runtime review remains pending.

Other failures stopped before the original data assertions on stale edit/restore/draft selectors; QA migrates them to actual local acceptance, keyed durable drafts and actual Restore labels. Every preservation assertion remains. The gauge pointer fixture aimed at y818behind the fixed footer after expanding More; the migrated test will center and hit-test the actual slider while retaining25percent/pointer-release/scroll assertions. Keyboard focus obscuration is being measured separately. Final targeted reruns, full DEV smoke, evidence and commit remain required.

### Stage 3 preflight3 — actual tank provenance bug and focus repairs

Targeted main completed42passed/4failed/0not-run/0skips/0flaky in5.7minutes; targeted unified2/2passed. All433frozen source/test/asset/config entries and mtimes remained identical (digest35f9c8a82925c2993b05de37a27e59c822a7751e8064ba4fa8b0c40fe8cf4d8f). The corrected Saved galleries now fit390px in allfourappearances; H1name/focus, expiry→Done, Yes/No result focus and deliberately moved Done focus pass. Root inspected native plate/light and mint/dark Saved views.

Three original exact-edit comparisons now reach the server and expose a REAL provenance/value defect: current-schema imported evidence is recomputed on untouched Save because tankTouched treats schemaVersion===2 as a user action. Imported pre-source became direct-gauge, post.8→1, unknown end→partial, and capacity/uncertainty was added. Builder_stage3 owns a narrow input/snapshot selection adapter and controller repair, with backwards-compatible draft snapshot. Preserve every original tankfield on unchanged/reset/reloaded edits, reason-only changes onlyreason, actual physical changes use the unchanged resolver, and quantity-only changes update derived evidence using its recorded capacity without upgrading independent provenance. Protectedengine/serializerfiles remain unchanged. The fourth test only compared native numeric aria60.00000000000001 to the literalstring60; QA will compare numerically and retain aria-valuetext60percent and originalserverassertions.

A11y measured two real focused controls hidden by the fixed footer (summaryy736/importy800). Root verified native CSSscroll-margin in an isolated Chromium155 reproduction, then added content-only20px/150px+safearea margins. Added wrapper ink focus rings for DateTimePicker and Saved pump-price to bypass an existing global input-outline override. Source review passes; next actual-gallery strict hit tests/ring measurements remain required. No browser servers are running while builder/QA complete this batch. Next: finish narrowlyscoped tank policy, complete meaningful tests, quick gates, focusedreproof, then the entire smoke/evidence/commit; Stage3 remains unaccepted.

### Stage 3 preservation reproof and complete cycle 1

The tank-edit adapter now retains unchanged imported measurements, their source and uncertainty, legacy endpoints and recorded capacity. Reason-only edits change only the reason; physical reset and draft reload preserve the original evidence; quantity changes update only dependent estimates. The displayed rejected payload and immutable server concurrency base also remain separate through reload, including posted price, fuel, import and creation metadata. Seventeen new unit cases cover that policy. Protected calculation, receipt, outbox and serialization implementations remain unchanged.

Focused preflight 4: 21 passed and one fixture failure. The app correctly removed a completely pristine draft, while the new reset test expected one to remain. After adding an unrelated note to make the draft meaningful, reloading it and restoring the original note, the same full-field preservation comparison passed. All four 390×844 light/dark × plate/mint galleries passed. Independent Accessibility review confirmed unobscured summary/import controls after real Tab navigation and solid 2px Date/pump input focus outlines. Copy/RTL and pricing source reviews pass.

Complete cycle 1 is **not accepted**. Main: 205 passed, 4 failed, 2 existing workbook skips and 5 serial dependents not run, 0 flaky, 26.4 minutes. Unified: 61 passed, 2 existing supplied-photo skips, 0 failures/flaky, 4.9 minutes. Root verified the original JSON reports and every frozen path, hash, size and mtime. The 4×CPU scroll profile passed with p95 16.7ms, maximum 16.8ms and no long tasks over 3068px.

The first three failures required bounded test migrations: stable note and restored-draft selectors, and visible history readiness before canonical-result saves. The fourth test timed out before clicking Undo because its cold double reload did not yield a server record within four seconds. An unchanged-source diagnostic confirmed eventual persistence, exact write markers and outbox drain on both cold and actual-FAB paths; the latter also passed real Undo. It did not reproduce the original delay. A possible SDK primary-lease handoff remains an inference, not a demonstrated production defect. The corrected test follows the actual FAB after readiness, retains its original 4-second presence and 15-second absence bounds, and adds exact receipt fields, version/write marker and empty-outbox assertions. All ten affected tests then passed, including all six serial consumption cases.

### Stage 3 complete cycle 2 — running

Final quick gates: `npx tsc -b --noEmit` exit 0; `npm run lint` exit 0; `npx oxlint --format json` reports 19 warnings and 0 errors; `npm test` passes 848 cases with 12 existing fixture skips in 62 files; `npm run build` succeeds with 62 precache entries (3793.21 KiB). Logs use `stage3-*-fullcycle2` under `/tmp/tank-design-qa`.

The only product change after the ten-case reproof is reviewed past-tense text for an immutable unavailable-history result. The final 435-file freeze is `stage3-source-fullcycle2.json`, captured at 2026-11-03 03:50:00 UTC, SHA256 `45c9e584c6594ad8b69bd131a490cd5f70e8e7d547f5967796cb77f2371604c9`. Main runs all 216 cases; unified runs all 63 cases after the isolated CPU check, both without filters or retries. Final reports, evidence verification and commit remain pending.

### Accepted Stage 3 DEV smoke cycle

The complete second cycle is accepted. Copy/RTL, pricing and independent rendered Accessibility reviews pass. QA and root verified the exact 435-file input set and all 438 image hashes/dimensions/freshness; root's final report audit is `evidence/stage-3/ROOT-VERIFICATION.json`. Source digest: `45c9e584c6594ad8b69bd131a490cd5f70e8e7d547f5967796cb77f2371604c9`. The implementation commit is recorded at the start of Stage 4 to avoid a self-referential hash.

Changes include the extracted `components/fillup/{FillupEssentials,FillupMore,DateSheet,StationSheet,FillupSaved,savedResult,tankEdit}` and `fillup-design.css`; the controller in `screens/FillupForm.tsx`; compatible submission/Undo/private-price integration in `context/DataContext.tsx`; `DateTimePicker`, durable draft snapshot and conditional-scope support; the new `fillupPricing`, `fillupUndo`, `fillupUndoPersistence` and `rawDocument` helpers/tests; visible scoped Unsynced errors; and updated/new e2e form, pricing, write-preservation and PWA helpers/specs. Protected engines, receipt/serializer/import/outbox logic and Firestore rules are unchanged.

| Gate | Exact command | Accepted result |
| --- | --- | --- |
| TypeScript | `npx tsc -b --noEmit` | Exit 0 |
| Lint | `npm run lint` | Exit 0 |
| Warning budget | `npx oxlint --format json` | 19 warnings, 0 errors |
| Unit tests | `npm test` | 848 passed, 12 existing private-fixture skips, 62 files |
| Production build | `npm run build` | Exit 0; 62 precache entries, 3793.21 KiB |
| Complete main | `E2E_ISOLATED=1 DESIGN_V2_STAGE=3 npm run test:e2e -- --config /tmp/tank-design-qa/playwright.stage3-cycle2.config.ts` | 214 passed, 2 existing workbook skips, 0 failed/flaky/not-run; 26.3 minutes; all 27 files |
| Complete unified | `DESIGN_V2_STAGE=3 npx playwright test --config /tmp/tank-design-qa/playwright.stage3-unified-cycle2.config.ts` | 61 passed, 2 existing photo skips, 0 failed/flaky; 5.0 minutes; all 9 files / 4 projects |

Both full e2e runs used zero retries and no filters. Every serial consumption case ran. The actual-marker creation Undo regression passed with the original four-second presence and fifteen-second absence bounds, exact receipt/operation identity and empty outbox. Full file/project inventories, original report hashes and fixture requirements are in `evidence/stage-3/QA.md` and `screenshot-manifest.json`; final quick logs use `/tmp/tank-design-qa/stage3-*-fullcycle2`.

Screenshots: 438 PNGs, including 373 native 390×844, 64 full-page and one short viewport. All four appearance combinations cover empty/typed/error/soft-warning form, More/advanced tank details, date/station sheets, saved segment/first-full/partial, pump-price change/confirmation, edit and deletion, together with regenerated earlier-stage galleries. Every filename and hash is listed in `evidence/stage-3/screenshot-manifest.json`. All 60 new native form/result states were compared with the prototype. Isolated 4× CPU scroll: p95 and maximum 16.8 ms, zero long tasks, 3068 px; unified started after the sample.

**Open:** no known Stage 3 functional, visual or accessibility blocker. Existing private fixture files remain unavailable; optional WebKit and physical-device coverage were not part of this run. Journal/Insights, Vehicle/licensing/insurance/consent, and secondary screens remain the explicitly scheduled later stages. The last remote write attempt remains blocked by Git credentials / GitHub integration permissions; no PR or deployment was opened.

Final staged whitespace audit found only surplus blank EOF lines in the new `DateSheet.tsx`, `StationSheet.tsx` and the Copy report. Required smoke gates remain green. The accepted source bytes are retained for this commit; the two source-file whitespace cleanups are queued for the Stage 4 cycle. The historical Copy report is retained unchanged with its verified hash.

## Stage 4 — Journal and Insights (accepted)

Stage 3 implementation commit: `cce95f3b2c8697407301c7e0931e0edecf22fca9` (`design-v2: stage 3 — fill-up form and saved screen`). All Stage 3 gates/evidence are accepted. Root handles Journal, immutable entry sheets and shared routing; Insights and CareEditor builders work in parallel; the persistence builder implements bounded exact deletion/restore adapters without changing ordinary offline saves. No Stage 4 acceptance is claimed. QA migration preparation and Copy/RTL preparation are ready; actual review and the full smoke follow implementation.

### Completed scope

Stage 4 is accepted on 2026-11-03. The implementation commit is recorded at the start of Stage 5 to avoid a self-referential commit hash. No Stage 5 code is included in this stage.

- **Journal:** History.tsx, components/journal/EntrySheet.tsx, lib/journal/presentation.ts and journal-design.css provide search, collection/period filters, month totals, category rows, quiet observations, scoped entry sheets and actual edit/delete/Undo. Shared JournalEntryRow, Home links and segment links retain their correct route/record identity.
- **Insights:** Statistics.tsx now composes ConsumptionInsights, PriceInsights, SpendingInsights and CommunityInsights, with shared InsightChart/presentation helpers and insights-design.css. Periods filter closures after canonical all-history calculations; charts retain RTL ordering, actual paid-price ranking, signed spending/refunds, missing amounts and privacy thresholds. Logical point focus is restored without remount timing tricks.
- **Care:** CareEditor, VehicleRecordEditor and care-entry-design.css implement two-step service/expense entry while preserving multi-job invoices, exact editable amounts, drafts, notes and mileage. Atmosphere remains a singleton while moving into the full-height modal. The plan-editor branch remains available for Stage 5.
- **Preservation adapters:** recordUndo, recordUndoPersistence and vehicleRestoreGuard use captured raw images, actual acknowledgements, conditional restoration and the original five-second deadline. DataContext integrates the dedicated initial/retry/reconciliation paths. outboxPresentation, CareConflictDetails and Unsynced show decoded review copies while preserving durable encoded operations. Invalid conflict data cannot authorize overwrite.
- **Legacy fill-up correction:** fillupLifecycle and the bounded FillupForm/DataContext integration preserve captured empty/whitespace notes for lifecycle operations and exact edit Undo. Ordinary authored values still use the unchanged serializer. This is not a claim of arbitrary raw Firestore preservation for normalized fill-up records.
- **Tests:** new design-v2-journal, design-v2-journal-writes and design-v2-insights browser suites, meaningful persistence/presentation tests, additive rules fixtures and migrated existing selectors. No data-preservation test was deleted. Source-readiness waits make fixture setup explicit without relaxing stored-value, focus, size, deadline or conflict assertions.

Protected stats/continuity/tank/pricing/receipt/outbox/serializer/import implementations, firestore.rules and package manifests are unchanged from Stage 3. Shared component APIs remain compatible. No runtime dependency or font asset was added.

### Accepted DEV smoke cycle

| Step | Exact command | Result |
| --- | --- | --- |
| TypeScript | npx tsc -b --noEmit | Exit 0 |
| Lint | npm run lint | Exit 0 |
| Warning budget | npx oxlint --format json | 19 warnings, 0 errors |
| Unit tests | npm test | 948 passed, 12 existing private-fixture skips, 69 files |
| Production build | npm run build | Exit 0; 63 precache entries, 3870.49 KiB |
| Main e2e | E2E_ISOLATED=1 DESIGN_V2_STAGE=4 npm run test:e2e -- --config /tmp/tank-design-qa/playwright.stage4-cycle4.config.ts | 242 passed, 2 expected workbook skips; all 30 files and both Chromium/PWA projects |
| Unified e2e | DESIGN_V2_STAGE=4 npx playwright test --config /tmp/tank-design-qa/playwright.stage4-unified-cycle4.config.ts | 61 passed, 2 expected photo skips; all 9 files and four projects |
| Rules | RULES_FIRESTORE_PORT=18091 npx --no-install firebase emulators:exec --only firestore --project tank-maleh-rules-test --config /tmp/tank-design-qa/firebase.stage4-rules.json 'npx vitest run --config vitest.rules.config.ts' | 222 passed, 7 files, exit 0 |

Both complete browser suites were unfiltered and used zero retries. Main completed and stopped before unified started. There were no failed, flaky or unrun cases in the accepted cycle. The normal rules command encountered occupied port 8080; the equivalent complete isolated emulator run passed. Java 21, Firebase CLI and installed Chromium were available. An earlier sandbox-only Vite/git spawn restriction was resolved by executing the unchanged build with approved permissions.

The complete suite inventory, actual manual-flow automation, exact commands, project counts and skip reasons are in evidence/stage-4/QA.md. Final quick-gate metadata is /tmp/tank-design-qa/stage4-quick-status-preflight10.json.

### Evidence and independent review

- **646 PNG files:** 549 native viewport captures, 96 full-page supplements and one short confirmation. Capture purpose is explicit: sixteen short full-page images also happen to have 390×844 dimensions.
- **Changed-screen matrix:** 68 Journal, 40 Care, 56 Insights and 8 decoded/malformed raw-conflict captures, each light/dark × plate/mint at 390×844. Twelve full-page supplements and the exact edit-Undo toast were also reviewed. Retained foundation/Account/Home/fill-up galleries cover the shared components.
- QA inspected every one of the 172 changed-screen matrix images against the retained prototype references. Copy/RTL, independent accessibility and write-preservation findings are repaired and reviewed. Root directly inspected the corrected native Price charts, Care navigation/focus and truthful edit toast.
- All six actual Price markers retain at least 2px paint clearance in all four appearances. The isolated 4× CPU scroll sample over 40 real rows measured p95/max 16.8ms, zero long tasks and 2,890px scroll; this is browser emulation rather than a physical Android/GPU certification.
- Root independently verified all 470 source/test/asset/config paths, SHA256 hashes, byte sizes and nanosecond mtimes, the exact removed-path set, every PNG hash/dimension/size/freshness, all 187 visual-review references and the review-report hashes.

The screenshot list is evidence/stage-4/screenshot-manifest.json. Supporting reports: QA.md, ROOT-VERIFICATION.json, visual-review.json, COPY-RTL.md, ACCESSIBILITY.md, WRITE-REVIEW.md and DIAGNOSTICS.md.

Final source digest: f90f0d3745499c96a2f9b23cc6230197f752f465d1144980a692faae051e3782.
Original main report SHA256: 249ac473b0a93126705b93c09fb32ee7a63f7af2838b13bf51a410bdf117fdee.
Original unified report SHA256: 468c985b51c9d77978b6a09d2a658ca32ea0f8ec6596713638265cf3eb6b2550.

### Corrections and rejected runs

Acceptance is based on the final complete fourth cycle. Historical diagnostics remain separately labelled. Initial visual/behavior findings included a CSS cascade that obscured Care fields, duplicate headings, chart-point focus remounting and false conflicts on legal empty notes; these were repaired and reproved. The first complete cycle passed functionally but still needed bounded chart-paint, navigation-glyph and truthful-toast-copy fixes.

The second cycle exposed an unexplained Chromium renderer crash plus a fractional measurement during a sheet animation and an ambiguous Statistics text locator. Unchanged-source diagnostics separated those causes. Passive animation completion preserves the literal 44px threshold; exact scoped KPI labels retain real readiness and value checks. The responsive matrix passed standalone and in the final sequential cycle; no unproven crash cause is asserted.

The third main cycle was stopped after a fixture replaced an already cached record and opened its immutable editor before the listener showed the replacement. The application correctly retained the old opening image and displayed its concurrent-change warning. Two visible Home readiness waits, and one equivalent shared Journal completeness wait identified by an independent bounded audit, repaired setup only. Seven exact fill-up and three Journal behavior cases passed, then both entire suites passed again on unchanged inputs.

### Open

No known Stage 4 functional or accessibility blocker remains. The native Care date picker still visibly uses American ordering in this browser, as does the prototype's native input; the visible representation is explicitly scheduled for the Stage 6 cross-screen date pass. Private workbook/photo fixtures and physical-device coverage remain documented limits.

Stage 5 owns Vehicle/licensing/insurance, onboarding, wizard and consent. Stage 6 owns remaining secondary screens and the final copy/dark/accessibility/documentation pass. Remote publication remains blocked by the previously recorded Git credential/integration access failures; implementation continues locally, with no PR or deployment opened.


## Stage 5 — Vehicle, licensing and insurance, entry flows (in progress)

Stage 4 implementation commit: `f2d813d673bce7de9118e308f173dee60f25f399` (`design-v2: stage 4 — journal, insights and care`). Its final full smoke, reviews and evidence are accepted. The Stage 5 provider, Vehicle UI and entry-flow builders are active in parallel; root implements additive document rules, notifications/spotlight and routes. No Stage 5 acceptance is claimed.

### Stage 5 implementation and verification checkpoint (not acceptance)

The Vehicle, licensing/insurance and entry implementation is complete. Acceptance remains withheld until the final full main and unified suites and all rendered reviews pass.

- Vehicle: three permanent document rows, civil-date editor, exact annual insurance metadata, coverage-none clearing, day badges, month/week/expired in-app occurrences and Home spotlight links; current odometer checks, reminder suggestions, issue resolution, explicit vehicle editing and archive/restore management. Annual document costs do not create ledger expenses.
- Persistence: optional raw `Vehicle.docs`, bounded display reader, immutable opening tokens, exact selected-child and parent guards, dotted selected-child writes, same-attempt retry/rebase checks and raw sibling/extension preservation. The only `stats.ts` change is the optional type field. The only protected outbox addition is the optional synchronous reviewed-attempt predicate in `rebase`; existing three-argument behavior and write states remain unchanged.
- Entry: real unchecked sign-in consent, three real-UI onboarding slides, native plate paste/keypad, registry/manual/catalog correction, precise authored fields including explicit null ownership, and retained first-vehicle creation/selection recovery. The shell atmosphere follows the screen actually rendered during first-run setup.
- Scope/lifecycle: acknowledged archive/delete is distinct from a pending selection follow-up; late completions cannot close a newer editor. Vehicle sheets keep native dialog focus/trapping and Escape. A confirmed query-navigation focus override was corrected only for document changes on the same Vehicle page.
- Additive rules: the complete actual emulator run passed **237/237 tests in eight files**, using isolated ports because the default port was occupied. Command: `RULES_FIRESTORE_PORT=18091 npx --no-install firebase emulators:exec --only firestore --project tank-maleh-rules-test --config /tmp/tank-design-qa/firebase.stage5-rules.json 'npx vitest run --config vitest.rules.config.ts'`. Original log: `/tmp/tank-design-qa/stage5-rules-final-write-review.log`. Rules SHA256 `1d4a07d1abefb4be2d7fe5fd44966db5434ae704130433ef01649d339486a108`; document rules-test SHA256 `b74c981a78e616d576b2bc95f2e28a4ca931f2d2af6f929924b5e8669de3f578`. Neither input changed afterward.

Current quick gates on candidate `8eee872c8b8e69b2415d3cf967b662678f9c59bfb6fab1cca7c158f9b9760b87`: `npx tsc -b --noEmit`, `npm run lint`, `npx oxlint --format json`, `npm test`, `npm run build` all exit 0; **17 warnings/0 errors; 1,051 unit passes and 12 existing private-fixture skips across 77 files; 65 precache entries, 3957.55 KiB**. The canonical inventory contains 505 source/test/asset/config paths and compares hashes, sizes, nanosecond mtimes and removals. No source or test changes were allowed during the browser runs.

Focused browser work is not the final smoke cycle. Preflight4 passed 27 cases before an injected journal-handoff failure; one failed and 26 were not run, with no retries or flaky outcomes. Its original report SHA256 is `39107b464eecf7a838da8c48ff98e94d6ab38c7b4a2060e18a453a3d1af0d98f`. The unchanged-source phase diagnostic confirmed that holding `enqueueMany` after its real return artificially withheld same-page ownership registration; reconciliation therefore made the unchanged pending request recoverable. The exact operation ID/version/revision/payload/base remained identical through all five observations. Its original report SHA256 is `3372672c9334fd9c69320fbc87726409e701f46f383540ff062c11eb02b42dea`. The fixture is being corrected to real asynchronous boundaries while preserving independent journal reads and every exact raw-server/newer-draft assertion. No production write change is justified by that artificial hold.

All four entry appearance galleries and four narrow 320px states passed. Independent Copy/RTL directly reviewed 52 current entry captures; accessibility verified the actual control geometry, keyboard consent/error behavior, reduced motion and computed contrast (lowest sampled normal text 6.105:1). Vehicle/deeper-sheet/native-picker/Manager acceptance and the complete unfiltered main-then-unified cycle remain open. Detailed evidence and scoped review limitations are in `design/v2/evidence/stage-5/`.

### Stage 5 full diagnostic cycle 2 and bootstrap correction

The complete diagnostic main run executed all276 cases on frozen507-path source `71a18a26fbb02502ecf329c9289b4d271d78fca3fdc413b927f2a836a8a5896a`:268 passed,6 failed,2 existing private-workbook skips,0 flaky/interrupted/not-run,37.8minutes, actual exit1. Original report SHA256 `2099a2ec55862c92a905468e74214c242876084236136101de494af041e8fc56`. All main/unified ports were closed afterward; root independently matched every original/QA/current path, hash, size, nanosecond mtime and removal set. Unified2 was not launched. This is not stage acceptance.

Five failures are stale presentation assertions: four Manager MiniPlate queries and the Wizard fuel-choice button role. A complete source audit of all56 e2e TypeScript files also identified the decorative hidden-arrow calendar-export name in unified. The bounded migrations retain complete numeric isolation/fixed plate color, fuel names/values and the actual downloaded ICS file, with every data assertion intact.

The sixth failure exposed a real existing profile-bootstrap race before the recovered-spec test fixture was created. The Auth login transaction created the first user document with login stamps only; DataContext's initializer then saw an existing document and never wrote settings/profile fields. Exact browser/commit chronology is retained in `evidence/stage-5/diagnostics/profile-bootstrap-login-only.json`. A narrowly scoped Auth correction adds only absent top-level profile fields from the existing transaction's authoritative read, including same-auth healing without rotating stamps or changing updatedAt. Existing settings maps/nulls, timestamps, unknown fields, ordinary offline initialization, rules and generic outbox writes remain untouched. Seven boundary unit cases pass and independent source review passes; deterministic browser proof and the complete final cycle are still pending.

All32 new Stage5 browser cases passed in the diagnostic run. QA directly inspected96 current native Vehicle/document/conflict states and62 entry states; Copy/RTL and Accessibility independently passed all four corrected Manager/Sheet/Issue appearances. Exact observed hashes and measured target/focus/contrast provenance are retained in the stage evidence reports; they do not substitute for the pending full green cycle.


## TCO add-on — 1.7.1 release candidate (2026-11-04)

The supplied five-file reference patch is preserved in commit `f35cd2c`. The production implementation adds a pure, read-only ownership-cost engine, Home and Spend cards, month/year breakdown, filtered Journal links and the existing guarded document editor. The only persisted schema addition is optional `docs.test.cost`; exact editable/storage values are retained. Annual document costs are amortised and matching insurance/registration Journal expenses are excluded to avoid double counting. Unknown values remain explicit, including incomplete history and refunds.

The Home fuel tile now shows this calendar month's actual fuel cost with the same TCO historical monthly average below it. Card geometry and display font were compared against the runnable prototype at 390px (350 × 217.47px); light/dark, four viewport widths, nested editing/focus, exact Firestore readback and no duplicate expenses pass the five development scenarios.

Community TCO comparison is explicitly unavailable: existing shared summaries contain fuel metrics only. This release does not invent a peer percentage or expand financial sharing. The existing stats, tank estimator, price service, imports and generic outbox implementation are unchanged.

Local gates: TypeScript passes; 1,130 unit tests pass, 12 existing private-fixture tests skip; lint has 18 warnings/0 errors against a budget of 20; all 243 Rules tests pass. The first Rules run exposed a stale forward-field fixture and the 1,000-expression boundary; the fixture was migrated to a genuinely unknown field and one wrapper call was removed without weakening validation. Functions build passes after its locked dependencies were installed (the initial uninstalled build failure is retained in release logs). Production-mode build passes. Full unfiltered Main and Unified/PWA CI, merge CI and clean merged-commit production rebuild/deployment remain mandatory release gates. No 1.7.1 production acceptance is claimed here.


## Optional community TCO extension — 1.7.2 candidate (2026-11-04)

Meni authorized the remaining community comparison and an opt-in ownership-cost aggregate. The new `shareTcoBenchmarks` consent is separate from fuel sharing, off by default and enabled only after a dedicated disclosure. Rules admit only the narrow aggregate; server transactions verify consent and current source metadata, and never queue publication offline. Cost opt-out confirms every owned summary is gone, including archived/orphaned vehicles, without confusing another account with the same ID prefix. A transaction aborts a late withdrawal after a fresh opt-in. Vehicle/archive/account deletion includes cost summaries, while backup restore cannot grant consent.

The sheet uses only recent (90-day) same-model/same-fuel complete summaries, counts four distinct other accounts, excludes own cars and duplicate drivers, and reports a real monthly-cost difference from their mean. It never substitutes fuel economy or a different-model cohort. Loading, unavailable server, incomplete own data and peer shortfall remain distinct. Privacy1.2 and the spec describe the pseudonymous, signed-in-readable aggregate accurately. Existing fuel controls are now explicitly labelled as fuel sharing; their previous semantics and raw readbacks are unchanged.

Local checks: TypeScript and both application/Functions builds pass; 1,147 unit passes/12 existing private-fixture skips, all272 Rules tests pass including a23-vehicle withdrawal and concurrent opt-out/opt-in, lint18 warnings/0 errors (budget20). All12 development flows pass, covering seven new community scenarios plus five existing TCO flows, with actual server readbacks. Light/dark mint comparisons at320/390/820/1440px have no horizontal overflow. Screenshots use isolated emulator data and remain outside source under `/Users/meni/Downloads/Tank-Malle-TCO-Community-20261104`.

Retained diagnostic failures: one unit and one Rules assertion initially used a decimal literal instead of requiring the exact unrounded engine result; both now compare exact original calculation values. The first scope fixture overwrote settings when changing active vehicle, correctly revoking consent; it now uses the real vehicle switcher and verifies consent preservation. The first full Unified run passed62/skipped2/failed1 because its old switch-count assertion expected4; the migrated test checks all5 switches, their exact44px targets and32px tracks, and both fuel/cost labels. The full Unified rerun passed63/skipped2 with zero retries after that migration. A final self-contained global Button replaces the lazy Account CSS dependency for the cost-sheet actions, with a44px target assertion in the Main flow. All final-head PR CI jobs, normal merge, actual merged-commit CI, clean production rebuild and Rules-before-Hosting deployment remain required. No1.7.2 deployment acceptance is claimed at this source checkpoint.


The final privacy review covered cached pre-cost PWAs: Rules preserve a private first-publication marker and require a fresh server-timestamped modern erasure intent for marked accounts. Modern account deletion revokes cost consent and verifies all cost-summary removal before deleting vehicles/profile/auth; old-client attempts and stale retries are refused. Vehicle deletion cannot finish while its cost summary remains. The real emulator reauthentication/deletion flow passes with an orphaned cost row and a preserved foreign peer. All272 Rules tests and1,147 unit tests pass;12development flows pass. Full Unified/PWA is being repeated unfiltered on this final implementation; final PR/merge CI and deployment gates remain pending.

## Input, camera and immediate-data follow-up — 1.7.2 candidate (2026-11-05)

Text-entry fields retain their designed borders without added focus frames. Shared numeric inputs reject word/mixed-word edits and pasted words without rounding editable values; units sit physically left and currency/percent glyphs use smaller text. Manual civil dates mask DDMMYYYY into DD/MM/YYYY, preserve partial/invalid drafts for correction, and keep local calendar days stable.

Vehicle document costs project only guarded pending intent into the display, without changing raw conditional-write captures. Server ACK publishes the acknowledged document before journal retirement so a delayed listener cannot return the view to its old value. Failed/conflicting/foreign intents do not project. Transiently terminated listeners reconnect with bounded backoff and account/attachment guards. Routine local-save notifications are removed; actionable errors, recovery and actual acknowledged success remain truthful.

Live camera has a compact horizontal zoom control using verified native zoom or labelled digital cropping; preview and deterministic recognition receive the same crop. Streams and in-flight captures remain scoped. Physical Android/iPhone camera checks remain NOT_TESTED.

Local integrated checks: TypeScript PASS; 1,204 unit tests PASS / 12 existing private-fixture skips; lint 18 warnings / budget20; app and Functions builds PASS. New browser regressions cover word rejection/unit geometry/no added input frames, date typing/caret/invalid drafts, costs before and after ACK without reload or Listen echo, and zoom preview/scanned pixels/stream cleanup. Full unfiltered Main and Unified/PWA exact-head CI with zero retries, actual merged CI and clean production rebuild remain release gates. No deployment is claimed at this checkpoint.
