# Stage 7: acceptance QA (`feat/design-v3` @ `fbc4bf1`)

I am the QA agent. I made **no product edits** and **no test edits**: no expectation needed changing. Nothing is committed.

**Rig**: `E2E_ISOLATED=1`, with Firestore on 8087, Auth on 9097, Vite on 5273 and the PWA preview on 5274. The rules emulator ran on 8089. Java came from `PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`. Only one rig ran at a time.

## 1. Gates

| Command | Exit | Result |
|---|---|---|
| `npx tsc -b` | 0 | pass |
| `npm run lint` | 0 | **0 errors**, 20 warnings (the existing `DataContext.tsx` set-state-in-effect, `ToastContext` fast-refresh, etc.) |
| `npm test` | 0 | 113 files: **1,526 passed, 12 skipped** (the skips are env-gated private fixtures) |
| `RULES_FIRESTORE_PORT=8089 … firebase emulators:exec --only firestore --project tank-maleh-rules-test --config firebase.rules-isolated.json "npx vitest run --config vitest.rules.config.ts"` | 0 | 11 files: **287 passed** |
| `npx vite build` | 0 | pass; PWA precache has 82 entries |

## 2. E2E

| Run | Exit | Result |
|---|---|---|
| Full main config (`chromium` + `pwa`): `E2E_ISOLATED=1 PLAYWRIGHT_JSON_OUTPUT_NAME=design/v3/evidence/stage-7/e2e.json npx playwright test --reporter=list,json` | 1 | **318 passed, 1 failed, 8 skipped** in 27.8 min. All 3 `pwa` specs passed (`pwa-offline.spec.ts:106/135/196`). |
| Specs that belong to other configs (`cycle5`, `cycle6`, `scan-maintenance`, `unified-vehicle`, `ui-review`, `open-design`). I used a scratch config that imports `playwright.config.ts`, matches only those specs and keeps the isolated emulators and Vite, the same method as stage-4 `QA-merged.md`. JSON: `e2e-others.json` | 0 | **53 passed, 2 skipped**, 0 failed (4.1 min) |
| Gallery: `E2E_ISOLATED=1 V3_GALLERY=1 V3_GALLERY_OUT=design/v3/evidence/stage-7/after npx playwright test e2e/design-v3-gallery.spec.ts --project=chromium` | 0 | **6/6 passed** (390/430/768 × light/dark), **288 PNGs, 0 capture failures, 0 console errors, 0 React key warnings** (`after/console.json`) |

- **The one failure is the known baseline**, `mobile-fuel-release.spec.ts:21` ("missing specs are filled without Functions…"). It has failed the same way since Stage 0, so it is not a regression.
- **Compared with the stage 2+4 merged run** (309 passed / 1 failed), there are 9 more passing tests (the Stage 3/5 specs) and no new failures.
- **Test edits: none.** No `e2e/` or `src/**/__tests__` file is touched (`git status` shows only `design/v3/evidence/stage-7/`).

## 3. Smoke walk (390×844 and 430×932, light and dark)

### Where it ran and what it records

- **Script**: a throwaway Playwright spec, `/private/tmp/claude-501/-Users-meni-dev-personal-projects-tank-malle--claude-worktrees-design-v3-review-97d63e/23831ce9-eefb-41ab-9bec-90d41c13cbff/scratchpad/qa7/smoke.qa7.ts`, outside the repo.
- **Config**: it ran under `playwright.qa7.config.ts` in the same folder, on the isolated emulators and dev Vite.
- **Seed**: the gallery account, plus an EV vehicle (`powertrain: "ev"`, battery 60.48 kWh / 420 km, motor 150 kW, three fills) and an excluded 150 ₪ expense added during the walk.
- **Results**: the JSON is in `smoke-results/smoke-<w>-<theme>.json` and the screenshots are in `smoke/`.
- **Totals**: each width/theme run has 42 steps, with **36 passed and 6 failed**, and the same steps failed in all 4 runs. All 6 failures are EV wording (D2–D4).

### Steps an existing spec already covers

These steps are covered by specs in the full run above and were not repeated: fill-up full/partial/capacity/receipt/draft, saved price answer and both scopes, journal filters/search/pagination, insights tabs, reminder log-service, issue status, account toggles and exports, notifications and import.

| Step | Width/theme | Result | Evidence |
|---|---|---|---|
| Route sweep (20 routes: Home, fill-up, journal, 4 insights tabs, vehicle + 3 tabs, edit, reminder, issue, account, notifications, unsynced, import, vehicles, wizard) | all 4 | pass | `smoke-results/*.json` |
| Excluded expense: the TCO card text is identical before and after adding it | all 4 | pass | |
| Excluded expense: journal tag "לא בעלות הרכב" + `ledger-excluded` 150 | all 4 | pass | `smoke/journal-excluded-*` |
| Excluded expense: Insights spending `insights-excluded-amount` 150 | all 4 | pass | |
| Excluded expense: Vehicle costs `running-excluded` 150 | all 4 | pass | |
| Excluded expense: care costs CSV (Account → גיבוי → גיבוי וייצוא תחזוקה) has a BOM, `excluded_from_tco` column, `yes` on the excluded row and an empty value elsewhere | all 4 | pass | |
| Business statement from Vehicle: whole-shekel total, the excluded group shows 150, the CSV has a BOM, the `נכלל בעלות הרכב` column is `לא` on the excluded row, and the print HTML popup has its h1 and signature lines | all 4 | pass | `smoke/statement-*` |
| Business statement from Account | all 4 | pass | |
| Year screen from the costs year row: URL `/vehicle/years/2026`, `running-total` in whole ₪, link to the year's records | all 4 | pass | `smoke/year-*` |
| Reminder .ics: download `tank-maleh-reminder*.ics`, `BEGIN:VCALENDAR`, `DTSTART` = due day, `SUMMARY:בדיקת בלמים` | all 4 | pass | |
| Account restore preview: shows "1 רשומות חדשות", Escape closes it, and nothing is written to the server | all 4 | pass | `smoke/restore-preview-*` |
| Account delete, two-step cancel: step 1 → "המשך למחיקה" → step 2 "אישור אחרון" → ביטול. Focus returns to `account-delete`, and the user doc and both vehicles remain | all 4 | pass | `smoke/delete-step2-*` |
| Wizard manual catalogue: search טויוטה → model → year, which fills make/model/year | all 4 | pass | `smoke/wizard-catalogue-*` |
| Wizard EV plate `52839102` (stubbed registry): make BYD, הנעה "חשמלי", motor "150 kW", no "סוג דלק" | all 4 | pass | `smoke/wizard-ev-plate-*` |
| Switch to the EV with the car switcher (persisted on the server) | all 4 | pass | |
| EV Home: `home-energy-100` shown, no `home-fuel-price`, no `tank-hero` | all 4 | pass | |
| EV Home: no fuel/tank wording | all 4 | **fail (D2)**: "17.7 ק״מ לליטר", recent rows "31.0 ל׳ · מלא", TCO legend "דלק" | `smoke/ev-home-*` |
| EV fill form: `data-powertrain="ev"`, no "מילאתי עד הסוף" | all 4 | pass | |
| EV fill form: no litre wording | all 4 | **fail (expected; J)**: "ליטרים", "מחיר לליטר". Production has no charge model (stage-4 DIFF "EV", EV-AUDIT.md) | `smoke/ev-fillup-*` |
| EV Insights consumption / price / spending: no fuel wording | all 4 | **fail (D2)**: "אתה נוסע 18.3 ק״מ לליטר", "1.90 ₪ לליטר", "93.0 ל׳", "רכישות דלק", "ליטרים שנרכשו" | `smoke/ev-insights-*` |
| EV Vehicle hub / details / edit | all 4 | **fail (D3)**: the hub row "הגדרות הרכב · העדפות מיכל ורכבים נוספים". The edit note "אין מיכל דלק, נפח מנוע…" is intended text. Details: clean | `smoke/ev-vehicle-*`, `smoke/ev-vehicle-edit-*` |
| Switch back to the fuel car | all 4 | pass | |
| Offline: `context.setOffline(true)`, then a fill-up from the FAB (Saved shows `data-write-state=pending`), then the journal tab and a parking expense of 23.4. Both rows show "ממתין לאישור" and the server has no new fill. Back online: the outbox drains to 0, the server gets +1 fill and +1 expense (`costAgorot 2340` exactly), and no pending rows remain | all 4 | pass | `smoke/offline-pending-*`, `smoke/offline-confirmed-*` |

**Console**: **0 errors and 0 React key warnings** on every route in all 4 runs. The only entries were 11–12 `net::ERR_INTERNET_DISCONNECTED` per run, logged inside the offline step while the context was offline. That is the browser reporting the forced offline state, so I did not count them as app errors. The gallery's console log (288 shots, 3 widths) was also 0 / 0.

## 4. Accessibility spot-check (390, light and dark)

- **Probe**: `/private/tmp/claude-501/-Users-meni-dev-personal-projects-tank-malle--claude-worktrees-design-v3-review-97d63e/23831ce9-eefb-41ab-9bec-90d41c13cbff/scratchpad/qa7/a11y.qa7.ts`. Raw output: `smoke-results/a11y-{light,dark}.json`.
- **Contrast**: every visible, non-hidden text node is checked. Colours are normalised through a canvas, alpha is composited over the ancestor backgrounds, and the threshold is 4.5:1 (3:1 for large text). Disabled controls are exempt.
- **Targets**: every visible interactive element is checked against 44 px; a label wrapper counts toward the target size.
- **Names**: every control must have an accessible name containing Hebrew.
- **Focus**: I pressed Tab 24–25 times per route and checked that the focused element shows an outline, box-shadow or pseudo-element ring.

| Route | Text nodes | <4.5:1 (L / D) | Controls | <44 px | Unnamed | Non-Hebrew name | Focus without ring |
|---|---|---|---|---|---|---|---|
| Home | 140 | 0 / 0 | 29 | 0 | 0 | 0 | 1* |
| Insights cons | 131 | 0 / 0 | 32 | 0 | 0 | 0 | 0 |
| Insights price | 175 | 0 / 0 | 27 | 0 | 11† | 0 | 0 |
| Insights spend | 183 | 0 / 0 | 21 | 0 | 1† | 0 | 1* |
| Insights community | 27 | 0 / 0 | 13 | 0 | 0 | 0 | 0 |
| Vehicle | 92 | 0 / 0 | 26 | 0 | 0 | 0 | 0 |
| Vehicle costs | 55 | 0 / 0 | 13 | 0 | 0 | 0 | 0 |
| Vehicle details | 28 | 0 / 0 | 12 | 0 | 0 | 0 | 0 |
| Account | 51 | 0 / 0 | 28 | 0 | 0 | 0 | 0 |
| Fill-up | 29 | 0 / 0 | 13 | 0 | 0 | 0 | 4 inputs‡ |

- \* `button[data-testid=tco-period]` has `outline:none`. The ring is drawn on its child span (`tco-design.css:10`, `.tm-tco-per:focus-visible>span{outline:2px solid var(--ink)}`), so this is a false positive.
- † On Insights price, the 10 date links in the collapsed table (`a.insights-table-action`) are named by their date text; the probe reads `innerText`, which is empty inside the closed disclosure. The 11th entry there, and the one on spending, is `svg.recharts-surface`, which Recharts makes focusable without a name. Minor; see D8.
- ‡ The fill-up pump inputs (sum, litres, price, odometer) are the ink instrument and deliberately have no ring; the caret carries focus. This is asserted in `design-v2-fillup.spec.ts` and justified in stage-4 DIFF "Accessibility notes".
- Hebrew labels: no control on these routes has an empty name or a name without Hebrew.

## 5. Defects (ranked)

| # | Sev | Where (selector) | What | Screenshot | Owner |
|---|---|---|---|---|---|
| D1 | med (pre-existing in v2 `05548ba`) | `.tm-vehicle-heading h1`, `[data-testid^=car-switch-]` sub-line, and anywhere `NumericText` wraps a make/model | Model names that mix Latin letters and digits render out of order in RTL: "i20" shows as "20i" and "BYD ATTO 3" as "3 BYD ATTO". `NumericText` isolates each digit run in a `NumRun`, so the run is pushed to the far end. The prototype shows "i20 Inspire". | `after/vehicle-390-light.png`, `after/sheet-car-switch-390-light.png`, `smoke/ev-vehicle-390-light.png` | Stage 1 owner (`src/components/Fmt.tsx`) / Vehicle |
| D2 | med | EV: `[data-testid=consumption-summary]`, `[data-testid=tco-legend]`, the recent-row meta; Insights `main` on cons/price/spend | For an EV, Home and Insights still use fuel copy: "ק״מ לליטר", "₪ לליטר", "ל׳", "רכישות דלק", "ליטרים שנרכשו", and the TCO part "דלק", while the Home facts say "חשמל". The brief (5d) names "insights copy" as one of the places that must show no tank/engine fields, and stage-4 DIFF lists insights copy as "not EV-gated here". There is no charge model (EV-AUDIT), so this needs either neutral copy (for example "יחידות", "אנרגיה") or a recorded product decision. | `smoke/ev-home-*`, `smoke/ev-insights-{cons,price,spend}-*` | New-features agent (5d) + Insights |
| D3 | low | EV: the Vehicle hub row "הגדרות הרכב" (sub-line "העדפות מיכל ורכבים נוספים") | The tank-preferences entry and copy are offered for an EV, which has no tank. | `smoke/ev-vehicle-390-light.png` | Vehicle / 5d |
| D4 | low (by design today) | EV `[data-testid=fillup-form]` | The EV fill form keeps litres and price per litre. This is intentional (stage-4 "EV"), but it conflicts with the prototype's "טענתי"/kWh. It needs a decision before the brief's "fill(charge)" can pass. | `smoke/ev-fillup-*` | Product / 5d |
| D5 | info | Year screen `/vehicle/years/2026` | "הכול לק״מ" and "רכישות דלק לק״מ" show "—" even though the year has about 4,000 km of fills. The before image is the same, so this is not a regression; it may be the per-km covered-interval rule. Worth a look. | `after/year-390-light.png` | Vehicle |
| D6 | low | Insights consumption and price charts | The charts are still v2 curved splines with a side y-axis; the prototype has a straight polyline, a dashed average and no axis. No stage DIFF justifies this. | `after/insights-cons-390-light.png` | Insights (Stage 3) |
| D7 | low | `/vehicle/edit/:id` fuel segmented control | There is no "חשמלי" choice for an existing fuel car (the prototype has one), so a manual switch to EV is only possible through the registry refresh. This is not listed in a stage DIFF. | `after/vehicle-edit-390-light.png` | 5d |
| D8 | low | Insights price/spending `svg.recharts-surface` | The chart is focusable without an accessible name. | | Insights |

No blocker. D1 is the most visible, because it appears on the default seeded car. D2–D4 are the open EV-copy decision.

## 6. Not run, or only partly run

- **WebKit / iPhone project** (`LOCAL_WEBKIT=1`): not run. It is not in the brief's command list.
- **Smoke steps compared visually against `prototype/ev-*`**: not done, because the gallery has no EV capture. The EV screens were checked only by the wording probe and by eye on `smoke/ev-*`.
- **Gallery coverage**: the gallery does not seed an EV, an excluded expense or a community pool. The community tab shows only the waiting state, so community layout was not compared.
- **768 px**: captured by the gallery (`after/*-768-*`) but not reviewed screen by screen. The brief asks for 390.
- **Real device, camera and the OCR scanV2 path**: not exercised. They are covered only by the Stage 6 unit tests and `scan-maintenance`, which passed.
- **PROGRESS/HANDOFF update and the PR**: not done; that is the coordinator's job, and the brief said not to commit.
