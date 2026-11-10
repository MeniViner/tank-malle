# Stage 7: acceptance-defect fixes

Branch `feat/design-v3`, on top of `fbc4bf1`. Nothing is committed. Rig: `E2E_ISOLATED=1` (Firestore 8087, Auth 9097, Vite 5273, PWA 5274), with Java from `/opt/homebrew/opt/openjdk/bin`.

## Defect → change → verification

| # | Change | Verified |
|---|---|---|
| D1 | In `src/components/Fmt.tsx`, `NumericText` now finds Latin phrases that mix letters and digits ("i20", "i20 Inspire", "BYD ATTO 3", "ID.4"). It wraps each one in a single `<bdi dir="ltr" class="tm-latin-run">`. All other text goes through the old path unchanged. Latin text with no digits stays plain, and pure numbers keep their `NumRun` isolation. | New unit test in `DesignPrimitives.test.ts` asserts the exact markup and text order for "יונדאי i20 · 2019", "BYD ATTO 3", "יונדאי i20 Inspire", "טויוטה Corolla" and a pure-number string. The screenshots read "יונדאי i20" (`after-fixes/vehicle-390-*`) and "BYD ATTO 3" (`after-fixes/smoke/ev-vehicle-*`). |
| D2 | See the **EV wording decision** below. The new helper `src/lib/vehicle/energyCopy.ts` holds the copy. The EV branches are in `tco.ts` / `useTco` (part label), `TcoBlock`, `Home`, `JournalEntryRow` (Home and journal), `lib/home/spotlight.ts`, `Statistics`, and the `ConsumptionInsights`, `PriceInsights` and `SpendingInsights` components. | The smoke EV steps for Home and for Insights cons/price/spend now **pass** at 390/430 in light and dark. A new `tco.test.ts` case shows the EV result differs only in the label. Fuel-car e2e expectations are unchanged. |
| D3 | `Maintenance.tsx`: for an EV, the prefs tab omits `TankPreferencesSection`, and the hub sub-line reads "רכבים נוספים והעדפות" instead of "העדפות מיכל ורכבים נוספים". | The smoke step "EV: vehicle overview/details/edit" passes on all 4 runs. |
| D5 | **No code change: this is the intended stats rule.** `periodSummary` withholds per-km figures when mileage readings go backwards. In the gallery seed, service `g-periodic` records 168,850 km on day −120, but fill `g-03` recorded 168,930 km a day earlier, so `mileageInconsistent` is true. The year screen's "איך מחושבות העלויות?" disclosure states this ("סדר קריאות הק״מ אינו עקבי; המרחק ועלות לק״מ אינם ידועים"). The bug is in the seed data, not the presentation layer. | The smoke "year screen" step now opens the disclosure and records its text: `perKm=—` plus the sentence above, on all 4 runs. |
| D6 | The consumption and price charts now use `type="linear"` with the y-axis hidden (`QUIET_VALUE_AXIS`; the scale is kept, nothing is drawn). Consumption shows the average value on its dashed line at the oldest end, plus the newest point's value. Price shows the first and last paid prices at their points (`ChartValueLabel`, same `price()` format, with a smaller ₪). The data, tooltips, point buttons, tables and figure names are unchanged. | `after-fixes/insights-{cons,price}-390-{light,dark}.png` were read. The `design-v2-insights` spec passes, with its tick check moved to the endpoint labels (see test changes). |
| D7 | `VehicleEdit.tsx`: the fuel segmented control adds "חשמלי". Choosing it sets `powertrain: 'ev'` and `fuelType: 'other'` (the existing EV storage shape), which hides the tank, declared-consumption and 95-warning fields through the existing `electric` logic. Choosing a fuel undoes an unsaved switch; on a stored EV it sets `powertrain: 'ice'`. The rules already accept `ice/phev/ev`. For an EV the control is labelled "הנעה". The EV note now reads "רכב חשמלי · בלי שדות של רכב בנזין או סולר." | New smoke step: on the fuel car, choosing "חשמלי" hides "נפח מיכל"/"נתון יצרן", switching back restores them, and nothing is saved. It passes on all 4 runs (`after-fixes/smoke/edit-choose-ev-*`). |
| D8 | `InsightChart` clones any chart that has the Recharts accessibility layer (focusable `role="application"`) and gives it `aria-label="<figure label>, אפשר לעבור בין הערכים בחיצים"`. The consumption chart has no layer, so it is not focusable and is left as it was. | All e2e specs pass. The figure keeps its own name (`ui-review` asserts it). |

## EV wording decision (D2)

Production has no charge or kWh record: EV records are fills in litres and ₪ per litre. The rule I followed is to keep a figure if it is still true, give it energy wording, and never show a litre unit on an EV.

- **Relabelled, values unchanged**:
  - The TCO part is "חשמל", matching the facts strip, with a battery icon on the sheet tile and "מתוך זה חשמל" on the share tile.
  - The spending chart, legend, table column and journal link use "חשמל".
  - "רכישות דלק" becomes "טעינות" in averages, YTD, per-km, the detail disclosure, its chart and its table caption.
  - The cost card reads "חשמל שנמדד במקטעים סגורים". Segment cost divided by km is still valid.
  - The Insights summary reads "N טעינות"; the month spotlight reads "X חשמל · N טעינות"; recent and journal rows read "טעינה · <end state>".
- **Not shown, replaced by "—" plus one line**:
  - Consumption on Home and Insights: "מעקב צריכת חשמל יגיע בהמשך".
  - Insights price: "מעקב מחיר החשמל לקוט״ש יגיע בהמשך". The price tab keeps the whole-shekel "הטעינה היקרה ביותר" and the known-cost count.
  - Insights consumption keeps "מרחק שנמדד".
- **Hidden**:
  - The litres facts ("ליטרים שנרכשו") and the litres column.
  - The km/L sparkline, segment table and measurement sheet.
  - The per-litre spotlights (personal-best consumption, sustained consumption, paid price, regulated-price changes).

I chose "—" with a note over hiding whole blocks, because it tells the owner the measurement is missing rather than implying it doesn't exist. Every branch is gated on `isEv`, so fuel cars render exactly the same text and values.

## Gates and runs

| Run | Result |
|---|---|
| `npx tsc -b` | pass |
| `npm run lint` | 0 errors, 20 warnings (the same set as before) |
| `npm test` | 113 files, **1,528 passed**, 12 skipped |
| Affected specs (design-v2-home/insights/vehicle/vehicle-writes, design-v3-entry/forms/home/stage3/statement, home-cost-insights, rtl, statistics, tco, vehicle-archive, vehicle-lookup) | **94 passed**, 0 failed |
| qa7 smoke (390/430 × light/dark; shots in `after-fixes/smoke/`) | **42/43 on every run**. The only failure is "EV: fill form has no tank fields", the documented product gap (no charge model, D4/J). 0 console errors, 0 key warnings. |
| Full main suite, JSON at `e2e-after-fixes.json` | **318 passed, 1 failed, 8 skipped** (28.1 min). The failure is the known baseline `mobile-fuel-release.spec.ts:21`. |
| Gallery at 390, light and dark → `after-fixes/` | 2/2 passed, 96 PNGs, 0 capture failures, 0 console entries. Read: home, insights cons/price, vehicle, vehicle-edit. |

## Test changes

- `e2e/design-v2-insights.spec.ts`: the price-chart format check now targets `.insights-price-point-label` (endpoint values) instead of `.insights-price-axis-tick`, because D6 removes the axis. Its assertions are kept: the `N.NN ₪` format, the smaller ₪ and the ₪ trailing the digits.
- Added: a D1 case in `src/components/DesignPrimitives.test.ts` and an EV-label case in `src/lib/tco.test.ts`.
- Scratch smoke script (outside the repo): screenshots now go to `after-fixes/smoke`, the year step records the disclosure, and a D7 step was added. The original is kept as `smoke.qa7.ts.orig`.
