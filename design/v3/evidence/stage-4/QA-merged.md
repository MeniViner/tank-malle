# Stages 2 + 4, merged on `feat/design-v3` @ 9d79521: QA

QA agent. I made no product edits and no test edits. Rig: `E2E_ISOLATED=1` (Firestore 8087, Auth 9097, hub 4407, logging 4507, ws 9157, Vite 5273). Every port was free before each run, and the other agents' ports (8094/9104/5294, 8096/9106/5296) were not touched. Java: `PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`.

## Gates

| Gate | Result |
|---|---|
| `npx tsc -b` | pass (exit 0) |
| `npm run lint` | exit 0, **0 errors**; warnings are the pre-existing ones (`DataContext.tsx` etc.) |
| `npm test` | **1,502 passed, 12 skipped** (private fixtures), 0 failed |

## E2E

| Run | Result |
|---|---|
| Full main config (`chromium` + `pwa`), JSON at `../stage-2/e2e-merged.json` | **309 passed, 1 failed, 8 skipped**, 0 flaky (28.0 min, 318 tests) |
| Specs normally run under other configs: `cycle5`, `cycle6`, `scan-maintenance`, `unified-vehicle`, `ui-review`, `open-design`. Run via a scratch config that imports `playwright.config.ts`, clears `testIgnore` and keeps the same isolated web servers; not committed | **53 passed, 0 failed, 2 skipped** (4.6 min) |

- The one failure is `mobile-fuel-release.spec.ts:21` (`tankLiters` never filled, expected 45). This is the **pre-existing** baseline failure from Stage 0 and Stage 1. Not a regression.
- `ui-review.spec.ts:116` (switch count), which was open in Stage 4, now **passes**: the merge counts the scanV2 switch.
- Stage 2's "`rtl` signed numbers" item passes in the full run.
- Compared with the Stage 1 full cycle (302 passed, 1 pre-existing failure), there are no new failures.

### Test edits

None. No expectation needed changing after the merge.

## Gallery (after-merged)

Command: `V3_GALLERY=1 V3_GALLERY_OUT=design/v3/evidence/stage-4/after-merged V3_GALLERY_WIDTHS=390,430`, light and dark.

- **4/4 passed, 168 PNGs, 0 capture failures**.
- `console.json`: **0 React key warnings, 1 error**: `insights-cons` at 430 dark, a bare "Failed to load resource: 400 (Bad Request)" with no URL logged.
- I re-ran 430 dark into scratch and got **0 errors, 0 key warnings** (42 shots). It looks like the same transient emulator race Stage 1 recorded (bare 400/409, one-off). It is on an Insights route, outside Stage 2 and Stage 4. It is recorded as an open item, **not** as "zero errors". The gallery still does not log the request URL.

## Offline step (smoke cycle #4)

How it was run:
1. Ran a scratch spec at 390 with `context.setOffline(true)`.
2. Added a fill-up from the FAB. The Saved screen showed `data-write-state="pending"`. Pressed "Done".
3. Moved to the journal through the tab bar (no reload).
4. Added a parking expense of 23.4 ₪.

Results:
- **Pending**: both journal rows showed "ממתין לאישור" (`[data-collection=fillups]` 1, `[data-collection=vehicleExpenses]` 1). The server still had 1 fill-up and 0 expenses. Screenshot: `after-merged/offline-journal-pending-390-light.png`.
- **Back online**: the outbox drained to 0, and no row in the journal still showed a pending state. The server had 2 fill-ups and 1 expense, with `costAgorot: 2340` stored exactly. Screenshot: `after-merged/offline-journal-confirmed-390-light.png`. Summary: `after-merged/offline.json`.

**Pass.**

## Input border contrast (computed, WCAG 1.4.11)

Raw data: `after-merged/contrast-{light,dark}.json`. Scope: fill-up form (more details open), station sheet, journal search, expense form. For each control I took the first bordered ancestor and measured its border against the nearest opaque background.

| Theme | Controls | Border | Lowest ratio |
|---|---|---|---|
| light | notes, station search, station sort, journal search, care cost, care day, care title, care notes | `#8A8374` | **3.52:1** on `#F9F7F2` |
| dark | same | `#837C6F` | **4.11:1** on `#1E1C18` |

Every boxed control is ≥ 3:1. The only rows below 3:1 are the pump-display row dividers (`.tm-pump-row`: 1.42 light, 1.33 dark). These are separators inside the ink instrument, which Stage 4 DIFF and QA already exempted on purpose. Not counted as a defect. Stage 4's surface-2 figures (3.19/3.18) are unchanged.

## Visual comparison vs `stage-0/prototype/` (390, light and dark)

| Screen | Verdict |
|---|---|
| **Home** (`home-390-*`) | Matches. Status line "תדלוק בעוד 3 ימים · במיכל כ־45%". Facts strip has 3 rows with leaders. TCO card has the "בחודש ⇅" chip and a full legend in value order (250/221/145/103/98/6) that matches the bar order. Quiet chart with values on the points, end dates and "הרגיל שלך". Light next-refuel card with the "כאן בד״כ מתדלקים" label and darker to-habit ticks. Two recent rows. Remaining differences are covered by stage-2 DIFF (chip at the far end, #11). |
| **Measurement sheet** (from Home ⓘ) | It is now `MeasurementSheet`. It shows the full count ("9 מהם עד הסוף") and restarts ("רצף אחד, בלי פספוסים"). It differs from the prototype in look: see D1. |
| Fill-up (`fillup-filled`, `fillup-empty`, `fillup-more`) | Matches: header receipt and camera icons, chips, ink pump, segmented control, preview, "עוד פרטים". |
| Tank sheet | Order matches (gauge → save → forecast → trips). Minor: D3. |
| Station sheet | Matches the production layout documented in stage-4 DIFF (no tabs). |
| Expense form | The "לכלול בעלות הרכב" toggle (on by default) with ⓘ is present. The explainer sheet copy matches in both themes. |
| Journal | Matches: period chip first in the chip row, fade mask, top summary with "על מה הסכום מבוסס?", and the info sheet including the "לא בעלות הרכב" note. The "לא בעלות הרכב" row tag does not appear in the gallery because the gallery seed has no excluded expense. It is asserted by `design-v3-forms.spec.ts`, which passed in the full run. |
| Snooze presets | Matches: מחר / בעוד שבוע / בעוד חודש with dates, plus the date field. Minor: D2. |

## Defects

| # | Sev | Where | What | Owner |
|---|---|---|---|---|
| D1 | low–med | `[data-testid=consumption-details-sheet]` (`src/components/tank/MeasurementSheet.tsx`). Screenshots: `after-merged/sheet-measurement-390-light.png`, `-430-dark.png`; prototype `stage-0/prototype/sheet-measure-390-light.png` | Still GroupRow rows (small values, no dotted leader, no Plex Mono 22 values), plus a separate 13.0 hero. The "המקטע הפתוח" group shows three zero rows ("0.0 ל׳ / 0 / 0 ק״מ"); the prototype has one facts row ("המקטע הפתוח · 1 תדלוק") and the average as a row. Stage 4 DIFF said "FactsStrip swap at merge", and that swap was not done. | forms agent |
| D2 | low | `[data-testid=snooze-presets]`. Screenshot: `after-merged/sheet-snooze-390-light.png` | Preset rows have no chevron. Dates use the short month ("17 בנוב׳") where the prototype uses the full month. Cosmetic only. | forms agent |
| D3 | low | Tank sheet odometer field (`tank-sheet`). Screenshot: `after-merged/sheet-tank-390-light.png` | The label "קילומטראז׳ (לא חובה)" wraps onto two lines beside a lone "—" at 390. | forms agent |
| O1 | open | Gallery `insights-cons` at 430 dark | One transient 400 console error, which did not reproduce on re-run (see Gallery). | none (rig / Insights); add URL logging to the gallery |

I found no defects for the Home agent.
