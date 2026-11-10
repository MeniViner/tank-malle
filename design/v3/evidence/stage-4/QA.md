# Stage 4 — forms and sheets: QA

Branch `worktree-agent-a8fb9253ff47e5a98`, cut from `feat/design-v3` @ `ee15a14`. Scope per PROMPT Stage 4 / brief: fill-up form + receipt import + discount sheet, tank sheet / trips / preferences / measurement / capacity confirm, station sheet, service/expense/reminder/odometer/issue editors, snooze presets, journal. Home files (`Home.tsx`, `components/home/*`, `TcoBlock`, `ConsumptionSparkline`, `AppHeader`, `Avatar`, `FactsStrip`) were not edited.

## Gates

| Gate | Result |
|---|---|
| `npx tsc -b` | pass |
| `npm run lint` | exit 0, **0 errors** (pre-existing warnings only, `DataContext.tsx` etc.) |
| `npm test` | **110 files, 1,478 passed, 12 skipped** (private fixtures), 0 failed |

## E2E (private port set)

Local, uncommitted config copy `playwright.stage4.config.ts` + `firebase.e2e-stage4.json`: emulators Firestore 8092 / Auth 9102 / hub 4412 / logging 4512 / websocket 9162, Vite 5292 (PWA 5293 only with `STAGE4_PWA=1`, not used). `lsof` showed all seven ports free before each run; no other port was touched. Java: `PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`.

Run 1 — 27 fill-up / journal / tank / care / home / vehicle specs (`design-v2-fillup*`, `design-v2-journal*`, `tank*`, `design-v2-home`, `consumption`, `datetime`, `dated-fillup-price`, `pricing`, `station-nearby-order`, `audit-fixes`, `reliability`, `design-v2-vehicle*`, `design-v2-foundation`, `mobile-fuel-release`, `input-live-update`, `design-completion`, `outbox-invariants`, `design-v2-entry`, `tco`, `import`, `statistics`, `design-v3-forms`): **218 passed, 5 failed, 2 skipped** (24.5 min).
- 4 × `design-v2-home.spec.ts:478` (all themes): `fieldAccessibility` required no focus shadow on a boxed field — the v3 focus frame. Assertion updated (below); re-run: **14/15 passed**.
- `mobile-fuel-release.spec.ts:21` — **pre-existing** baseline failure (stage-0 QA #1, tank litres never filled; unrelated).
- In the home re-run `design-v2-home.spec.ts:99` (sparkline) failed once and passed on repeat (`--repeat-each=2`: 1 fail, 1 pass); it passed in run 1. Flaky first-test-after-start, Home-owned code untouched by this stage.
- `tank-pricing-followup.spec.ts:86` (stage-0 baseline failure #2) **passed** here.

Run 2 — specs normally run by other configs, on the same private ports (`STAGE4_ALL=1` drops them from the chromium `testIgnore`): `cycle5`, `cycle6`, `scan-maintenance`, `unified-vehicle`, `ui-review`, `open-design`: **50 passed, 3 failed, 2 skipped**.
- `ui-review:72` (period trigger was asserted to sit left of the search box) and `ui-review:97` (focused notes textarea asserted to have no shadow): intentional v3 changes, assertions updated (below).
- `ui-review:116` "every setting uses the same compact switch": expects 5 switches on `/settings`, finds 6. Account is not touched by this stage (last changed in the Stage 5/6 merge, which added an Account switch) — **pre-existing for Stage 4, not fixed** (Account owner).

Run 3 — after the coordinator's contrast fix: `ui-review`, `design-v2-vehicle`, `design-v2-vehicle-writes`, `vehicle-lookup`, `design-v3-forms`: **40 passed, 1 failed** (`ui-review:116`, above).

Gallery: `V3_GALLERY=1 V3_GALLERY_OUT=design/v3/evidence/stage-4/after V3_GALLERY_WIDTHS=390` → 2/2 passed, **84 PNGs** (42 screens × light/dark), 0 capture failures, console logs in `after/console-390-*.json`.

## Test changes

| File | Change | Why |
|---|---|---|
| `e2e/design-v2-fillup.spec.ts` (~l.484) | Tab after the "מצב המיכל אחרי התדלוק" summary now lands on `fillup-save` (was `fillup-import-receipt`); still asserts unobscured; adds a 44px + visible check for the header receipt button by its unchanged accessible name | v3 moved receipt import into the header (prototype). Behaviour (button exists only on new forms, same name/test id, opens the same sheet) unchanged; `cycle5`/`cycle6`/`care-pwa` find it by role name. |
| `e2e/design-v2-home.spec.ts` (l.46) | focus shadow: `none` → `none` **or** the 1px inset ink frame | v3 adds a visible focus frame to boxed controls; placeholder and outline assertions unchanged |
| `e2e/design-v2-vehicle.spec.ts` (l.356–362) | document field border must equal `--line-control` (was `--line`); still 1px, 52px, weight 400 | coordinator contrast fix (1.4.11) |
| `e2e/ui-review.spec.ts` (l.81) | period trigger: was "left of the search box" (inside it); now "below the search box and the first (rightmost) chip of the filter row" | v3 period chip; same options, URL and focus-return assertions kept |
| `e2e/ui-review.spec.ts` (l.97) | focused notes textarea: shadow `none` → 1px inset ink frame | visible focus |
| `e2e/design-v3-forms.spec.ts` (new) | 3 tests: excluded toggle (default on, ⓘ sheet, 44px, `excluded: true` stored with exact agorot, journal row + entry tag, summary line, toggling back removes the field); snooze presets (3 rows ≥44px, week writes today+7 to `snoozeUntilDay`, plan `dueDay` untouched, date field still present); journal period chip first in the row + fade mask + always-on summary info sheet (unknown-count and excluded copy) + focus return + period change | new behaviour |
| `e2e/design-v3-gallery.spec.ts` | 4 extra captures: `sheet-expense-details`, `sheet-exclude-info`, `sheet-journal-info`, `sheet-snooze` | evidence |
| `src/lib/vehicle/snooze.test.ts` (new, 5) | presets, month/year/leap clamping, DST, strictly future, invalid day | new helper |
| `src/lib/measurement.test.ts` (new, 4) | full count via `closesInterval` (v2 unknown end ≠ full), restarts = `breakCount`, copy, empty | new helper |

No behavioural assertion was removed or weakened.

## Checklists

Legend: ✓ = behaviour present and unchanged (look may differ); ✓* = changed presentation, behaviour kept (see note); ＋ = new in this stage; ✗ = not done. Evidence: the e2e named in the stage-0 checklist item, re-run here unless marked "not run".

### fillup.md (63)

- 1–5 ✓ (titles, close/confirm, empty/wrong-vehicle/not-found states — code untouched).
- 6–7 ✓ camera button, scan status.
- 8–13 ✓ date/station chips (hairline chip border only), geolocation auto-pick, generation guard.
- 14–22 ✓ pump display, derivation captions, fuel-type price chain, conflicts, limits, save-attempt errors (no change to `FillupEssentials` logic; EV branch only hides the tank block).
- 23–26 ✓ odometer captions, hard range block, soft warnings.
- 27–28 ✓ end-state segmented and live preview (fuel vehicles); ✓* hidden for EV (§7.4).
- 29–35 ✓ "עוד פרטים", before gauge + ⓘ sheet, after-state, reconciliation, capacity copy/links, provenance; ✓* hidden for EV.
- 36 ✓ reason not choosable, historical reason preserved (not in §6-allowed additions).
- 37–39 ✓ missed fills, note (control border now `--line-control`), stored pump price.
- 40–43 ✓ draft, restored/failed banners, update blocker, changed/deleted elsewhere.
- 44 ✓* receipt import entry moved from a text link under "עוד פרטים" to a header icon button with the same accessible name and test id, still only on new forms.
- 45–50 ✓ receipt sheet (textarea border `--line-control`), credit refusal, review fields, mandatory checkbox, duplicate guard, transfer.
- 51–61 ✓ save/Saved/undo/pump question (Saved screen untouched).
- 62–63 ✓ delete-with-restore, rejected-write correction.

### tank-sheets.md (35)

- 1–2 ✓ session keying, entry mode.
- 3 ✓ intro note.
- 4–5 ✓* forecast rows and assumptions now follow the save button (prototype order: gauge → save → forecast).
- 6–7 ✓ engine warning + "בדיקת המחוון" focus, enrichment status.
- 8 ✓* "עדכון קילומטראז׳" stays a row; "יש לי נסיעה מתוכננת" is now the action of an always-visible "נסיעות מתוכננות" section (`tank-open-trip` test id kept; focus return asserted by `design-v2-home.spec.ts`).
- 9–10 ✓ next-update prompt, "על מה מבוססת ההערכה".
- 11–15 ✓ gauge editor; ✓* reading and litres on one line.
- 16 ✓ odometer sheet.
- 17–19 ✓ trip sheet and list (empty state copy added: "נסיעה ארוכה בדרך? …"); custom date not added (DIFF).
- 20–25 ✓ preferences, reserve 0–100 (production wins), habit, reset.
- 26–27 ✓ capacity confirm (card restyled), server-settled toast.
- 28–30 ✓ measurement sheet (unchanged in Home); ＋ full-fill and restart counts available via `measurementCounts` + `MeasurementSheet` — **not wired** (opener in `components/home/*`, owned by the Home agent).
- 31–33 ✓ segment sheet (untouched, Home-owned file).
- 34–35 ✓ focus return, scope guards.

### station-sheet.md (25)

- 1–25 ✓ structure and logic unchanged; ✓* search control border `--line-control` with focus frame. Prototype tab layout not adopted (DIFF).

### care-forms.md (35)

- 1–6 ✓ two-step shell, titles, draft, storage failure, ACK, busy.
- 7–14 ✓ service (notes textarea / select border `--line-control`).
- 15–16 ✓ expense categories, refund.
- 17 ✓* + ＋ §7.1 toggle "לכלול בעלות הרכב" (default on) with ⓘ explainer; off ⇒ `excluded: true`; restored drafts and edits keep it (`signature` already included `excluded`); conflict review label "לא בעלות הרכב" added to `CareConflictDetails`.
- 18–22 ✓ reminder editor.
- 23–25 ✓ odometer sheet (3,000 km confirm kept).
- 26–30 ✓ adapter validation, sync toasts, conflicts, quarantine.
- 31–35 ✓ issue editor.
- ＋ snooze presets (Notifications sheet), mapping to `snoozeUntilDay`.

### journal.md (42)

- 1–4 ✓ scope remount, heading/add, add sheet, routed entry.
- 5 ✓* period picker is now the first chip of the filter row (shows the chosen label, chevron), accessible name "תקופת היומן" unchanged, selection via `aria-describedby`; same options and URL contract.
- 6–9 ✓ year/from-to/clear/"כל התקופה" label.
- 10–14 ✓ kind chips (row now has the fade mask), legacy kinds, plan, flagged, active-filter strip.
- 15 ✓ search (unchanged, period removed from its field).
- 16–25 ✓ grouping, month totals, rows and states; ＋ "לא בעלות הרכב" tag on excluded expenses.
- 26 ✓* summary moved to the top as a facts row (label + range/count line, leader, mono value); same region name, test ids, label rules ("סך הכול" / "סכום ידוע"), unknown-cost line; ＋ excluded line.
- 27 ✓ exact agorot.
- 28 ✓ 50-row pagination (production wins) and "מוצגות…" line (now in the top summary).
- 29 ✓* coverage button kept; ＋ always-available "על מה הסכום מבוסס?" opening the same sheet, which now also lists the unknown-cost count and the excluded note.
- 30–31 ✓ unsynced banner, empty states.
- 32–38 ✓ entry sheet; ＋ excluded tag.
- 39–40 ✓ delete + undo.
- 41–42 ✓ shell, 44px targets.

## Input border contrast (coordinator request)

Token `--line-control` (`src/index.css`): light `#8A8374`, dark `#837C6F`. Ratios (WCAG relative luminance):

| Theme | vs surface | vs bg | vs surface-2 |
|---|---|---|---|
| light | 3.76:1 (`#FFFFFF`) | 3.52:1 (`#F9F7F2`) | 3.19:1 (`#F0ECE3`) |
| dark | 3.69:1 (`#282520`) | 4.11:1 (`#1E1C18`) | 3.18:1 (`#33302A`) |

Applied to every rule the coordinator listed and the rest found by search: `Field` (`border-line-control`), `vehicle-page-design.css` `:is(.tm-vehicle-edit,.tm-vehicle-document-form) .tm-field-control` (l.91), `.tm-civil-control` (l.68), `.tm-vehicle-issue-form textarea/select`; `vehicle-wizard-design.css` `.vehicle-wizard .tm-field-control` (l.44, error/warning colours now win) and `.wizard-catalog-search`; `care-entry-design.css` `.care-v2-editor .tm-field-control` (l.84, error/warning win) and `.care-entry-notes textarea`; `.journal-search`; `fillup-design.css` notes textarea and station sort select; station search; receipt textarea; `SelectField`; `vehicle-design.css` `.vehicle-form textarea/select`, `.v-filter-line`/`.v-period select`; `secondary-design.css` `.tm-feedback-input`. `--ink-3` was not used because it would read as ink-heavy next to v3 hairline cards; `--line-control` clears 3:1 on all three surfaces. Not changed: the licence-plate input (3px ink, already high contrast) and the pump readouts (instrument on the ink display).
Focus: those wrappers/fields show a 1px inset `--ink` frame on focus (≥ 12:1 light). Pump display and the date/time sheet keep the deliberate no-ring style asserted by `design-v2-fillup.spec.ts`.

## Visual comparison

`after/*-390-{light,dark}.png` vs `../stage-0/prototype/*`, reviewed side by side for fill-up (empty, filled, more), station, tank, trip, service, expense (+ details), journal, reminder, issue, measurement, exclude-info, journal-info, snooze, vehicle prefs. Matches the prototype in structure for the tank sheet (gauge → save → forecast → trips), journal (period chip, top facts summary + link, rows) and fill-up header; every remaining difference is listed with its reason in `DIFF.md`.

## Not done

- Measurement sheet full/restart rows are built (`MeasurementSheet`, `measurementCounts`) but **not wired**: the opener is in `components/home/*` (Home agent). One-line swap at merge.
- Station sheet and reminder/issue editors: restyled through shared tokens/control borders only; the prototype's tabbed station layout and segmented reminder basis were not adopted (production behaviour richer; DIFF).
- Trip custom date, reason picker, issues chip: not in production, not added.
- PWA project and `care-pwa*`/`care-device` specs not run (need their own build/ports).
