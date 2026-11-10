# Stage 0: baseline QA

Branch `feat/design-v3` at `05548ba` + design/v3 docs. Date: 2026-11-10. Machine: macOS (Darwin 25.6), Playwright 1.64.1, Chromium. No product code (`src/`) was changed, and `playwright.config.ts` was not changed either.

## Unit gates (run by the coordinator before this agent started)

`tsc -b` exit 0 · `oxlint` 0 errors · `vitest run` 1,358 passed / 12 skipped. Details are in `design/v3/PROGRESS.md`.

## Ports

Before each e2e run, `lsof -iTCP -sTCP:LISTEN -P` showed nothing listening on 8087, 9097, 5273 or 5274. This agent started and stopped all of those servers itself through the Playwright `webServer` config. No other process was touched.

## 1. Full e2e baseline (main suite)

```
E2E_ISOLATED=1 PLAYWRIGHT_JSON_OUTPUT_NAME=design/v3/evidence/stage-0/e2e-baseline.json \
PATH="/opt/homebrew/opt/openjdk/bin:$PATH" npx playwright test --reporter=list,json
```

- Exit code: **1**, because 2 tests failed.
- Wall time: 29.5 min.
- Results: **301 passed, 2 failed, 2 skipped, 0 flaky**. The projects were `chromium` and `pwa`; `webkit-mobile` is off unless `LOCAL_WEBKIT=1`.
- JSON report: `e2e-baseline.json`.

### Failures that already exist (not caused by v3; no v3 code existed yet)

| # | Test | First error line |
|---|---|---|
| 1 | `[chromium] e2e/mobile-fuel-release.spec.ts:21` "missing specs are filled without Functions, with source labels and preserved user values" | `expect(received).toBe(expected)`: Expected 45, Received null. This is `expect.poll(... getDocument(path)?.tankLiters).toBe(45)` timing out after 15 s at line 28: the vehicle's tank litres were never filled in. |
| 2 | `[chromium] e2e/tank-pricing-followup.spec.ts:86` "RTL price comparison and money cards align their figures to the right" | `Test timeout of 60000ms exceeded`. `locator.boundingBox` was waiting for `getByText('מול המחיר להשוואה בתאריכי התדלוקים', {exact:true}).locator('..').locator('[dir="ltr"]').first()` (line 95). |

### Skipped (by the tests' own conditions)

- `import.spec.ts:239` "the attached legacy workbook imports its 25 rows"
- `import.spec.ts:268` "re-importing the attached workbook adds nothing"

Both need private fixtures, which matches the 12 private-fixture skips in the unit run.

## 2. Screenshot gallery ("before")

The spec is `e2e/design-v3-gallery.spec.ts`, with seeding and console plumbing in `e2e/helpers/design-v3-gallery.ts`. It is **skipped unless `V3_GALLERY=1`**, so it never runs in the normal suite. It is not in `testIgnore`, because the gallery itself runs under `--project=chromium`.

```
E2E_ISOLATED=1 V3_GALLERY=1 PATH="/opt/homebrew/opt/openjdk/bin:$PATH" \
  npx playwright test e2e/design-v3-gallery.spec.ts --project=chromium
```

- Exit code **0**: 6 passed, one test per width and theme, 5.4 min in total.
- **228 PNGs** in `before/`: 38 screens × 3 viewports × 2 themes. **0 capture failures.**
- Options:
  - `V3_GALLERY_OUT=<dir>` sets the output folder (default `design/v3/evidence/stage-0/before`).
  - `V3_GALLERY_WIDTHS=390,430` and `V3_GALLERY_THEMES=dark` select a subset.
- Viewports: 390×844, 430×932, 768×1024.
- Theme is set through the app's own stored preference: `users/{uid}.settings.theme`, patched with an update mask and applied by `DataContext`. Before sign-in, the default "system" theme follows `emulateMedia({colorScheme})`. The run asserts `html[data-theme]` matches the requested theme.
- Seed data: one fuel car, "המשפחתית" (i20 2019, 45 l tank, plate 7248078). It has:
  - 10 fill-ups over 150 days, one of them partial.
  - Regulated price history (₪7.35 this month).
  - A fuel-gauge observation.
  - 2 services.
  - 6 expenses: insurance, test/registration, parking, toll, wash, refund.
  - Mandatory and comprehensive insurance, plus a test due in 22 days.
  - 2 reminders: one manual reminder due in 9 days and one completion-based reminder.
  - 1 issue (watching).
  - 1 planned trip in 3 days (320 km).
- **There is no EV state.** The production vehicle model has no `powertrain`/battery fields yet (DESIGN-V3 §7.4 is a Stage 5 feature). EV screens exist only in the prototype set.
- Screens captured (file name is `<screen>-<width>-<theme>.png`):
  - Signed-out: `onboarding`, `signin`.
  - Home: `home` (full page), `home-viewport`.
  - Journal and insights: `journal`, `insights-cons`, `insights-price`, `insights-spend`, `insights-community`.
  - Vehicle: `vehicle`, `vehicle-costs`, `vehicle-details`, `vehicle-prefs`, `vehicle-edit`, `year`, `vehicles`.
  - Sheets from Home: `sheet-tank`, `sheet-trip`, `sheet-measurement`, `sheet-tco`, `sheet-car-switch`.
  - Fill-up: `fillup-empty`, `fillup-filled`, `fillup-more`, `sheet-station` (geolocation is granted at Kiryat Malachi).
  - Reminders, issues and care forms: `reminder-detail`, `issue-detail`, `sheet-reminder-new`, `sheet-issue-new`, `sheet-service`, `sheet-expense`, `sheet-doc-test`.
  - Other screens: `account`, `notifications`, `unsynced`, `import`, `wizard`, `wizard-manual`.
- Not captured:
  - The post-save screen and the capacity confirmation sheet, because both need a real save.
  - Offline and rejected-write states.
  - Receipt import.

  Add them in a later stage if needed.
- Artefact: in full-page screenshots, the fixed tab bar and the FAB are drawn at the viewport-height position rather than at the bottom. This comes from Playwright's full-page stitching, not from the app.
- I opened these and they show real screens, not blank or loading pages: `home-viewport-390-light`, `sheet-tank-390-light`, `fillup-filled-390-light`, `sheet-issue-new-390-dark`, `insights-spend-768-dark`, `onboarding-430-dark`.

### Console (`before/console.json`, per-run `console-<w>-<theme>.json`)

The gallery listened for console errors, page errors and React key warnings on every route.

**Result: 0 errors and 0 React key warnings across all 228 captures.** The per-route breakdown is under `byRoute` in `console.json`.

## 3. Prototype capture

```
node scripts/v3-proto-capture.mjs        # V3_PROTO_OUT / V3_PROTO_WIDTH / V3_PROTO_HEIGHT optional
```

- Exit code **0**.
- Network works: React 18.3.1, react-dom and htm 3.1.1 load from unpkg, and fonts load from Google Fonts. There were 0 request failures and 0 console errors.
- **130 PNGs** in `prototype/` at 390×844, light and dark.
- How the script navigates:
  - It uses the prototype's own `window.__TM_A` actions (`proto/app.js`), because the map panel is hidden below 760 px.
  - Sheets that need an id (segment, entry, saved, reminder view, issue) get it from the App's state in the React fiber tree.
  - Each shot starts from a fresh Home. A crashed sheet would be recorded as a failure; none crashed.
- Fuel car (v1):
  - Screens: home, journal, insights (cons, price, spend, community), vehicle, fill, fill-scan, fill-receipt, saved, service, expense, vehicle-edit, vehicles, year, account, notifications, import, unsynced, feedback, legal, admin, wizard, onboarding, signin.
  - Sheets: tco, tank, measure, trip, tank-pref, capacity, price, discount, segment, entry, journal-info, odo, station, add-menu, car-switch, accent, doc-test, doc-mandatory, reminder-view, reminder-edit, snooze, issue-view, care-transfer, exclude-info, biz-export, install, share-info, delete-account, restore, receipt, scan.
- EV (v3, BYD Atto 3): ev-home, ev-journal, ev-insights-cons, ev-insights-spend, ev-vehicle, ev-charge, ev-sheet-battery, ev-sheet-tco.
- The `issue` sheet key resolves to `more.js`'s IssueView, which overrides the edit sheet in `sheets.js`. The shot therefore shows the issue edit form.
- A log is in `prototype/capture.json`.

## Things that could not run, or that were limited

- **EV gallery in production:** not possible yet, because there is no EV model (see above).
- **WebKit:** not run. The `webkit-mobile` project needs `LOCAL_WEBKIT=1` and was not requested for Stage 0.

## Files this agent added (test infrastructure only, nothing committed)

- `e2e/design-v3-gallery.spec.ts`
- `e2e/helpers/design-v3-gallery.ts`
- `scripts/v3-proto-capture.mjs`
- `design/v3/evidence/stage-0/{before,prototype,e2e-baseline.json,QA.md}`

`design/v3/HANDOFF.md` shows as modified in `git status`. This agent did not edit it.
