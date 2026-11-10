# Home — current behaviour checklist (baseline `05548ba`)

Acceptance list for Stage 2. Every item below is production behaviour today; v3 may restyle it but must not drop it unless the "v3 changes" list at the end says so explicitly. Tank hero sheet internals, measurement sheet and segment sheet are listed in `tank-sheets.md`. Header / car switcher / tab bar / FAB are in `shell.md`.

## Sources

- `src/screens/Home.tsx` (screen composition and order)
- `src/components/home/HomeSpotlight.tsx`, `src/components/SpotlightCard.tsx`, `src/hooks/useSpotlight.ts`
- `src/lib/home/spotlight.ts`, `groupedReminders.ts`, `paidPriceInsight.ts`, `sustainedConsumption.ts`, `priceSpotlight.ts`, `presentation.ts`
- `src/components/home/ConsumptionComparison.tsx`, `src/components/ConsumptionSparkline.tsx` (+ `consumptionSparklineModel.ts`)
- `src/components/home/HomeFuelPrice.tsx`, `src/components/FuelDiscountSheet.tsx`
- `src/components/TcoBlock.tsx`, `src/hooks/useTco.ts`, `src/lib/tco.ts`, `src/components/CostCommunity.tsx`
- `src/components/tank/TankHero.tsx`, `TankPresentation.tsx`, `src/components/DesignPrimitives.tsx` (`Gauge`)
- `src/components/JournalEntryRow.tsx`
- Tests: `e2e/design-v2-home.spec.ts` (+ `e2e/helpers/design-v2-home.ts`), `e2e/home-cost-insights.spec.ts`, `e2e/tco.spec.ts` (+ `helpers/tco.ts`), `e2e/cost-community.spec.ts`, `e2e/official-price-notices.spec.ts`, `e2e/tank.spec.ts`, `e2e/ui-review.spec.ts`, `e2e/mobile-regressions.spec.ts`, `e2e/input-live-update.spec.ts`, `e2e/tank-pricing-followup.spec.ts`, `src/lib/home/*.test.ts`, `src/components/ConsumptionSparkline.test.ts`, `src/lib/tco.test.ts`, `src/lib/vehicle/documentNotifications.test.ts`

## Behaviours

### Screen frame and states

1. Screen has a visually hidden `<h1>` "מצב הרכב" and `data-testid="home-page"`. `src/screens/Home.tsx:38-39`. Covered: `e2e/rtl.spec.ts` (landmarks), otherwise uncovered.
2. Body is keyed by `uid/vehicleId`, so every account/vehicle switch remounts Home state (open sheets, selected segment, price sheet). `Home.tsx:41`. Covered: `e2e/design-v2-home.spec.ts` ("a Home journal delete confirmation closes on external vehicle switch…").
3. Current order today: Spotlight → (no-vehicle | skeleton | history-incomplete note → first-fill-up block → TankHero → Consumption → TCO card → three-cell trio → "לאחרונה") → sheets. `Home.tsx:80-138`. Covered: `e2e/design-v2-home.spec.ts` (screenshot states).
4. No active vehicle → section `home-no-active`: "בוחרים רכב וממשיכים" / "אפשר לשחזר רכב מהארכיון או להוסיף רכב." + button "לרכב שלי" → `/vehicle`. Spotlight still renders above it. `Home.tsx:81-83`. Covered: `e2e/vehicle-archive.spec.ts` (archive leaves no active), otherwise uncovered.
5. While fill-ups or observations load → skeleton of three blocks (228/310/100 px). `Home.tsx:56,84,143-145`. Uncovered.
6. Fill-up read error or malformed fill-ups → status line "חלק מהיסטוריית התדלוקים אינו זמין." (`home-history-incomplete`, `role=status`) and the first-fill-up empty state is suppressed (never claims "no records"). `Home.tsx:58,85-86`. Covered: `e2e/design-v2-home.spec.ts` ("malformed-only and denied history never claim the vehicle has no records").
7. No fill-ups (and history complete) → `home-first-fillup`: vehicle label (plate numeric island), "מתחילים מהתדלוק הבא", "שני תדלוקים עד הסוף ייתנו נקודת התחלה למדידת הצריכה.", primary button "רישום התדלוק הראשון" (pump icon) → `/fillup/new`; if a tank estimate is available, text action "עדכון המחוון" opens the tank sheet at the gauge. `Home.tsx:86-92`. Covered: `e2e/design-v2-home.spec.ts` ("new and partial-only vehicles…"), `e2e/tank.spec.ts` ("a new Home has one starting block, honest unknown metrics and a direct gauge action").
8. Empty vehicle never shows `₪0`; km/day and month fuel cells show "—". Covered: `e2e/design-v2-home.spec.ts:264-278`.

### Spotlight carousel

9. Region `aria-label="מה חשוב עכשיו"`, `aria-roledescription="קרוסלה"`; each slide `role=group`, `aria-roledescription="שקופית"`, label "N מתוך M". Hidden entirely when there are no items. `src/components/home/HomeSpotlight.tsx:53-62`. Covered: `e2e/design-v2-home.spec.ts` (spotlight tests).
10. Auto-advance every 7 s only if ≥2 items, the region is ≥40 % visible, document visible, no prior interaction, and reduced motion is off; any pointer/focus/key/wheel interaction stops it permanently for the mount. `HomeSpotlight.tsx:23-56`. Covered: `e2e/design-v2-home.spec.ts` ("spotlight auto-advances at seven seconds, then touch stops it; reduced motion never advances").
11. Dots shown only when >1 item (`spotlight-dots`, aria-hidden). `HomeSpotlight.tsx:71-73`. Covered: same.
12. Dismiss button label "הסתרת הכרטיס: <title>"; sticky items have no dismiss. After dismiss focus moves to the now-active card, or to the first button/link in Home body when the carousel empties. `HomeSpotlight.tsx:31-41,66-68`, `Home.tsx:77`. Covered: `e2e/design-v2-home.spec.ts` ("spotlight priority and item-scoped dismissal…"), `e2e/audit-fixes.spec.ts` (focus).
13. Dismissals are stored in `localStorage` key `tm.spotlight.v2.<uid>.<vehicleId>` (≤200 ids, ids ≤400 chars), synchronised across tabs via the `storage` event, malformed storage ignored; a group dismissal also dismisses its member occurrences. `src/hooks/useSpotlight.ts:15-43`, `src/lib/home/spotlight.ts:117-122`. Covered: `e2e/design-v2-home.spec.ts` (survives reload; new occurrence reappears), `src/lib/home/presentation.test.ts` ("handles malformed storage…").
14. At most 4 visible items, sticky ones always kept. `spotlight.ts:113-115`. Covered: `src/lib/home/presentation.test.ts` ("…caps after dismissals").
15. Priority order: rejected/unknown writes → documents (urgent first) → date reminders / mileage reminders / grouped reminders → paid-price insight → sustained consumption → personal best → official price → previous-month summary. `spotlight.ts:52-111`. Covered: `src/lib/home/presentation.test.ts` ("keeps document expiry after rejected writes…", "orders real attention, reminder, best, price and month items…").
16. Rejected write item (sticky, danger): title "שמירות דורשות בדיקה" (outbox storage unknown) / "שמירה אחת דורשת בדיקה" / "N שמירות דורשות בדיקה"; body "לא ניתן לאמת את תור השמירות במכשיר." or "הפרטים נשמרו במכשיר. אפשר לבדוק ולנסות שוב."; opens `/settings/unsynced`. `spotlight.ts:55-61`. Covered: `e2e/design-v2-home.spec.ts` ("a server-rejected write has the first sticky spotlight and retries…"), `presentation.test.ts`.
17. Mileage reminder (only when last mileage is unambiguous and ≤30 days old, plan active, not completed, ≤500 km to go): "<plan> בעוד N ק״מ" / "<plan>: עכשיו" / "<plan>: הגיע הזמן", body "לפי הקילומטראז׳ האחרון שנרשם.", opens `/vehicle/reminders/<id>`. `spotlight.ts:63-76`. Covered: `presentation.test.ts` ("does not manufacture a reminder from ambiguous, stale or already completed mileage").
18. Date reminders due ≤30 days: title "<plan> · המועד עבר|היום|מחר|בעוד N ימים", body "המועד שנקבע: <day>" (+ mileage card title); <7 days → danger + sticky. `src/lib/home/groupedReminders.ts:45-62`. Covered: `src/lib/home/groupedReminders.test.ts`, `e2e/home-cost-insights.spec.ts` ("upcoming reminders group without duplicates…").
19. ≥2 non-urgent calendar items (documents + reminders) collapse into one card "N תזכורות ב-30 הימים הקרובים", body lists first 3 "<label>: <day>" + " · ועוד N", opens `/vehicle?tab=due`; urgent document survives an earlier group dismissal. `groupedReminders.ts:63-77`. Covered: `groupedReminders.test.ts`, `e2e/home-cost-insights.spec.ts`.
20. Vehicle documents (test, insurance) titles "<doc title> · <suffix>". `src/lib/vehicle/documentNotifications.ts:31,43`. Covered: `src/lib/vehicle/documentNotifications.test.ts`.
21. Paid-price insight: "שילמת כ-₪N פחות בתדלוק האחרון", body "<price> לליטר, לעומת <price> — המחיר המרבי לבנזין 95 בשירות עצמי מחוץ לאילת ביום התדלוק."; opens the exact receipt with owner/vehicle scope. `src/lib/home/paidPriceInsight.ts:84-85`. Covered: `src/lib/home/paidPriceInsight.test.ts`, `e2e/home-cost-insights.spec.ts`.
22. Sustained consumption: "N% יותר דלק לק״מ לאורך 3 מקטעים", body compares last 3 vs previous 3 segments; opens the measured segment. `src/lib/home/sustainedConsumption.ts:64-65`. Covered: `sustainedConsumption.test.ts`, `e2e/home-cost-insights.spec.ts`.
23. Personal best ("שיא אישי בצריכה", "<value> <unit> במקטע האחרון. הכי חסכוני עד היום.") only with ≥3 segments, complete history, last segment strictly best and not anomalous; opens SegmentSheet. `spotlight.ts:84-92`. Covered: `presentation.test.ts` ("uses canonical best efficiency in both units and never celebrates an anomalous result").
24. 95-only official price items: upcoming "בנזין 95 יוזל|יתייקר ב-₪X.XX לליטר" / "פורסם מחיר חדש לבנזין 95"; active "בנזין 95 ירד|עלה ב-…"; body with effective moment "(שעון ישראל)" and, only with trusted capacity, "בתדלוק של N ליטר לפי המחיר המרבי: כ-₪N פחות|יותר." / "…ההפרש קטן משקל."; opens price sheet. `src/lib/home/priceSpotlight.ts:6-35`. Covered: `src/lib/home/priceSpotlight.test.ts`, `e2e/official-price-notices.spec.ts`.
25. Previous-month summary only on days 1–7 of the month and complete history: "<month year> בסיכום", body "₪N דלק · N תדלוקים · ₪N טיפולים", with "סכום הדלק חלקי" / "עלות הטיפולים חלקית" when any cost unknown; opens `/stats?tab=spend&month=YYYY-MM`. `spotlight.ts:93-109`. Covered: `presentation.test.ts` ("limits month summaries to the first seven days…"), `e2e/design-v2-home.spec.ts` ("the monthly spotlight…").
26. Spotlight target dispatch: `segment` → SegmentSheet, `price` → price sheet, `route` → navigate. `Home.tsx:68-72`. Covered: `e2e/home-cost-insights.spec.ts`.

### Next refuel (TankHero) — card on Home

27. Rendered when there are fill-ups or observations and the estimate is available (not for unsupported fuel). `Home.tsx:93`, `TankHero.tsx:17-18`. Covered: `e2e/tank.spec.ts`.
28. Label "התדלוק הבא", or "הדלק עומד להיגמר" when level ≤ reserve. `TankHero.tsx:22,30`. Covered: `e2e/tank-pricing-followup.spec.ts` (learned fuel falls with time), partially.
29. Headline from engine passage: "היום" / "מחר" / "בעוד N ימים" / "מעבר לטווח התחזית" / "עוד לומדים מתי לתדלק"; unknown level → "כמה דלק יש עכשיו?" (small headline style for unknown/uncertain). `TankHero.tsx:31-33`, `TankPresentation.tsx:13-28`. Covered: `e2e/ui-review.spec.ts`, `e2e/tank.spec.ts`.
30. Known level → 20-tick gauge with habit marker (only if habit can be claimed or overridden), low style below reserve; caption "כ־N%" + " · כ־N ק״מ עד לרזרבה" when range > 0. `TankHero.tsx:34-40`, `DesignPrimitives.tsx:24-64`. Covered: `e2e/tank-pricing-followup.spec.ts` ("twenty gauge ticks track the chosen level").
31. Habit note: unknown → "הקישו כדי לסמן את מחוון הדלק."; override → "לפי ההעדפה שלך, תדלוק סביב N%."; learned → "בדרך כלל אתה מתדלק כשנשארים N%" (mixed → "בין N% ל־M%"); else "אחרי עוד כמה תדלוקים נלמד את ההרגל שלך.". `TankHero.tsx:42-47`, `TankPresentation.tsx:35-39`. Covered: `e2e/ui-review.spec.ts` (honest habit details).
32. Footer: basis "לפי המחוון שסימנת" / "הערכה מהטנק המלא האחרון" / "הערכה לפי העדכונים שלך" / "עדכון המחוון ישפר את ההערכה" (+ " · עודכן <ago>" for report-only), and "עדכון ›". `TankHero.tsx:48`, `TankPresentation.tsx:41-53`. Covered: `e2e/ui-review.spec.ts`.
33. Tap opens the tank sheet at "summary" (known level) or "gauge" (unknown). `TankHero.tsx:29`. Covered: `e2e/design-v2-home.spec.ts` (sheet states), `e2e/tank.spec.ts`.

### Consumption block

34. Shown only with ≥1 fill-up. Label "צריכה בתדלוק האחרון" (has a measured segment) else "צריכה". `Home.tsx:94-96`. Covered: `e2e/design-v2-home.spec.ts`, `e2e/mobile-regressions.spec.ts` ("home labels measured consumption intervals…").
35. ⓘ icon button `aria-label="פרטי מדידת הצריכה"` opens the measurement sheet (ConsumptionDetails). `Home.tsx:97-98,138`. Covered: `e2e/design-v2-home.spec.ts` (sheet states).
36. The reading is a button (accessible name "פרטי המקטע האחרון" + value) opening SegmentSheet for the last segment; value in user units (km/L or L/100) long form. `Home.tsx:101-104`. Covered: `e2e/design-v2-home.spec.ts:98` ("Home sparkline uses the last six canonical intervals…").
37. Comparison vs. average: "בדיוק כמו הרגיל שלך" or "N% יותר|פחות דלק לק״מ מהרגיל שלך (<avg>)", tone better/worse/neutral, currently inside a `Pill`. `src/components/home/ConsumptionComparison.tsx:9-17`. Covered: `e2e/design-v2-home.spec.ts:98`.
38. Sparkline: last 6 canonical segments, newest at the RTL start, one smooth island path, usual band ±7 % of average, last dot r=6.5 toned, value label above **every** point and a date label under **every** point, legend "הטווח הרגיל שלך, סביב X" + "התדלוק האחרון"; each point is a button "<date>, <value> <unit> — פרטי המקטע" opening SegmentSheet; SVG `<title>` lists all points. `src/components/ConsumptionSparkline.tsx:16-65`. Covered: `e2e/design-v2-home.spec.ts:98-157`, `src/components/ConsumptionSparkline.test.ts`.
39. No measured segment yet → open-segment empty state: "עוד תדלוק מלא אחד ונדע" + 50 % progress + "נקודת ההתחלה נשמרה. אחרי נסיעה ותדלוק נוסף עד הסוף נחשב את הצריכה."; or "מתחילים בתדלוק עד הסוף" + 10 % + "התדלוקים נשמרו. למדידת צריכה צריך שני תדלוקים עד הסוף.". `Home.tsx:108-113`. Covered: `e2e/design-v2-home.spec.ts:264`, `e2e/consumption.spec.ts`.
40. A missing partial cost never becomes a complete segment cost or monthly total. Covered: `e2e/design-v2-home.spec.ts:158`.

### TCO card ("הרכב עולה לך")

41. Hidden with no active vehicle or no fill-ups. `TcoBlock.tsx:34`. Covered: `e2e/tco.spec.ts` ("…stays absent for an empty vehicle").
42. Label "הרכב עולה לך" (complete) / "הרכב עולה לך, לפחות" (lower bound) / "עלות הרכב לפי הרישומים"; missing badge "חסר <label>" or "חסר N פריטים". `TcoBlock.tsx:37-45`. Covered: `e2e/tco.spec.ts` ("a missing insurance cost…").
43. Number = monthly TCO + "בחודש" (no toggle on the card); sub-line "כ־₪N בשנה" or "ממתינים לעלות מתועדת", plus " · ₪X.XX לכל ק״מ" when per-km known. `TcoBlock.tsx:46-48`. Covered: `e2e/tco.spec.ts`, `src/lib/tco.test.ts`.
44. Stacked bar of every part with known value > 0; colours today: fuel `--accent`, service `--ink`, mandatory `--ink-2`, coverage `--ink-3`, test `--better`, other `--surface-2`. `TcoBlock.tsx:18-21,49-51`. Covered: `e2e/tco.spec.ts` (responsive).
45. Legend shows only the **first 4** parts in engine order (not sorted by value). `TcoBlock.tsx:52-54`. Uncovered (no assertion on count/order).
46. Card is one button (`aria-label="כמה הרכב עולה לך"`, haspopup dialog) opening the TCO sheet: Segmented בחודש/בשנה (only inside the sheet), total, note "ממוצע על N החודשים האחרונים. ביטוח, טסט ואגרה מחולקים ל־12 חודשים.", one row per part (missing doc parts "לא הוזן. הקישו להוספה" open the document dialog; others "הנתונים עדיין אינם מלאים או מאושרים"), fuel/service/other rows navigate to Journal with matching filter and window, per-km duo "כל ק״מ עולה לך (באמת|לפחות)" and fuel share, plus CostCommunity. `TcoBlock.tsx:40-101`. Covered: `e2e/tco.spec.ts` (all four flows), `e2e/cost-community.spec.ts`, `e2e/input-live-update.spec.ts`.
47. Fixed invoices deduplicated, annual costs ÷12, Home and Insights agree. Covered: `e2e/tco.spec.ts` ("TCO totals deduplicate fixed invoices…"), `src/lib/tco.test.ts`.

### Trio (three KPI cells)

48. "נוסע ביום": value when km/day ≥ 0.5, else "—"; caption "כ־N בחודש" / "פחות מקילומטר ביום" / "אחרי כמה רישומים"; tap → `/vehicle`. `Home.tsx:117-121`. Covered: `e2e/design-v2-home.spec.ts:264` ("—").
49. "דלק <current month short>": this month's fuel spend or "—" (no fallback to the previous month with data); caption "בד״כ ₪N" (monthly fuel part) or "אין ממוצע מלא"; tap → `/stats?tab=spend`. `Home.tsx:122-126`. Covered: `e2e/design-v2-home.spec.ts:158,264`.
50. Fuel price cell (`home-fuel-price`): label "95 היום" / "מחיר 95" / "מחירון 98|סולר" / "מחיר הדלק"; value per-litre with 2 decimals or "—"; caption "לא ידוע" / "מחירון אחרון" / "מחירון הרשת" / "מחיר אחרון" / "הוזן ידנית" / "לפני ההנחה" / "מחיר מרבי" / "מחיר שנשמר". `src/components/home/HomeFuelPrice.tsx:41-59`. Covered: `e2e/design-v2-home.spec.ts:280` ("Home price sheets stay fuel-specific…").
51. Price sheet: fuel name title; regulated note "מחיר מרבי מפוקח · שירות עצמי"; "בתוקף מ-<moment> (שעון ישראל)"; "עודכן <date>"; Energy-ministry link; upcoming price section "עדכון מחיר שפורסם" with effective/published/checked lines; "אחרי ההנחה שלך: ₪X.XX"; 6-month official price history chart (2-decimal labels); 95 note + "יש לך הנחה בתדלוק?" / "עריכת ההנחה" → FuelDiscountSheet. `HomeFuelPrice.tsx:61-101,104-121`. Covered: `e2e/design-v2-home.spec.ts:280`, `e2e/official-price-notices.spec.ts`, `e2e/tank-pricing-followup.spec.ts` (discount persists), `src/lib/home/presentation.test.ts` (history evidence).
52. 98/diesel market price: "מחירון דלק · שירות מלא · מחוץ לאילת", "המחירון בתוקף מ-…", "מחירון הרשת; המחיר ששולם בתחנה עשוי להיות שונה.", link "למחירון הרשת", failure "הרענון לא הצליח; מוצג המחיר האחרון שנקרא." / "המחירון אינו זמין כרגע.", stale "מחירון ישן; ממתינים לעדכון מאומת.", button "רענון מחירון" / "בודקים מחירון…". `HomeFuelPrice.tsx:28-31,65-69,89-97`. Covered: `e2e/design-v2-home.spec.ts:280`, `e2e/mobile-fuel-release.spec.ts`, `src/lib/mobileFuel.test.ts`.

### Recent

53. "לאחרונה" shows up to **3** ledger rows dated ≤ today (fuel, service, expense), link "כל היומן" → `/history`. `Home.tsx:59,129-130`. Covered: `e2e/design-v2-home.spec.ts:189` ("the three recent records and Journal share refund, unknown cost and quiet odometer rows").
54. Each row: per-segment km/L for fuel, pending (outbox pending) and attention (failed/conflict) states, flagged (anomaly for fuel, service mileage warning for services); tap → `/history?entry=<key>&owner=<uid>&vehicle=<id>` opening the entry sheet. `Home.tsx:63-66,73-76,131-134`. Covered: `e2e/design-v2-home.spec.ts:189,228`.

## §6 cross-check (items whose surface is Home)

| §6 item | Status | Evidence |
|---|---|---|
| Spotlight (v2, "unchanged") | present | items 9–26 |
| Spotlight: rejected write | present | item 16 (`spotlight.ts:55`) |
| Spotlight: reminder due by date | present | item 18 (`groupedReminders.ts:45`) — v3 lists it as "new" but production already has it |
| Spotlight: "כדאי לתדלק לפני הנסיעה" (planned trip) | **missing-in-production** as a spotlight item | the copy exists only as a tank-sheet subtitle (`TankSheets.tsx:158`, `estimate.tripPullsForward`); no spotlight derivation uses `tripPullsForward` |
| Measurement sheet from ⓘ | present | item 35 (details in `tank-sheets.md`) |
| Tank confirmed/estimate on Home | present | items 30–32 |
| "A month with no purchases shows previous month with data" (§5) | missing-in-production | item 49 uses the current month only, shows "—" |
| Fuel price 2 decimals | present | items 50–51 |

## v3 changes to this screen (from DESIGN-V3 §1–§5)

May change:
- **Order** (§2): header → status line → spotlight → facts strip → TCO card → consumption → next-refuel → recent. Today TankHero and consumption sit **above** TCO and the trio (item 3); v3 moves next-refuel below consumption and TCO above both.
- **Status line** (§2.2, new): "הדלק נמוך · כדאי לתדלק היום" / "תדלוק בעוד N ימים · במיכל כ-X%" / "הכל תקין · הטסט בתוקף עד <date>". Must be derived from the same `useTankEstimate` and document data; nothing stored.
- **Spotlight**: titles shortened to one line; add the planned-trip item (needs a new derivation from `estimate.tripPullsForward`/`recommendedRefuel`); reminder-by-date and rejected-write already exist — keep their priority, stickiness and dismissal rules.
- **Facts strip** (§3) replaces the trio: נוסע ביום · דלק ב<month with data> · בנזין 95 היום (EV: נוסע ביום · חשמל ב<month> · חשמל ל-100 ק״מ). Keep each row's tap target (items 48–50) and the price sheet; implement "previous month with data" (§5) instead of "—".
- **TCO card**: becomes the single hero at 64px; "בחודש ⇅" chip toggles month/year on the card itself (number, legend, sub-line); **all** non-zero parts in the legend sorted by value (today: first 4, engine order); §4 category colours (today: greys `--ink-2/--ink-3/--surface-2` and `--better` for test); "לק״מ" not "לכל ק״מ" (TcoBlock.tsx:48).
- **Money format** (§5): "777 ₪" (number, narrow NBSP, ₪). Today e2e asserts "₪910"/"₪340"/"₪810" (`e2e/input-live-update.spec.ts:118`, `e2e/helpers/tco.ts:80,90`) and per-km uses a local `₪${num(..,2)}` (TcoBlock.tsx:48,93), which also violates AGENTS.md; those tests may be updated in Stage 1 only for the symbol position.
- **Consumption**: 56px; values above every point, dates only at the two ends, no legend, caption split "6 תדלוקים אחרונים" / "הרגיל שלך 12.0"; comparison as coloured text without the Pill. Points stay buttons → SegmentSheet; usual band, last-6 rule and units conversion must stay.
- **Next refuel**: light card (no ink slab), 44px headline, labelled habit line "כאן בד״כ מתדלקים", darker ticks between habit and current level, caption "במיכל כ-67% · כ-364 ק״מ", footer basis + "עדכון ›".
- **Recent**: two rows (today 3) + "היומן המלא ›" (today "כל היומן"). Row states (pending/attention/flagged/refund/unknown) must stay.
- Size hierarchy cost 64 > consumption 56 > next-refuel 44 is a test assertion.
- Tone: Karantina 400, hairlines, radius scale, card shadow, 34px block rhythm, accent `#F3C54B`.

Must not change:
- All empty/incomplete/no-vehicle states (items 4–8, 39) and the "never invent ₪0" rule.
- Spotlight logic (priority, 4-item cap, sticky, per-account/vehicle dismissal storage, 7 s auto-advance with reduced-motion and interaction stop).
- Every sheet entry point (tank summary/gauge, segment, measurement, price, TCO sheet and its rows → Journal/doc dialog).
- Home key-by-vehicle remount; recent-row deep link carries owner and vehicle.
- No derived value stored; TCO, per-km, forecasts come from `useTco`/`useTankEstimate`/`useStats`.
