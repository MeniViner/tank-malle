# Insights (תובנות) — Stage 0 behaviour checklist

Baseline: `main` @ `05548ba`. Route `/stats`. All tabs: צריכה (`cons`), מחירים (`price`), הוצאות (`spend`), השוואה (`community`).

## Sources

- `src/screens/Statistics.tsx` (screen shell, period, tabs, vehicle picker, history readiness)
- `src/components/insights/presentation.ts` (periods, tab parsing, `consumptionSummary`, `priceSummary`, `spendingSummary`, journal links)
- `src/components/insights/ConsumptionInsights.tsx`, `PriceInsights.tsx`, `SpendingInsights.tsx`, `CommunityInsights.tsx`, `InsightChart.tsx`
- `src/components/TcoBlock.tsx`, `src/components/CostCommunity.tsx` (TCO card + cost community on the spend tab)
- `src/components/home/SegmentSheet.tsx` (segment details sheet)
- `src/lib/stats.ts` (`computeStats`), `src/lib/periods.ts` (`RANGE_COMPACT`, `rangeDates`, `summariseSpend`, `bucketSpend`), `src/lib/benchmarks.ts`, `src/lib/benchmarkIdentity.ts`, `src/lib/vehicle/derived.ts` (`periodSummary`), `src/hooks/useBenchmark.ts`, `src/hooks/useTco.ts`
- Tests: `e2e/design-v2-insights.spec.ts`, `e2e/statistics.spec.ts`, `e2e/tco.spec.ts`, `e2e/cost-community.spec.ts`, `src/components/insights/presentation.test.ts`, `src/components/insights/InsightChart.test.ts`, `src/lib/stats.test.ts`, `src/lib/continuity.test.ts`, `src/lib/tco.test.ts`, `src/lib/costBenchmarkModel.test.ts`

## Behaviours

### Shell, period, tabs
1. Screen is keyed by vehicle scope (selections dropped on account/vehicle switch). `src/screens/Statistics.tsx:23-26`. Uncovered directly.
2. Stats are computed once on the **complete** history; the period only selects output (segments are attributed by their closing fill). `Statistics.tsx:40-45`; `presentation.ts:70-85`. Test: `e2e/design-v2-insights.spec.ts` (month selects 600 km / 45 L segment whose opening tank is outside), `presentation.test.ts` ("keeps the segment whose opening full tank is outside the range…").
3. Period picker (label "תקופת התובנות") options: "החודש", "3 חודשים אחרונים", "6 חודשים אחרונים", "מתחילת השנה", "12 חודשים אחרונים", "כל התקופה"; default `6m`; URL `period=`; invalid → 6m. `presentation.ts:20-22`, `36`; `src/lib/periods.ts:58-65`. Test: `e2e/statistics.spec.ts` ("changing the range changes the figures and says which range they are").
4. `?month=YYYY-MM` selects one full local calendar month (leap-safe), adds a picker option "<month year>"; choosing a period removes `month`. `presentation.ts:31-49`; `Statistics.tsx:56`, `64-67`. Test: `presentation.test.ts` ("resolves the Home month link…", "handles leap months…"), `e2e/design-v2-insights.spec.ts`.
5. Tabs nav (aria "מדורי תובנות", `aria-pressed`): "צריכה", "מחירים", "הוצאות", "השוואה"; `tab=` accepts aliases `prices`→price, `costs`→spend; default `cons`; tab change uses `replace`. `presentation.ts:16-29`; `Statistics.tsx:61-63`, `77-79`. Test: `e2e/statistics.spec.ts` ("the four sections are navigable").
6. With >1 active vehicle, a vehicle button (aria "בחירת רכב לתובנות") opens sheet "בחירת רכב" that sets the active vehicle. `Statistics.tsx:74-76`, `101-106`. Uncovered.
7. Period summary: "N תדלוקים · N מקטעים" and the range dates; for "כל התקופה" the start reads "מהרשומה הראשונה" (replaces "מהתדלוק הראשון"); on the community tab it reads "ההשוואה מבוססת על כל ההיסטוריה". `Statistics.tsx:80-85`; `periods.ts:162`. Test: `e2e/statistics.spec.ts` ("14 תדלוקים").
8. History readiness: not ready when loading, cached-only, malformed/denied fill-ups, or pending/failed fill-up outbox ops; status line "<reason> · מוצגים הנתונים הזמינים" with reasons "טוענים את היסטוריית התדלוקים", "חלק מהתדלוקים אינם זמינים לקריאה", "נתוני התדלוקים עוד לא אומתו בענן", "יש תדלוקים שממתינים לאישור או לבדיקה" (hidden on community). `Statistics.tsx:46-52`, `86`. Test: `e2e/design-v2-insights.spec.ts` ("malformed and denied…", "cached history withholds comparison…").
9. While fill-ups load on cons/price, skeletons (aria "טוענים תובנות", `role=status`). `Statistics.tsx:87-89`. Uncovered.
10. Charts: wide (>14 points or consumption spacing 44px) charts scroll horizontally (aria "…, אפשר לגלול לכל התקופה"); sr-only caption "תחילת התקופה מימין. הנתונים המלאים מופיעים גם בטבלה שמתחת לגרף."; every chart has a collapsed data table "נתוני הגרף". `InsightChart.tsx:48-82`. Test: `src/components/insights/InsightChart.test.ts`, `e2e/design-v2-insights.spec.ts` (theme evidence).

### Consumption tab
11. Headline label "צריכה ממוצעת · לפי המרחק והדלק שנמדדו · <period>" ("צריכה בתדלוקים הזמינים" when not ready); title "אתה נוסע <x> ק״מ לליטר" / "אתה צורך <x> ל׳/100 ק״מ" per units; average = Σkm/Σlitres of closed segments in range. `ConsumptionInsights.tsx:39-42`; `presentation.ts:70-76`. Test: `e2e/design-v2-insights.spec.ts` ("11.9", "13.3", litersPer100 "7.5").
12. Line chart of segments: break gaps between continuity islands (no line across restarts), dashed average reference line, each point a ≥44px button (aria "מקטע עד <d>, <v> <unit>, פתיחת פרטים") opening the segment sheet; focus returns to the same logical point after close; last point coloured by better/worse vs average. `ConsumptionInsights.tsx:22-30`, `43-51`, `91-108`; `presentation.ts:95-107`. Test: `e2e/design-v2-insights.spec.ts` (4 points, 44px, keyboard Enter, Escape focus), `presentation.test.ts` ("keeps both boundary observations and breaks the line…").
13. Legend "כל מקטע בין טנקים מלאים" + "הממוצע שלך · <v>". `ConsumptionInsights.tsx:52-53`. Uncovered textually.
14. Manufacturer reference: "קרוב ל<label>" or "<pct> יותר/פחות דלק לק״מ לעומת <label> (<value>)." with labels "נתון היצרן", "נתון יצרן משנה אחרת", "אומדן לפי נתוני הפליטה", "הנתון שהזנת", "הנתון השמור לרכב". `ConsumptionInsights.tsx:32-37`, `54-58`. Test: uncovered (testid `insights-manufacturer-comparison` not asserted).
15. Segments table ("כל המקטעים ופרטיהם"): end date button, consumption, distance, litres (1 dp); row button opens the segment sheet. `ConsumptionInsights.tsx:59-66`. Test: `e2e/design-v2-insights.spec.ts` (`journal-low` row → 400 km / 40.0 L / ₪288).
16. KPIs: "המקטע הטוב", "המקטע החלש" (buttons → segment sheet, date + "←"), "מרחק שנמדד" "<km> ק״מ ב־N מקטעים סגורים", "דלק במקטעים" "<l> ליטרים". `ConsumptionInsights.tsx:68-74`, `110-116`. Test: `e2e/design-v2-insights.spec.ts`, `e2e/statistics.spec.ts`.
17. Segment sheet shows distance, litres, cost ("—" + "חסר סכום באחד התדלוקים. עלות המקטע אינה ידועה במלואה." when unknown), cost per km. `src/components/home/SegmentSheet.tsx:21-37`. Test: `e2e/design-v2-insights.spec.ts` (`segment-distance/liters/cost`).
18. Empty states: "נתוני הצריכה עדיין אינם זמינים"/"נחכה להשלמת היסטוריית התדלוקים."; "אין מקטעים סגורים בתקופה הזו"/"אפשר לבחור תקופה אחרת…"; "עוד תדלוק מלא אחד ונדע"; "מתחילים מתדלוק מלא"/"צריכה נמדדת בין שני תדלוקים שסומנו כמלאים…"; CTA "תדלוק חדש ←" only when history is ready. `ConsumptionInsights.tsx:75-78`; `InsightChart.tsx:42-46`. Test: `presentation.test.ts` ("leaves open/empty periods unmeasured…"); UI uncovered.
19. Open segment card "המקטע שעדיין פתוח": "<l> ל׳ מ־N תדלוקים · <km> מהתדלוק המלא האחרון" or "מחכים לתדלוק מלא שיפתח מדידה"; hidden with a baseline and no pending fills. `ConsumptionInsights.tsx:79`, `118-125`. Uncovered in e2e (testid `insights-open-segment`).
20. Basis "N מקטעים סגורים · <period>" with ⓘ "בסיס החישוב": segments from full history, opening fill excluded, open-segment litres counted on closure, and restarts "יש N נקודת/נקודות התחלה מחדש. חישובי הצריכה והקו אינם חוצים אותן.". `ConsumptionInsights.tsx:80-87`. Test: `e2e/statistics.spec.ts` ("a continuity break does not corrupt the range metrics").

### Price tab
21. Only the vehicle's fuel type is analysed; other fuels counted and noted "N תדלוקים מסוג דלק אחר אינם נכללים בהשוואה."; empty: "אין תדלוקים מהסוג הזה בתקופה שנבחרה" + "המחירים מוצגים עבור <fuel>." / "נתוני המחירים עדיין אינם זמינים". `presentation.ts:127-130`; `PriceInsights.tsx:27-31`, `75`. Test: `e2e/design-v2-insights.spec.ts` ("a different fuel never inherits the 95 reference").
22. Headline "מחיר ממוצע ששילמתם · <period>" = litre-weighted paid price, two decimals (`₪7.36`), or "מחיר התדלוקים עדיין חסר"; "N תדלוקים עם סכום חסר · סכומים ידועים בלבד". `PriceInsights.tsx:33-35`; `presentation.ts:143-145`. Test: `e2e/design-v2-insights.spec.ts`, `presentation.test.ts` ("leaves an all-unknown paid average… retaining a known zero").
23. Price chart: paid line + dashed reference line; Y ticks `₪x.xx` with smaller ₪ glyph; last point coloured worse/better vs average; gaps at restarts. Reference = same-month same-fuel official price only (no carry-over). `PriceInsights.tsx:14-20`, `37-56`; `presentation.ts:132-142`. Test: `e2e/design-v2-insights.spec.ts` (tick regex `^₪[\d,]+\.\d{2}$`), `presentation.test.ts` ("labels a historical scheduled figure honestly…").
24. Reference kinds labelled distinctly: "מחיר מרבי מפוקח", "מחיר שהוזן ידנית", "מחיר להשוואה", mixed "מחיר להשוואה לפי מקורו", none "אין מחיר להשוואה לתאריך הזה". `presentation.ts:112-115`, `140`; `PriceInsights.tsx:24`. Test: `presentation.test.ts` ("keeps manual, nonregulated and missing fuel-specific references distinct").
25. Difference block "מול המחיר להשוואה בתאריכי התדלוקים": "כמעט אותו מחיר לליטר" (<0.005) or "₪x.xx פחות/יותר לליטר", "לפי N תדלוקים עם מחיר להשוואה מאותו חודש וסוג דלק."; without references: "אין מחיר להשוואה מתועד לסוג הדלק ולתאריכים האלה. מוצגים המחירים ששילמתם.". `PriceInsights.tsx:58-62`. Test: `e2e/design-v2-insights.spec.ts` ("₪0.41", "פחות").
26. Price table: per fill date link → `/fillup/<id>`, paid per litre or "—", reference + its label. `PriceInsights.tsx:63-70`. Test: `e2e/design-v2-insights.spec.ts` (missing amount row "—").
27. Basis "<fuel> · N תדלוקים עם סכום ידוע" + ⓘ "מקור המחירים" (paid includes personal discounts; reference same month/fuel; "מחיר ללא מקור מפוקח אינו נקרא מחיר מפוקח."; litre-weighted; missing totals not shown as zero). `PriceInsights.tsx:71-77`. Uncovered textually.
28. Station ranking card "תחנות · המחירים האישיים שתועדו": title "הכי זול ששילמתם בתקופה: <name>" (or "המחיר שתועד ב<name>" for one); rows by litre-weighted average asc with "N תדלוקים · N סכומים חסרים"; stations keyed by public station id else reusable name; placeholder names excluded. `PriceInsights.tsx:80-90`; `presentation.ts:151-169`. Test: `e2e/design-v2-insights.spec.ts` (3 ranks ₪7.20/₪7.33/₪7.54), `presentation.test.ts` ("ranks the period by litres-weighted recorded cost…", "keeps unidentified purchases…").
29. Spread "הפרש של ₪x.xx לליטר בין הממוצעים שתועדו, כ־₪N לטנק מלא לפי נפח המיכל השמור לרכב" (tank part only with trusted capacity); note "אלה מחירים ששילמתם, כולל הנחות אישיות, בתקופה שנבחרה."; empty "עוד אין תחנות להשוואה". `PriceInsights.tsx:91-96`; `presentation.ts:170`, `181`. Test: `e2e/design-v2-insights.spec.ts` ("₪0.34", "₪17").
30. "עוד על המחירים" details: "התדלוק היקר ביותר בתקופה" (total, whole ₪) + station/"ללא מיקום" · date. `PriceInsights.tsx:97-100`; `presentation.ts:178`. Uncovered.

### Spending tab
31. TCO card (compact `TcoBlock`) at top, with its own sheet and cost-community status. `SpendingInsights.tsx:39`; `TcoBlock.tsx:29-96`; `CostCommunity.tsx`. Test: `e2e/tco.spec.ts` ("agree across Home and Insights"), `e2e/cost-community.spec.ts`.
32. "הוצאות הרכב · <period>" title "תועדו ברכב <net> נטו" = fuel + service + other − refunds from the ledger in range; "—" when unknown/incomplete-empty. Coverage line: "סכום ההוצאות עדיין אינו ידוע." / "סכומים ידועים בלבד." / "N רשומה/רשומות ללא עלות מלאה." / "חלק מהרשומות עדיין אינן מאושרות או זמינות." / "אחרי <refunds> שהוחזרו." / "אין הוצאות מתועדות בתקופה שנבחרה.". `SpendingInsights.tsx:28-48`; `presentation.ts:203-234`. Test: `e2e/design-v2-insights.spec.ts` ("₪1,567", "1 רשומה ללא עלות מלאה"), `presentation.test.ts` ("includes fuel, service, expenses and negative refunds…").
33. Monthly stacked bar chart (sign stack: refunds below zero, hatched) with integer Y ticks (`allowDecimals=false`, `int`); every month in range present (empty months kept). Colours: fuel `--accent`, service `--ink-2`, other `--surface-2`. Legend "דלק", "טיפולים", "הוצאות", "החזרים מתחת לאפס" (only with refunds). `SpendingInsights.tsx:50-66`. Test: `presentation.test.ts` ("renders expenses without any fuel records and keeps every empty month…").
34. By-month table: month (+ "N עלות/עלויות חסרות"), דלק, טיפולים, אחרות, החזרים (negative), נטו; unknown-only cells "—", explicit zero "₪0". `SpendingInsights.tsx:67-73`; `presentation.ts:187-229`. Test: `e2e/design-v2-insights.spec.ts` (["₪628","₪123","₪0","₪0","₪751"], ["₪808","₪0","₪19","−₪11","₪816"]), `presentation.test.ts` ("preserves all-unknown, unknown refunds, explicit zero and negative-net…").
35. No rows → link "לרשומות בתקופה הזו ←" to the journal with the same from/to. `SpendingInsights.tsx:74`. Test: `presentation.test.ts` ("uses the same selected calendar days…").
36. Fuel cost per km card "דלק שנמדד במקטעים סגורים" / "כל ק״מ עולה לך" → "<N> אג׳" or "עלות הדלק לק״מ עדיין לא ידועה" with reasons ("נחכה עד שהרשומות יהיו זמינות ומאושרות.", "העלות תופיע אחרי סגירת מקטע צריכה בתקופה הזו.", "חסר סכום באחד התדלוקים שנכללו במקטעים."); ⓘ "איך מחושבת עלות הדלק לק״מ". `SpendingInsights.tsx:77-87`. Test: `e2e/design-v2-insights.spec.ts` ("62 אג׳"; missing amount stays unknown).
37. Journal links nav (aria "פירוט ההוצאות ביומן"): "דלק", "טיפולים", "הוצאות אחרות" ("אחרי החזרים") with amounts → `/history?from&to&kind=`. `SpendingInsights.tsx:33-37`, `89-94`. Test: `e2e/design-v2-insights.spec.ts` (expense link → journal "₪8", 2 rows).
38. Details "עלויות הרכב והמרחק המתועד": "הכול לק״מ" and "רכישות דלק לק״מ" in אג׳ from `periodSummary` over the recorded odometer span; caveats "אין טווח קילומטראז׳ מספיק ועקבי לחישוב עלות לק״מ.", "סדר הרשומות בגבול התקופה אינו ידוע.", "קריאות הקילומטראז׳ אינן עקביות.", "יש הפסקת רציפות בטווח.", "יש עלויות חסרות."; note "…ללא ירידת ערך. רכישות דלק וצריכת דלק שנמדדה הן שני נתונים שונים.". `SpendingInsights.tsx:96-110`; `src/lib/vehicle/derived.ts` (`periodSummary`). Test: `src/lib/tco.test.ts` / derived tests; UI uncovered.
39. Details "פירוט רכישות דלק וקילומטראז׳" (lazy, rendered on open): "ליטרים שנרכשו", "ממוצע שבועי", "ממוצע חודשי", "מתחילת השנה" (whole ₪; "—" if any amount in scope unknown or history not ready); ⓘ "בסיס ממוצעי ההוצאות"; grouping segmented "קיבוץ" שבועי/חודשי/שנתי with bar chart (integer ticks) and table "סכום ידוע"/"ליטרים עם סכום ידוע"; cumulative odometer area chart + table; restart note "…הקו נקטע שם בכוונה…". `SpendingInsights.tsx:115-170`. Test: `e2e/statistics.spec.ts` ("grouping is a separate control…", "weekly, monthly and year-to-date…" `^₪[\d,]+$`, continuity break).

### Community tab
40. States (`insights-community-status[data-state]`): `off` "ההשוואה כבויה" + link to `/account`; `history-loading|history-unavailable` "נחכה להשלמת היסטוריית התדלוקים"; `own-needed` "עוד קצת מדידה לפני ההשוואה" ("נדרשים לפחות שני מקטעי צריכה סגורים…") + "תדלוק חדש ←"; `loading` "בודקים את קבוצת ההשוואה"; `unavailable` "ההשוואה אינה זמינה כרגע"; `insufficient` "עוד סיכום רכב אחד ונשווה"/"מחכים לעוד N סיכומי רכבים" + progressbar (max 4) "N מתוך 4 סיכומי רכבים"; `ready`. `CommunityInsights.tsx:15-50`. Test: `e2e/statistics.spec.ts` ("insufficient state", "with enough peers"), `e2e/design-v2-insights.spec.ts` ("comparison waits for four vehicle summaries…").
41. Own figure requires ≥2 closed segments and a non-null average. `Statistics.tsx:95`. Test: `e2e/design-v2-insights.spec.ts`.
42. Cohort: first same `modelKey` (make+model) and same fuel type, else same fuel type; MIN_PEERS = 4 per attempt; all of the user's own vehicles excluded; fuel types never crossed. `src/lib/benchmarks.ts:175-246`; `src/lib/benchmarkIdentity.ts:3`. Test: `e2e/design-v2-insights.spec.ts`, `e2e/statistics.spec.ts`.
43. Benchmark/cohort always use full history, never the selected period; publish withheld until history is ready. `Statistics.tsx:53-54`. Test: `e2e/statistics.spec.ts` ("the Statistics range does not move the canonical community benchmark"), `e2e/design-v2-insights.spec.ts` (malformed/cached history).
44. Ready: "<pct> מהסיכומים מצביעים על צריכת דלק גבוהה משלך לק״מ" with "הממוצע שלך"/"ממוצע הקבוצה", basis "אותו דגם ואותו סוג דלק"/"אותו סוג דלק" + ⓘ "מה ההשוואה אומרת". `CommunityInsights.tsx:66-74`. Test: `e2e/design-v2-insights.spec.ts` (percentile direction).
45. Distribution histogram with own bucket highlighted (accent) and table (ascending bounds in display units, reciprocal-safe); versus chart "שלך / ממוצע הקבוצה / החסכוני בקבוצה" + table. `CommunityInsights.tsx:75-104`; `presentation.ts:62-67`. Test: `presentation.test.ts` ("presents actual histogram bounds in ascending display units…").
46. Price comparison card (only when all own fills have known cost and the vehicle's fuel, and both averages exist): "המחיר שלך קרוב לממוצע הקבוצה" or "שילמת ₪x.xx פחות/יותר לליטר מממוצע הקבוצה". `Statistics.tsx:58-59`; `CommunityInsights.tsx:105-110`. Uncovered.
47. "מה משותף" card: "סיכום אחד לכל רכב", "משויך למזהי החשבון והרכב", ⓘ listing shared (model, year, fuel, average, segment count, avg price, update time; account+vehicle ids), not shared (name, email, plate, odometer, dates, stations, location, notes), not anonymous, period doesn't change the summary; link to account to change participation. `CommunityInsights.tsx:114-126`. Test: `e2e/design-v2-insights.spec.ts` (opt-out removes own sharing).

## §6 cross-check (Insights line)

| §6 item | Status | Evidence |
|---|---|---|
| Period incl. "מהרשומה הראשונה" | present | `Statistics.tsx:83` (string replace on "כל התקופה" range) |
| Consumption table | present | `ConsumptionInsights.tsx:59-66` |
| Restarts | present | `ConsumptionInsights.tsx:85`; `SpendingInsights.tsx:167`; chart gaps `presentation.ts:100-102` |
| Open segment | present | `ConsumptionInsights.tsx:118-125` |
| Manufacturer reference | present | `ConsumptionInsights.tsx:54-58` (no e2e) |
| Price extremes | **partial** | Only station cheapest→dearest averages + spread (`PriceInsights.tsx:80-94`) and the most expensive fill **total** (`PriceInsights.tsx:97-100`). No lowest/highest paid **per-litre** fill |
| Litres with known cost | present | grouped table column "ליטרים עם סכום ידוע" `SpendingInsights.tsx:151-152`; "N תדלוקים עם סכום ידוע" `PriceInsights.tsx:71` |
| Non-regulated note | present | `PriceInsights.tsx:73`; reference labels `presentation.ts:113-115` |
| Spending averages monthly/weekly/YTD | present (fuel purchases only, in a collapsed details) | `SpendingInsights.tsx:133-135` |
| Three per-km figures | present | fuel measured `SpendingInsights.tsx:79`; "הכול לק״מ", "רכישות דלק לק״מ" `:98-99` (all in אג׳) |
| By-month table | present | `SpendingInsights.tsx:67-73` |
| Refunds net | present | `presentation.ts:199-229`; `SpendingInsights.tsx:46` |
| Excluded expenses | **missing-in-production** | No `excluded` flag in the data model or aggregates (§7.1 new feature) |
| Community grouping (model+fuel ≥4 else fuel) | present | `benchmarks.ts:183-246`, `MIN_PEERS=4` |
| Distribution | present | `CommunityInsights.tsx:75-89` |
| Price comparison | present | `CommunityInsights.tsx:105-110` |
| Min 2 segments | present | `Statistics.tsx:95` |
| What-is-shared | present | `CommunityInsights.tsx:114-126` |

## v3 changes to this screen

May change:
- §3 facts strip replaces KPI tiles: best/worst/km/litres (consumption), spending averages, community pairs. Keep the same values, testids and the button behaviour of best/worst (segment sheet + focus return).
- §1 tone (hairlines, radii, Karantina 400, shadows) and §4 category colours in the spending chart/legend (today fuel `--accent`, service `--ink-2`, other `--surface-2`: must not become "three greys"; dark variants per §4).
- §5 money string `₪1,567` → `1,567 ₪`; per-litre stays two decimals (`7.36 ₪`, tick labels). Many assertions use `₪`-prefix (`e2e/design-v2-insights.spec.ts`, `e2e/statistics.spec.ts` `^₪[\d,]+$`, price tick regex) — update the string format only.
- Stage 3 parity additions: price extremes per litre, excluded-expenses line.
- §7.1: expenses with `excluded: true` must be left out of TCO, per-km (all three), monthly/weekly/YTD averages, the spending chart and the shared cost summary; they still appear in the journal totals. Decide and document whether the by-month table "נטו" and the "תועדו ברכב … נטו" total exclude them (spec: "left out of … the spending chart"), and show them as a separate excluded line.
- Spend chart Y ticks remain integers (AGENTS.md).

Must not change:
- One `computeStats` on complete history; period selects by segment closing date; benchmark never receives range-filtered stats.
- Unknown cost ≠ 0 everywhere ("—", "סכומים ידועים בלבד"); known zero stays zero; refunds net and below zero.
- Same-month same-fuel reference rule and honest reference labels; other-fuel exclusion.
- History-readiness gating (status line, community withheld, YTD/averages "—").
- Community cohort rules, MIN_PEERS 4, own-vehicle exclusion, ≥2 segments, what-is-shared copy, opt-out links.
- 44px chart points with logical focus return; data tables for every chart; URL contract `tab`, `period`, `month`.
