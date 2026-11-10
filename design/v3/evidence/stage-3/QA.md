# Stage 3 · Facts strip everywhere, Insights, Vehicle, Account — QA

Scope: DESIGN-V3 §3 (facts strip on Insights, Vehicle, year screen, Account, statement), §6 parity for
Insights/Vehicle/Account, §7.1 excluded line, §7.2 business statement UI, §7.4 EV display on Vehicle.
Branch: worktree branch on top of `feat/design-v3` @ `cd6b156` (Stage 2 merge). Prototype differences:
`DIFF.md`. Screenshots: `after/` (390, light + dark).

## What changed

| Area | Change | Files |
|---|---|---|
| FactsStrip (shared, extended — not forked) | New optional props: `valueTestId` (test id on `.fv`), `data` (`data-*` on the row), `variant="minor"` (13px label / 16px value breakdown rows), `valueKind="text"` (words in the body face, no LTR numeric island). CSS for the new variants | `FactsStrip.tsx`, `FactsStrip.test.ts` (+1), `design-primitives.css` |
| Insights · צריכה | KPI grid → facts: המקטע הטוב / החלש (buttons → segment sheet, `data-segment-end-id`, Hebrew aria name), מרחק שנמדד, דלק במקטעים. Chart, segments table, manufacturer line, open segment, basis ⓘ with restarts unchanged | `ConsumptionInsights.tsx` |
| Insights · מחירים | New facts strip: התדלוק היקר ביותר לליטר / הכי זול ששילמתם לליטר (2 decimals, open the fill-up), ליטרים עם סכום ידוע. Pure `priceExtremes(points)` (known amounts of the vehicle's fuel only, earlier fill wins ties) | `PriceInsights.tsx`, `presentation.ts`, `presentation.test.ts` (+1) |
| Insights · הוצאות | Averages (monthly/weekly/YTD, fuel purchases, history-gated exactly as before), litres purchased and the two ownership per-km figures move from collapsed KPI tiles to a top-level facts strip; caveat note kept visible; measured-fuel per-km card kept. "לא בעלות הרכב" muted row (count + amount, → journal expenses) when `spendingSummary.excludedCount > 0`. Grouped chart + odometer stay in the lazy fuel detail | `SpendingInsights.tsx` |
| Insights · השוואה | Own / group / best pair → facts (with peer count and cohort basis subs); price comparison → facts | `CommunityInsights.tsx` |
| Vehicle · כמה עלה | `RunningCosts` is a facts strip: total (period, count, coverage), דלק/חשמל · טיפולים · הוצאות נוספות · החזרים as minor rows, הכול לק״מ / רכישות דלק לק״מ (אג׳ לק״מ), "לא בעלות הרכב" line outside the total; heading "כמה עלה" (region name "עלויות הרכב" kept) | `RunningCosts.tsx`, `RunningCosts.test.ts` (+1) |
| Vehicle · by year | Year rows: year · category bar (aria-label kept) · total · chevron, sub-line kept, → `/vehicle/years/<y>` | `Maintenance.tsx`, `vehicle-page-design.css` |
| Year screen | Same facts strip (`RunningCosts ev`) | `VehicleDetails.tsx` |
| Vehicle · details | Definition list → facts (text values for words). Non-EV: fuel type, tank with "הערכה לפי סוג הרכב"/"מאושר", declared consumption. EV (`isEv`): הנעה חשמלי, סוללה kWh, טווח WLTP, הספק מנוע kW — no fuel/tank/declared rows | `Maintenance.tsx` |
| Vehicle · overview | EV meta "חשמלי · סוללה N kWh · טווח N ק״מ · N kW" (no "מיכל") | `VehicleOverview.tsx` |
| Business statement (§7.2) | New sheet: month chips (`statementMonths`, follows the newest month until picked), facts (total, km in month with basis dates, groups, business share, excluded group outside the total), collapsible grouped rows, business name / driver / usage % (validated with `bizPatch`, saved via `updateVehicle(id,{biz})`, also on export), "PDF להדפסה" opens `statementHtml` in a new window (download fallback when blocked), "CSV ל-Excel" downloads `statementCsv` (BOM). Entry points: Account → הנתונים שלי "דוח חודשי לעסק", Vehicle hub links + details tab | `components/business/BusinessStatementSheet.tsx`, `statementView.ts` (+test), `business-design.css`, `AccountData.tsx`, `Maintenance.tsx` |
| Account | Identity sheet rows and "הפעילות שלי" metrics → facts strips (text values for provider/dates); muted "לא בעלות הרכב" row when any expense is excluded (`accountTotals` now also sums `excludedAgorot/excludedCount`; totals unchanged) | `AccountIdentity.tsx`, `lib/accountExport.ts` |
| Import / Notifications / Unsynced | CSS only: import counts as a receipt list (DOM unchanged), notifications count badge on `--r-sm` | `secondary-design.css`, `notification-design.css` |
| Gallery | + `sheet-account-identity`, `sheet-statement` shots | `e2e/design-v3-gallery.spec.ts` |

The OCR toggle (`ScanV2Toggle`) did not move: Account was not restructured, it stays right after "כפתור תדלקתי פותח מצלמה".
Money: every new amount goes through `vehicleMoney` / `shekel` / `price` / `int` / `num`; no local currency formatting.

## Checklists

K = kept (same behaviour/copy), C = changed intentionally (v3), N = new. "e2e s3" = `e2e/design-v3-stage3.spec.ts`,
"e2e st" = `e2e/design-v3-statement.spec.ts`.

### insights.md (47)

| # | Status | Verified by |
|---|---|---|
| 1–10 shell, period, tabs, readiness, skeletons, charts | K (no change) | design-v2-insights, statistics |
| 11 headline | K | design-v2-insights ("11.9", "13.3", "7.5") |
| 12 line chart, 44px points, focus return | K | design-v2-insights |
| 13 legend | K | — (unchanged markup) |
| 14 manufacturer reference | K | unchanged code |
| 15 segments table | K | design-v2-insights (row → sheet → focus) |
| 16 KPIs best/worst/km/litres | C → facts strip, same testids, values and button behaviour; aria name "המקטע הטוב, <v> קמ״ל, עד <d>, פתיחת פרטים" | design-v2-insights (testids, `data-segment-end-id`, best → sheet → Escape → focus), statistics, e2e s3 (44px, focus ring, receipt order, contrast) |
| 17 segment sheet | K | design-v2-insights |
| 18 empty states | K | presentation.test |
| 19 open segment | K | design-v2-insights (`insights-open-segment` hidden when history unavailable) |
| 20 basis + restarts | K | statistics (continuity break) |
| 21–29 price tab (other fuel, average, chart, labels, difference, table, basis, station ranking, spread) | K | design-v2-insights, presentation.test |
| 30 "עוד על המחירים" (most expensive total) | K | unchanged |
| + price extremes per litre (allowed addition) | N | presentation.test (priceExtremes), e2e s3 (2 decimals, rows open the fill-up, 44px) |
| 31 TCO card | K | tco, cost-community |
| 32 net total + coverage | K | design-v2-insights ("1,567 ₪", coverage) |
| 33 monthly stacked chart, integer ticks, §4 colours | K | presentation.test, design-v2-insights |
| 34 by-month table | K | design-v2-insights (exact cells) |
| 35 journal link when empty | K | presentation.test |
| 36 fuel cost per km card | K | design-v2-insights ("62 אג׳", "—", display number) |
| 37 journal links | K | design-v2-insights (expense link → journal) |
| 38 ownership per-km + caveats | C: moved from a `<details>` to the spending facts strip + visible note; same values/caveat copy | e2e s3 (format), statistics |
| 39 averages / litres / grouped chart / odometer | C: averages + litres moved to the facts strip (same gating: "—" unless history ready and complete); grouped chart, tables, odometer and restart note stay in the lazy detail | statistics (weekly/monthly/YTD `^[\d,]+ ₪$`, grouping), design-v2-insights ("—" for malformed/denied/cached history), ui-review (odometer chart) |
| + excluded expenses line | N | e2e s3 is not seeding one on Insights; covered by `spendingSummary` unit tests (Stage 5) and the vehicle/statement e2e; visual in DIFF #8 |
| 40–47 community | K (pairs → facts) | design-v2-insights (states, percentile, opt-out), statistics (insufficient/enough peers), cost-community |

### vehicle.md (61)

| # | Status | Verified by |
|---|---|---|
| 1–5 hub empty/header/coverage/errors | K | unchanged |
| 6 overview meta, tank estimate | K (non-EV); C for EV (battery/range/motor, no tank) | design-v2-vehicle, e2e s3 (EV) |
| 7–8 odometer | K | design-v2-vehicle |
| 9–16 documents | K | design-v2-vehicle, design-v2-vehicle-writes |
| 17–22 reminders, paused group, info | K | scan-maintenance, open-design, design-v2-foundation |
| 23–31 reminder detail (.ics, log-service, delete) | K | unified-vehicle, scan-maintenance, open-design |
| 32–37 issues, resolved group, issue detail | K | design-v2-vehicle, unified-vehicle |
| 38 YTD link | K | unified-vehicle, open-design |
| 39 links block | K + N "דוח חודשי לעסק" row | open-design, e2e st |
| 40 add bar | K | scan-maintenance |
| 41 period picker | K | unified-vehicle |
| 42 RunningCosts | C → facts (heading "כמה עלה"; region "עלויות הרכב"; same copy for coverage/missing costs; "לרשומות ←") | RunningCosts.test, unified-vehicle (region/`running-total`/link), cycle5, scan-maintenance, open-design, design-completion |
| 43 per-km pair | C → facts rows, same `running-cost-per-km` / `running-fuel-per-km`, "אג׳ לק״מ" | RunningCosts.test |
| 44 disclosure | K (+ one sentence about excluded expenses when present) | RunningCosts.test |
| + excluded line | N | RunningCosts.test, e2e s3 ("99 ₪", outside the 560 ₪ total) |
| 45 by-year rows | C layout; aria-label, sub-line and link name kept | open-design (`/2025.*100/`), unified-vehicle, e2e s3 |
| 46 year screen | K (facts via RunningCosts) | open-design, unified-vehicle, e2e s3 |
| 47 details definition list | C → facts; copy kept ("לא תועדה", "לא ידוע", "לא תועד"); plate now formatted; EV rows | e2e s3 |
| 48 details links | K + statement row | — |
| 49 prefs tab | K | design-v2-shell, ui-review |
| 50–58 vehicle edit / manager | K (not touched) | design-v2-vehicle, vehicle-archive (not run) |
| 59–61 care backup (Account) | K | scan-maintenance |
| business statement (§7.2) | N | e2e st, statementView.test, Stage 5 statement.test |

### account.md (57)

| # | Status | Verified by |
|---|---|---|
| 1–5 structure, deletion pending, scope, admin | K | design-v2-shell, audit-fixes |
| 6 identity button | K | design-integration |
| 7–9 identity sheet rows | C → facts strip with text values; same copy and branches ("—", "טוענים…", "זו ההתחברות הראשונה", "נכנס לאחרונה …", admin-only "הרשאות") | design-v2-shell ("זו ההתחברות הראשונה"), auth-isolation (not run), e2e s3 |
| 10–13 activity metrics | C → facts strip; same values/subs | design-integration ("272 ליטר בסך הכול"), design-v2-shell ("80 ליטר…"), design-v2-account-restore ("25 ₪"), unified-vehicle ("590 ₪" exact), audit-fixes F08/F17 |
| + excluded row | N | unit (accountTotals sums only; totals unchanged) |
| 14–16 data source, freshness, refresh | K | audit-fixes F17 |
| 17–20 fuel & price | K | home-profile-update |
| 21–25 display, quick-entry, OCR toggle position | K | design-integration, design-v2-foundation, design-v2-shell |
| 26–28 notifications | K | design-v2-shell |
| 29–33 sharing | K | cost-community, audit-fixes F03 |
| 34 My data rows | K + N "דוח חודשי לעסק" (active vehicle only) | design-v2-shell, e2e st |
| 35–46 unsynced row, exports, backup, restore | K | design-v2-shell, audit-fixes, design-v2-account-restore, unified-vehicle |
| 47–57 more, share, install, version, sign-out, delete | K | design-v2-shell, audit-fixes |

### notifications.md (27), unsynced.md (23), import.md (41)

All K. No TSX change on these screens. CSS only: import count rows restyled as a receipt list (DOM order and
text unchanged, so `getByText("כבר קיימות").locator("..")` still holds the count); notifications count badge
radius → `--r-sm`. Verified by import.spec, audit-fixes, outbox-invariants, reliability, design-v2-shell,
design-v2-foundation and the gallery shots.

## Accessibility

- 44px: facts button rows are ≥58px (minor rows 44px); statement month chips, actions and fields ≥44px; year rows ≥60px — asserted in e2e s3 / e2e st.
- Focus: `.facts > button.fact:focus-visible` ring (shared), year rows, statement chips/summaries.
- Hebrew labels: every strip has a group label ("מדדי הצריכה בתקופה", "קצוות המחיר בתקופה", "ממוצעים ועלות לק״מ", "כמה עלה בתקופה", "פרטי הרכב", "פרטי החשבון", "הפעילות שלי בכל הרכבים", "סיכום <חודש>"); button rows have Hebrew aria names; statement months group "חודש הדוח".
- Reduced motion: no new animation (shared `:active` opacity is disabled under reduced motion).
- Contrast ≥ 4.5:1: e2e s3 runs the WCAG walker (`e2e/helpers/contrast.ts`, moved out of design-v3-home unchanged) over the consumption/price/spend strips, the vehicle costs + year rows and the account sheet, light and dark.

## Test changes (markup intentionally changed; behaviour assertions kept)

| File | Change | Behaviour kept |
|---|---|---|
| `e2e/design-v2-insights.spec.ts` (3 places) | YTD "—" read from `insights-spend-ytd` (facts) instead of `.insights-kpi strong` inside the fuel detail | history-gated YTD stays unknown for malformed, denied and cached history |
| `e2e/statistics.spec.ts` (2 tests) | weekly/monthly/YTD labels and `^[\d,]+\s₪$` values read from the spending facts strip instead of the fuel detail's KPI tiles | averages reported regardless of range, whole shekels |
| `e2e/ui-review.spec.ts` | `.insights-kpi strong` text-align check → every spending facts row has its value at the inline end of its label | value alignment |
| `e2e/ui-review.spec.ts` ("every setting uses the same compact accessible switch") | switch count 5 → 6 — **pre-existing failure on `feat/design-v3`**: Stage 6 added the scan v2 A/B switch "זיהוי ספרות משופר (ניסיוני)" and did not run this spec | every switch is still measured 52×44 / track 52×32 |
| `e2e/design-v3-home.spec.ts` | `lowContrast` moved to `e2e/helpers/contrast.ts` (identical body) | same assertions |
| `src/components/FactsStrip.test.ts` | +1 case for the new props | existing cases untouched |
| `src/components/RunningCosts.test.ts` | +1 excluded-line case; existing `value()` regex still matches (`data-testid` now on `.fv`) | all existing expectations |
| new | `e2e/design-v3-stage3.spec.ts` (4), `e2e/design-v3-statement.spec.ts` (2), `statementView.test.ts` (7), `presentation.test.ts` (+1) | — |

## Gates and runs

| Gate | Result |
|---|---|
| `npx tsc -b` | pass |
| `npm run lint` | 0 errors (20 warnings, all in files this stage did not touch) |
| `npm test` | 111 files, 1503 passed, 12 skipped (after Stage 2: 110 / 1493) |

Playwright, private rig (emulators 8094/9104, hub 4414, logging 4514, ws 9164, vite 5294; untracked
`playwright.stage3-private.config.ts` + `firebase.stage3-private.json`, Chromium; the unified specs at 390×844):

| Run | Result |
|---|---|
| design-v2-insights, statistics, tco, cost-community, design-v2-vehicle, design-v2-vehicle-writes, import, design-v2-shell, design-integration, home-profile-update, design-v2-account-restore, audit-fixes, unified-vehicle, ui-review, open-design, scan-maintenance, cycle5, design-v3-statement, design-v2-foundation, reliability, outbox-invariants, design-completion | 174 passed, 3 skipped (opt-in), 1 failed: ui-review switch count (pre-existing, see test changes) |
| re-run: design-v3-stage3, ui-review (after the count update), design-v3-home, import | all passed |
| final: design-v3-stage3 (4), design-v3-statement (2), open-design, unified-vehicle, cycle5, gallery 390 light+dark | 36 passed |
| Gallery `V3_GALLERY=1 V3_GALLERY_OUT=design/v3/evidence/stage-3/after V3_GALLERY_WIDTHS=390 V3_GALLERY_SCREENS=insights-cons,insights-price,insights-spend,insights-community,vehicle,vehicle-costs,vehicle-details,year,account,sheet-account-identity,sheet-statement,notifications,unsynced,import` | 28 shots, console errors 0, React key warnings 0, capture failures 0 (`after/console.json`) |

Not run: the PWA project, 430/768 widths, auth-isolation, vehicle-archive, the rules suite (no rules change in
this stage). Full-page gallery shots show the fixed tab bar over mid-page content (capture artifact, same as Stage 2).
