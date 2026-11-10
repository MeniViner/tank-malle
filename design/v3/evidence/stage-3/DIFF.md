# Stage 3 · differences from the prototype (390, light + dark)

Prototype: `design/v3/evidence/stage-0/prototype/*-390-*.png` (`proto/screens1.js` Insights, `screens2.js`
Vehicle/Account, `more.js` VehicleYear/BizExport). After: `after/*-390-*.png`. Production wins where it
differs from the prototype or §6 (HANDOFF §6-vs-production policy).

## Insights

| # | Prototype | Production (after) | Why |
|---|---|---|---|
| 1 | Consumption facts: best / worst / km / litres | Same four rows, `FactsStrip`; best/worst are buttons (segment sheet, focus returns) | — matches |
| 2 | Segments table in a `<details>` "כל המקטעים בתקופה" | Kept production's collapsed chart data table "כל המקטעים ופרטיהם" inside the chart card | production markup and its e2e (table row → sheet → focus) |
| 3 | Restarts shown as a visible note in the card | Restarts stay in the "בסיס החישוב" ⓘ and in the chart gaps; the fuel detail keeps its visible restart note | production copy/placement; no behaviour change |
| 4 | Price facts: dearest / cheapest (per litre) / litres with known cost | Same three rows (new `priceExtremes`, 2 decimals, rows open the fill-up); station ranking card, spread and "התדלוק היקר ביותר" (total, whole ₪) kept | allowed addition (HANDOFF); production parity items kept |
| 5 | Spending: averages are **all** spend (fuel + service + expenses) | Averages stay **fuel purchases** (`summariseSpend`), labelled "רכישות דלק" in the sub-line | production wins (§6 "spending averages" = production's fuel-purchase averages); changing the basis would be new logic |
| 6 | Per-km: "הכול לק״מ" in ₪ with 2 decimals | "הכול לק״מ" and "רכישות דלק לק״מ" in אג׳ (integer agorot) from `periodSummary`; "דלק שנמדד" keeps its own card (Karantina number) | production units and one shared covered interval; the measured-fuel card is asserted as a display number in e2e |
| 7 | By-month table: one total column, no refunds column | Kept production's דלק/טיפולים/אחרות/החזרים/נטו table | refunds-net parity |
| 8 | "לא בעלות הרכב" row under the journal links | Same: muted facts row with count, opens the journal (expenses, same range); outside every total | §7.1 |
| 9 | Community: own/group/best as facts, percentile title | Facts rows for own/group/best + production's percentile title, histogram + table, versus chart, price facts, what-is-shared card | production keeps the extra versus chart and data tables (a11y) |
| 10 | Community cohort table (pool list with make/model/year) | Not added | production has no per-peer list (privacy; benchmark returns aggregates only) — not in production, not added |
| 11 | "החסכוני בקבוצה" sub = peer's model + year | Sub = cohort basis ("אותו דגם ואותו סוג דלק" / "אותו סוג דלק") | production's comparison carries no peer identity |

## Vehicle / year screen

| # | Prototype | Production (after) | Why |
|---|---|---|---|
| 12 | "כמה עלה" with period segmented on the main vehicle screen | Production IA kept: the hub keeps "<year> עד עכשיו" → costs tab; the costs tab is "כמה עלה" (period picker + facts strip: total, parts as minor rows, two per-km rows, excluded line) | production routes/tests (`?tab=costs`, `running-total`) |
| 13 | Year rows: year · bar · amount · chevron | Same layout; keeps production's sub-line (count · refunds · missing costs) and the bar's aria-label | parity |
| 14 | Year screen: 72px hero, monthly bars, facts, last 12 records | Title "שנת <y>", the same "כמה עלה" facts (`RunningCosts`), link to all the year's records, record count | monthly chart and record list are not in production — not added |
| 15 | Paused reminders / resolved issues in disclosures | Same (production disclosures, v3 hairlines) | — |
| 16 | Overview meta includes declared consumption | Declared consumption stays on the details tab (now a facts row); tank estimate shown as "· הערכה" | production placement |
| 17 | EV meta "חשמלי · סוללה N kWh · טווח N ק״מ" | Same + motor kW; details tab shows הנעה / סוללה / טווח WLTP / הספק מנוע and no fuel/tank/declared rows | §7.4 |
| 18 | "גיבוי וייצוא תחזוקה" row on Vehicle | Stays in Account → הנתונים שלי → גיבוי | production wins (checklist #59) |
| 19 | "דוח חודשי לעסק" row on Vehicle | Row on the hub links block and the details tab | §7.2 |

## Account

| # | Prototype | Production (after) | Why |
|---|---|---|---|
| 20 | Identity and activity facts inline on the page | Kept production's identity button → "פרטי החשבון" sheet; the sheet's identity and activity are now facts strips | production structure and e2e (`account-identity` → `account-summary`) |
| 21 | "הרשאות · משתמש" for non-admins | Row only for admins | production copy |
| 22 | Master notifications switch | Not added | not in production (checklist note #20) |
| 23 | "דוח חודשי לעסק" under הנתונים שלי | Added as a row after "ייצוא ל-Excel" (active vehicle) | §7.2 |
| 24 | Excluded expenses in the activity | Production activity total already excludes them; a muted "לא בעלות הרכב" row is shown when any exist | §7.1 |

## Business statement sheet (prototype `sheet-biz-export`)

| # | Prototype | Production (after) | Why |
|---|---|---|---|
| 25 | Month chips (12) | Chips for every month with records (scrolls) | `statementMonths` |
| 26 | Business details saved on blur | Explicit "שמירת פרטי העסק לרכב" button; also saved when exporting; preview and exports use the typed values immediately | write goes through the outbox (`updateVehicle`), toast on failure/unconfirmed |
| 27 | "PDF להדפסה" downloads an .html | Opens the print-ready HTML in a new window (falls back to a download if the popup is blocked); "CSV ל-Excel" downloads | brief: "print-ready HTML opened in a new window" |
| 28 | Rows list not shown in the sheet | Collapsible "הרשומות בחודש" grouped by category; excluded group marked "מחוץ לסה״כ" | brief: grouped rows |

## Notifications / Unsynced / Import

v3 look only, no behaviour or markup change: import counts restyled as a receipt list (label right, mono value
left, dashed rules) by CSS only; notifications count badge on the radius scale. The prototype's import
tabs ("תדלוקים / עדכוני מיכל"), sample-file link and unsynced stepper are not in production — not added.
