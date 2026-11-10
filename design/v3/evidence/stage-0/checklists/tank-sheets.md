# Tank sheets — current behaviour checklist (baseline `05548ba`)

Covers the Home tank sheet ("מה יש במיכל") and its nested sheets (gauge observation, odometer, planned trip, preferences, habit reset), the capacity confirmation, and the two consumption sheets opened from Home/Insights/Journal: measurement sheet (`ConsumptionDetails`) and segment sheet (`SegmentSheet`). The fill-up form's own tank section and its capacity warning are in `fillup.md`; the Vehicle tab's embedded preferences (`TankPreferencesSection`) reuse the same controls and are listed in `vehicle.md`.

## Sources

- `src/components/tank/TankSheets.tsx`, `TankObservationSheets.tsx`, `TankTripSheet.tsx`, `TankPreferenceControls.tsx`, `TankCapacityConfirm.tsx`, `TankPresentation.tsx`, `types.ts`
- `src/components/TankPreferencesSection.tsx` (Vehicle wrapper of the same controls)
- `src/components/DesignPrimitives.tsx` (`Gauge`, `GroupRow`), `src/lib/tank/gaugeInteraction.ts`
- `src/components/home/ConsumptionDetails.tsx`, `src/components/home/SegmentSheet.tsx`, `src/lib/home/presentation.ts` (`segmentContributors`)
- `src/hooks/useTankEstimate.ts`, `src/lib/tank/copy.ts`, `capacity.ts`, `balance.ts`, `forecast.ts`, `index.ts`
- `src/context/DataContext.tsx` (`addObservation`, `addPlan`, `deletePlan`, `updateTankPreferences`, `updateVehicle`), `firestore.rules:437-472`
- Tests: `e2e/design-v2-home.spec.ts` (sheet state screenshots and navigation, ~l.478-590), `e2e/tank.spec.ts`, `e2e/ui-review.spec.ts`, `e2e/audit-fixes.spec.ts` (F06, F07, F13/F14), `e2e/tank-pricing-followup.spec.ts`, `e2e/mobile-fuel-release.spec.ts`, `e2e/consumption.spec.ts`, `src/lib/tank/tank.test.ts`, `outcome.test.ts`, `liveProjection.test.ts`, `inputScope.test.ts`, `src/lib/home/presentation.test.ts`

## Behaviours

### Tank sheet session ("מה יש במיכל")

1. Sheet renders only when an entry is requested, a vehicle is active and the estimate is available; it is keyed by `uid/vehicleId` so an account/vehicle switch starts a fresh editor. `TankSheets.tsx:27-32`. Covered: `e2e/design-v2-home.spec.ts` (sheet states).
2. Entry mode is `summary` (known level) or `gauge` (unknown level / "עדכון המחוון"); exposed as `data-entry`. `TankSheets.tsx:76`, `TankHero.tsx:29`. Covered: `e2e/design-v2-home.spec.ts`, `e2e/tank.spec.ts` ("a new Home has … a direct gauge action").
3. Intro note: unknown → "עוד אין נקודת התחלה עדכנית. סמנו את כמות הדלק שמופיעה במחוון ברכב."; known → "<basis>. מסתכלים על המחוון ברכב? הקישו על המקום המתאים." `TankSheets.tsx:77-78`. Covered: `e2e/ui-review.spec.ts`.
4. Forecast rows (known level only): "מתי תרצה לתדלק" (passage; subtitle "לפי ההעדפה שלך: כשנשארים N%" / "לפי ההרגל שלך: כשנשארים N%" / "עוד לומדים את ההרגלים שלך"), "מתי כדאי לתדלק לכל המאוחר" (subtitle "כדאי לתדלק לפני הנסיעה המתוכננת" when a trip pulls the date forward, else "לפני שיורדים מתחת ל־N%, הרזרבה"), "טווח משוער" / "עד לרזרבה" (km or "לא ידוע"). Passage ranges render "בעוד A–B ימים" as one LTR island. `TankSheets.tsx:151-162`, `TankPresentation.tsx:13-28`. Covered: `e2e/design-v2-home.spec.ts` (`tank-recommended`, `tank-range` visible); trip subtitle uncovered in e2e, engine covered by `src/lib/tank/tank.test.ts` (trip tests l.718-735).
5. Assumptions line: "לפי הצריכה שנמדדה: X" / "לפי נתון הצריכה של הרכב: X" / "עוד אין נתון צריכה." + "נסיעה יומית משוערת: כ־N ק״מ." / "עוד אין קצב נסיעה יומי." `TankSheets.tsx:164-172`. Covered: `e2e/ui-review.spec.ts` (partially).
6. Engine warning note (primary active note) with action "בדיקת המחוון" that focuses the gauge range input. `TankSheets.tsx:84-85,54-56`. Covered: `e2e/tank-pricing-followup.spec.ts` ("correction clears the warning").
7. "משלים מפרט רכב…" status while vehicle enrichment runs. `TankSheets.tsx:90`. Uncovered.
8. Nested entries: "עדכון קילומטראז׳" (subtitle "אחרון: N ק״מ · <ago>" or "קריאה מלוח הקילומטרים, בלי תדלוק") and "יש לי נסיעה מתוכננת" ("הנסיעה תשפיע על התחזית"). `TankSheets.tsx:92-98,146-147`. Covered: `e2e/design-v2-home.spec.ts` (opens each and returns focus), `e2e/tank.spec.ts` ("an odometer update is a reading, not a fill-up").
9. Next-update prompt (not for none/updateGauge/updateOdometer, nor confirmCapacity when a capacity suggestion is offered): titles "מה נפח המיכל של הרכב?" (link "הוספת נפח מיכל" → `/vehicle?tab=details`), "סימון תדלוק עד הסוף משפר את חישוב הצריכה" / "בתדלוק הבא, כמה נשאר לפני שמילאתם?" ("הבנתי"), plus "לא עכשיו"; dismissal stored per vehicle in localStorage. `TankSheets.tsx:49-51,115-121`, `src/lib/tank/copy.ts:42-64`, `src/hooks/useTankEstimate.ts:168-179`. Uncovered in e2e.
10. "על מה מבוססת ההערכה" `<details>`: "אחרי התדלוק האחרון" (level · date or "לא צוין"), "הסימון האחרון" (level · ago or "עדיין אין"), "כמות רגילה" (fill-style sentence), mileage precision note, live-update line ("מתעדכן לפי השימוש שנלמד · כ־N ק״מ משוערים מאז העדכון" / "לפי העדכון האחרון · עוד נסיעות יאפשרו עדכון אוטומטי"), one line per engine reason (REASON_TEXT, "מד הדלק"→"מחוון הדלק"; untrusted capacity → "נפח המיכל משוער. אישור שלו ישפר את ההערכה."), and the closing caveat "הטווחים הם הערכה לפי העדכונים שלך, בהנחה שלא היו תדלוקים שלא נרשמו." `TankSheets.tsx:123-143`, `copy.ts:18-39`. Covered: `e2e/design-v2-home.spec.ts` (opens details), `e2e/ui-review.spec.ts` ("moves measured mileage and honest habit details into its sheet").

### Gauge observation editor (inside the tank sheet)

11. 20-tick gauge, editable range 0–1 step 0.05, keyboard operable (arrows/Home/End via `levelFromKey`), tap on an existing endpoint still counts; label "כמה דלק יש עכשיו במיכל"; habit marker when claimable/overridden. `TankObservationSheets.tsx:78-82`, `DesignPrimitives.tsx:24-64`. Covered: `e2e/tank.spec.ts` (§16.15.10 drag, §16.15.9 keyboard), `e2e/tank-pricing-followup.spec.ts`.
12. Initial level = displayed estimate snapped, but the estimate is **not evidence**: "עדכון המחוון" stays disabled until the user interacts. `TankObservationSheets.tsx:30-34,52,90`. Covered: `e2e/ui-review.spec.ts` ("optional tank controls never choose an endpoint").
13. Reading "כ־N%" and, with capacity, "כ־N ליטר" (+ " לפי נפח משוער" when untrusted). `TankObservationSheets.tsx:82-83`. Covered: `e2e/tank-pricing-followup.spec.ts`.
14. Optional odometer "קילומטראז׳ (לא חובה)": integer, >0, <3,000,000 and not lower than the last reading; error "הזינו קילומטראז׳ שלם שאינו נמוך מהקריאה האחרונה". `TankObservationSheets.tsx:39-42,86-88`. Covered: `e2e/audit-fixes.spec.ts` ("F06: both tank editors preserve grouped odometers and reject a backward reading").
15. Save writes one observation (`kind` level|both, `levelSource: direct-gauge`, `confirmed: true`, `phase: standalone`) and closes the sheet; failure keeps input: "העדכון לא נשמר. הפרטים שהקלדת נשארו כאן, ואפשר לנסות שוב."; writes are scope-guarded against account/vehicle switch. `TankObservationSheets.tsx:51-76`. Covered: `e2e/tank.spec.ts`, `e2e/mobile-fuel-release.spec.ts`; scope guard `src/lib/tank/inputScope.test.ts`.

### Odometer sheet ("עדכון קילומטראז׳")

16. Big field "קילומטראז׳ נוכחי", same validation and error text as item 14; hint "אחרון: N · <ago>" or "המספר שמופיע בלוח הקילומטרים. העדכון אינו תדלוק."; saves an `odometer` observation (no litres/spend); failure "העדכון לא נשמר. אפשר לנסות שוב בלי להקליד מחדש." `TankObservationSheets.tsx:96-137`. Covered: `e2e/tank.spec.ts` ("an odometer update is a reading, not a fill-up"), `e2e/audit-fixes.spec.ts` (F06).

### Planned trips

17. Trip sheet "נסיעה מתוכננת": "מרחק צפוי" (km, required >0), "מרווח ביטחון (לא חובה)" (km), "מתי" segmented: היום / מחר (default) / בעוד 3 ימים / בעוד שבוע; "הנסיעה היא": "בנוסף לנהיגה הרגילה" (default) / "במקום הנהיגה הרגילה"; note "הנסיעה משנה את התחזית בלבד. היא לא מתווספת לקילומטראז׳ או לדלק שנצרך."; "שמירה" disabled until distance valid; failure "השמירה לא הושלמה. נסו שוב.". **No custom date picker** and no note input. `TankTripSheet.tsx:18-93`. Covered: open/focus only in `e2e/design-v2-home.spec.ts`; save path uncovered in e2e; engine effects covered in `src/lib/tank/tank.test.ts` ("does not consume a newly planned trip before it happens", "§15.11: a replacement trip does not add the routine it replaces").
18. Saved plan date = local day + N in `DEFAULT_TIME_ZONE`; buffer stored only if >0 else `null`. `TankTripSheet.tsx:54-59`. Uncovered.
19. List "נסיעות מתוכננות": "<day> · N ק״מ", "במקום/בנוסף לנהיגה הרגילה" + " · מרווח N ק״מ", optional note (from data); delete "מחיקה" / "מוחקים…" with aria-label "מחיקת הנסיעה ב־<day>", all deletes disabled while one runs; failure "בקשת המחיקה לא נשמרה. אפשר לנסות שוב.". `TankSheets.tsx:58-72,100-111`. Uncovered.

### Preferences ("העדפות מיכל")

20. Section rows: "רזרבה — מתי להתריע" (value "כ־N%"), "מתי נוח לתדלק" (value "N% · ידני" / "N% · נלמד" / "עוד לומדים"), toggle "התאמה אישית אוטומטית" (on = no override; turning on clears the override, turning off opens the habit editor), "איפוס פרופיל ההרגלים" ("התדלוקים נשמרים — רק הלמידה מתחילה מחדש"). `TankPreferenceControls.tsx:42-61`. Covered: `e2e/design-v2-home.spec.ts` (opens reserve/habit/reset), `e2e/ui-review.spec.ts` ("עוד לומדים").
21. Reserve editor "רזרבה": "הרמה שממנה כדאי לתדלק. זו העדפה שלך, ולא נפח הרזרבה של היצרן או נורית הדלק." Gauge 0–100 % step 5; default 25 %. UI does **not** clamp to 10–25 %; Firestore rule accepts 5–90 % (`firestore.rules:437-439`), engine clamps 0–90 % (`forecast.ts:352`). `TankPreferenceControls.tsx:63-66`, `src/lib/tank/types.ts:129`. Covered: `src/lib/tank/tank.test.ts` ("§15.5: a learned habit never lowers the configured reserve"); UI save uncovered.
22. Habit editor "מתי לתדלק": "קביעה ידנית מחליפה את ההרגל שנלמד. אפשר לחזור ללמידה אוטומטית בכל רגע." initial = override or learned typical level; saves `refuelLevelOverride`. `TankPreferenceControls.tsx:67-70`. Covered: `src/lib/tank/tank.test.ts` ("an explicit override is a preference, not a measured habit"); UI save uncovered.
23. Preference save failure keeps selection: "ההעדפה לא נשמרה. הבחירה נשארה כאן, ואפשר לנסות שוב." / "ההעדפה לא נשמרה. אפשר לנסות שוב.". `TankPreferenceControls.tsx:34,98`. Uncovered.
24. Reset confirm (alertdialog) "לאפס את פרופיל ההרגלים?" / "הלמידה של הרגלי התדלוק תתחיל מחדש. התדלוקים, ההוצאות והצריכה נשארים כפי שהם." confirm "איפוס" / "מאפסים…"; writes `habitResetAt: now`; failure "בקשת האיפוס לא נשמרה. אפשר לנסות שוב.". `TankPreferenceControls.tsx:116-146`. Covered: `e2e/design-v2-home.spec.ts` (dialog visible), `src/lib/tank/tank.test.ts` ("§9.4: resetting the profile drops the habit and keeps every fill-up").
25. Same controls embedded on Vehicle (no section title). `TankPreferencesSection.tsx:11`, `TankPreferenceControls.tsx:59`. See `vehicle.md`.

### Capacity confirm

26. Shown when capacity is untrusted and the engine has a suggestion: "נפח המיכל המשוער" + "N ליטר" + note (capacitySuspect "לפי התדלוקים, נפח המיכל כנראה גדול מההערכה — כדאי לאשר אותו", or "נפח המיכל הוא הערכה לפי סוג הרכב" / "נפח המיכל מוערך לפי התדלוק הגדול ביותר שלך"); buttons "מאשר" and "תיקון" (→ `/vehicle?tab=details`). Host stays mounted during the optimistic update. `TankSheets.tsx:46-48,87-89`, `TankCapacityConfirm.tsx:55-70`, `src/lib/tank/capacity.ts:135-144`, `copy.ts:37`. Covered: `e2e/design-v2-home.spec.ts` (`tank-capacity-confirm` visible).
27. "מאשר" writes `tankLiters` + `tankLitersSource: "user"`; toast "נפח המיכל אושר" only after server settle, otherwise "נפח המיכל לא אושר בשרת" / "נסו שוב או פתחו את השינויים שעוד לא עלו לענן."; never claims success on rejection; retry possible. `TankCapacityConfirm.tsx:26-53`. Covered: `e2e/audit-fixes.spec.ts` ("F07: a rejected tank-capacity confirmation never claims success and retries").

### Measurement sheet ("מדידת הצריכה", from Home ⓘ)

28. Average consumption (long units), note "הממוצע שלך, לפי המרחק בכל מקטע שנמדד." or "לפי הרישומים הזמינים. חלק מהיסטוריית התדלוקים אינו זמין." `ConsumptionDetails.tsx:12-13`. Covered: `e2e/design-v2-home.spec.ts` (opens `consumption-details-open`), `e2e/mobile-regressions.spec.ts` (average label).
29. Rows "מקטעים שנמדדו" (segment count) and "תדלוקים שנרשמו" (fill-up count). **No full-fill count and no restart count** here. `ConsumptionDetails.tsx:14-17`. Covered: `e2e/consumption.spec.ts` (counts after baseline/partials).
30. "המקטע הפתוח": "ליטרים שממתינים לחישוב" (1 decimal), "תדלוקים שממתינים לחישוב", "מרחק שנרשם" (only with baseline); explanation "התדלוק הבא עד הסוף יסגור את המקטע…" / "נקודת ההתחלה נשמרה. מקטע ייסגר אחרי נסיעה ותדלוק נוסף עד הסוף." / "צריכה נמדדת בין שני תדלוקים עד הסוף…". `ConsumptionDetails.tsx:18-27`. Covered: `e2e/consumption.spec.ts` ("multiple partials accumulate into the open segment").

### Segment sheet (Home, Insights, Journal)

31. Title "<start> – <end>" (day-month), consumption (long) + comparison; rows "מרחק", "דלק" (1 decimal, subtitle "תדלוקים נוספים במקטע: N"), "עלות" (whole ₪ or "—"), "עלות לק״מ" ("N אג׳ לק״מ" or "—"), "תדלוקים שנכללו", "נסגר בתדלוק" (station or "ללא מיקום", date; tap closes and opens `/fillup/<id>`). `SegmentSheet.tsx:20-36`. Covered: `e2e/design-v2-home.spec.ts:98` (`segment-distance`), `e2e/design-v2-insights.spec.ts`, `e2e/design-v2-journal.spec.ts`.
32. Cost known only when every contributing fill (excluding the opening tank) has a cost; else "חסר סכום באחד התדלוקים. עלות המקטע אינה ידועה במלואה." `SegmentSheet.tsx:37`, `src/lib/home/presentation.ts:7-13`. Covered: `src/lib/home/presentation.test.ts`, `e2e/design-v2-home.spec.ts:158`.
33. Re-resolves the segment by `endId` after edits/imports; stale → "המקטע אינו זמין יותר. החישוב השתנה עם הרשומות." Explanation "מקטע נמדד בין שני תדלוקים עד הסוף: …". `SegmentSheet.tsx:10-16,38-39`. Covered: `e2e/consumption.spec.ts` ("editing, deleting and backdating recompute the result"), partially.

### Cross-cutting

34. All sheets return focus to their opener on close (tank hero, `tank-open-*` rows). Covered: `e2e/design-v2-home.spec.ts` (`toBeFocused`), `e2e/audit-fixes.spec.ts` (F13/F14).
35. Every write is guarded by `useAccountScope`: a result arriving after an account/vehicle switch is ignored and never closes/updates the new scope. All sheet files. Covered: `src/lib/tank/inputScope.test.ts`, `e2e/audit-fixes.spec.ts`.

## §6 cross-check

| §6 item | Status | Evidence |
|---|---|---|
| Tank sheet: observation ticks | present | items 11–15 |
| Planned trips: today/tomorrow/3 days/week | present | item 17 |
| Planned trips: **date** (custom) | **missing-in-production** | `TankTripSheet.tsx:15,18-23` only offers 0/1/3/7 days |
| Planned trips: km; extra vs instead; margin | present | items 17–19 |
| Preferences: reserve **10–25%** | **partial** | editable reserve exists but range is 0–100 % in UI, 5–90 % in rules; no 10–25 % limit anywhere (item 21) |
| Preferences: target learned vs manual | present | items 20, 22 |
| Preferences: reset habit profile | present | item 24 |
| "על מה מבוססת ההערכה" | present | item 10 |
| Capacity confirm | present | items 26–27 |
| Measurement sheet: fills, segments, km, pending litres, open segment | present | items 28–30 |
| Measurement sheet: **full** (count of full fills) | **missing-in-production** | `ConsumptionDetails.tsx` has no full-fill row |
| Measurement sheet: **restarts** | **missing-in-production** in this sheet | restarts (`stats.breakCount`) are shown only on Insights (`ConsumptionInsights.tsx:85`) |
| Fill-up capacity check "נראה שנפח המיכל גדול מההערכה" → confirm sheet | present (fill-up side) | `TankStateSection.tsx:350`, `FillupMore.tsx:120`; see `fillup.md` |

## v3 changes to these sheets (from DESIGN-V3 §1, §3, §4 and PROMPT Stage 4)

May change:
- Look only: Karantina 400 titles, hairline `--line` rows instead of v2 group borders, radius 20/14/10, sheet radius 20, accent `#F3C54B`; layout per `proto/more.js` / `sheets.js`.
- Measurement sheet and segment details may use the facts strip (§3: "measurement details"); adding the missing full-fill and restart rows is required by §6 parity.
- Trip sheet: add the custom date option (§6 lists it) without changing how the plan feeds the forecast.
- Reserve editor: if the 10–25 % range is adopted, it is a product decision (rules currently allow 5–90 %); flag to the coordinator rather than silently narrowing stored values.
- The Home gauge's darker "to-habit" ticks and labelled habit line (§2.7) apply to the hero; the editable gauge in the sheet may adopt the same visual.

Must not change:
- An estimate is never saved as evidence without a user interaction (item 12); odometer validation and texts (items 14, 16).
- Trip notes: plans change the forecast only, never mileage or consumption.
- Capacity confirmation never claims success before server settlement (item 27).
- Preference/reset/delete failures keep the user's input and show the existing error copy.
- Scope guards, focus return, `data-testid`s used by the e2e suites listed above.
- Segment cost honesty (item 32) and stale-segment handling (item 33).
- Nothing derived (forecast, range, habit, consumption) is stored.
