# Journal (יומן) — Stage 0 behaviour checklist

Baseline: `main` @ `05548ba`. Route `/history`. Every item below is current production behaviour and is the acceptance list for any v3 change to this screen.

## Sources

- `src/screens/History.tsx` (screen, filters, summary, add menu, delete + undo toast)
- `src/components/JournalEntryRow.tsx` (row, also used by Home "לאחרונה")
- `src/components/journal/EntrySheet.tsx` (entry receipt sheet)
- `src/lib/journal/presentation.ts` (end-state labels, gauge labels, service mileage warning)
- `src/components/PeriodPicker.tsx`, `src/lib/periods.ts` (period choices and range labels)
- `src/lib/vehicle/financial.ts` (`financialTotals`, the single totals rule)
- `src/components/home/SegmentSheet.tsx` (segment sheet opened from an entry)
- Tests: `e2e/design-v2-journal.spec.ts`, `e2e/design-v2-journal-writes.spec.ts`, `e2e/design-v2-insights.spec.ts`, `e2e/design-v2-home.spec.ts`, `e2e/consumption.spec.ts`, `e2e/audit-fixes.spec.ts`, `e2e/cycle5.spec.ts`, `e2e/reliability.spec.ts`, `e2e/design-v2-foundation.spec.ts`, `e2e/tco.spec.ts`, `e2e/import.spec.ts`, `src/components/insights/presentation.test.ts`

## Behaviours

### Scope and routing
1. The screen is keyed by the vehicle scope; switching account/vehicle remounts it and drops local search, limit, selection and sheets. `src/screens/History.tsx:37-40`. Test: `e2e/design-v2-journal-writes.spec.ts` ("old observation deletion remains invalid after the active vehicle changes away and back").
2. Heading is "יומן"; the "הוספה" button (aria-label "הוספה ליומן", `aria-haspopup=dialog`) opens the sheet "מה להוסיף?". `History.tsx:159-162`, `238-249`. Test: `e2e/design-v2-journal.spec.ts` ("Journal Add records one multi-job invoice…").
3. Add sheet has four rows: "תדלוק" → `/fillup/new`; "טיפול" → care editor `serviceEvents`; "הוצאה" → `vehicleExpenses`; "עדכון ק״מ" → `odometerReadings`. Subtitles: "סכום, ליטרים וקילומטראז׳", "מוסך, צמיגים או תיקון", "ביטוח, טסט, חניה או החזר", "הקריאה בלוח הקילומטרים". `History.tsx:155-157`, `240-247`. Test: `e2e/design-v2-journal.spec.ts` (service + odometer paths); fuel path uncovered here.
4. URL `?owner=<uid>&vehicle=<id>&entry=<collection/id>` opens that entry's sheet only when owner and vehicle match the active scope; closing removes `entry/owner/vehicle` with `replace`. `History.tsx:92-93`, `101-108`. Test: `e2e/design-v2-journal.spec.ts` ("a Home fuel row opens its scoped Journal receipt…"), `e2e/home-cost-insights.spec.ts`.

### Period
5. Period picker (compact calendar trigger, label/aria "תקופת היומן") offers "כל התקופה", "החודש", "השנה", "3 חודשים", "6 חודשים", "12 חודשים"; URL `period=all|month|year|3m|6m|1y`; unknown values fall back to `all`. `History.tsx:32-34`, `56-57`, `168-173`. Test: `e2e/design-v2-journal.spec.ts` (theme evidence opens "תקופת היומן", Escape returns focus to the trigger).
6. `?year=YYYY` (from the vehicle year screen / RunningCosts) filters to 1 Jan–31 Dec and adds a picker option "שנת YYYY"; label "שנת YYYY". `History.tsx:58-59`, `64-68`, `172`; entry points `src/screens/VehicleDetails.tsx:23`, `src/components/RunningCosts.tsx:13`. Test: `e2e/tco.spec.ts` ("TCO component rows open the real Journal with its matching filter and time window"); year link uncovered by a dedicated journal assertion.
7. `?from=YYYY-MM-DD&to=YYYY-MM-DD` (valid and ordered) overrides period/year, adds option "התקופה שנבחרה", label "d.m.yy – d.m.yy". Used by Insights links and Home paid-price insight. `History.tsx:61-62`, `67`, `173`; `src/components/insights/presentation.ts:51-55`. Test: `e2e/design-v2-insights.spec.ts` (expense link → `ledger-total` "₪8"), `src/components/insights/presentation.test.ts` ("uses the same selected calendar days…").
8. Choosing a period clears `year/from/to`, resets the limit to 50 and re-anchors "now". `History.tsx:109-114`. Uncovered (behavioural assertion).
9. "כל התקופה" label reads "מתחילת הרישומים עד <today>". `History.tsx:67-68`. Test: `e2e/audit-fixes.spec.ts` (`ledger-range` contains a date).

### Kind filters
10. Chips (group aria-label "סוג רשומה", `aria-pressed`): "הכל", "תדלוקים", "טיפולים", "הוצאות", "ק״מ ומחוון"; URL `kind=`. The "ק״מ ומחוון" chip includes odometer readings **and** tank gauge observations. `History.tsx:28-31`, `73`, `175-179`. Test: `e2e/design-v2-journal.spec.ts` (counts 6/3/2/2 and totals per chip).
11. Legacy URL kinds `kind=issue` and `kind=tank` are honoured (no chip) and shown in the active-filter strip as "תקלות" / "סימוני מחוון". `History.tsx:35`, `55`, `184`. Uncovered.
12. `?plan=<id>` limits to service events that completed that reminder; strip shows "טיפולים שקושרו לתזכורת". Entry: `src/screens/VehicleDetails.tsx:53` ("היסטוריית הטיפולים"). `History.tsx:74`, `182`. Uncovered in journal specs.
13. When ≥1 anomaly-flagged fill-up is in the period, a warning button "תדלוקים שכדאי לבדוק <n>" sets `flagged=1&kind=fuel`; strip shows "תדלוקים לבדיקה". `History.tsx:69`, `75`, `99`, `183`, `187-190`. Uncovered.
14. Active-filter strip appears for period/year/range/plan/flagged/legacy kinds and has "ניקוי סינון" which clears query, limit and all params. `History.tsx:115-117`, `180-186`. Test: `e2e/design-v2-journal.spec.ts`.

### Search
15. Search field (aria "חיפוש ביומן", placeholder "חיפוש תחנה, טיפול או הערה", `dir=rtl`) matches title + notes + ISO day, case-insensitive (`he-IL`), and resets the limit to 50. `History.tsx:70`, `76`, `164-167`. Test: `e2e/design-v2-journal.spec.ts` ("שמן ובלמים" → 1 row, ₪123; month group without matches disappears).

### Grouping, rows and row states
16. Rows are grouped by month; heading = Hebrew month name, plus year only when not the current year. `History.tsx:82-87`, `208`. Test: `e2e/design-v2-journal.spec.ts` (`journal-month-<YYYY-MM>`).
17. Month header shows net known total (or "—" when every financial row is unknown) and "N תדלוק/תדלוקים". `History.tsx:212-216`. Test: `e2e/design-v2-journal.spec.ts` ("₪751", "₪816").
18. Month coverage line: "סכום ידוע · N עלות חסרה/עלויות חסרות" when the month has unknown costs. `History.tsx:218-220`. Uncovered (testid `journal-month-coverage-*` not asserted).
19. Fuel row: day number + short month, station brand mark, title, meta "<litres, 1 dp> ל׳ · <end label> · <segment consumption>". End labels: "מצב לא צוין", "חלקי", "מלא · הנחה ישנה", "עד הסוף", "מלא · הערכה". `JournalEntryRow.tsx:35-44`, `64-68`; `src/lib/journal/presentation.ts:7-14`. Test: `e2e/consumption.spec.ts` ("20.0 ל׳"), `e2e/design-v2-fillup.spec.ts`.
20. Care row meta: "טיפול" / "תקלה" / "החזר" / "הוצאה", "· <odometer> ק״מ" when recorded, "· יום בלבד" when no time. `JournalEntryRow.tsx:45-47`. Test: `e2e/design-v2-home.spec.ts` (Home rows reuse this component).
21. Quiet rows (odometer, tank gauge): "קילומטראז׳ עודכן ל־<n>" or "<gauge label>: <pct>"; gauge labels "מחוון דלק מייבוא", "מחוון דלק מחושב", "קריאת מחוון שלא אושרה", "סימנת מחוון דלק"; no ₪; ≥44px target. `JournalEntryRow.tsx:21`, `27-33`; `presentation.ts:17-22`. Test: `e2e/design-v2-journal.spec.ts` (odometer chip rows have no "₪" and class `tm-journal-quiet`; 44px), `e2e/design-v2-home.spec.ts`.
22. Row state "ממתין לאישור" when an outbox op for the row path is `pending`; "דורש בדיקה" when `failed`/`conflict` (attention wins). `History.tsx:88-90`, `224`; `JournalEntryRow.tsx:26`, `50`. Test: `e2e/design-completion.spec.ts`, `e2e/care-pwa.spec.ts` (offline expense).
23. Row state "כדאי לבדוק" (warning icon) for anomaly-flagged fuel rows and for service rows whose odometer conflicts with mileage evidence (`serviceMileageWarning`). `History.tsx:225`; `JournalEntryRow.tsx:51`; `presentation.ts:25-29`. Test: `e2e/design-v2-journal.spec.ts` (`journal-unknown` row contains "כדאי לבדוק").
24. Row state "אחרי תדלוקים שלא נרשמו" when the fill has `continuityBreakBefore`. `JournalEntryRow.tsx:49`. Test: `e2e/consumption.spec.ts`, `e2e/import.spec.ts`.
25. Money column: unknown → "—"; known zero → "₪0"; refund → signed "+₪x" with caption "חזר אליכם" and refund styling; non-financial rows show a chevron. `JournalEntryRow.tsx:53-58`. Test: `e2e/design-v2-journal.spec.ts` (₪0, —), `e2e/design-v2-home.spec.ts` ("+₪11").

### Summary and pagination
26. Filtered summary region (aria "סיכום היומן המסונן"): label "סך הכול בתקופה", or "סכום ידוע בתקופה" when any cost is unknown or data incomplete; value = net (fuel + service + expenses − refunds) or "—" when nothing is known; `N עלות חסרה/עלויות חסרות`; `N רשומה/רשומות · N תדלוק/תדלוקים · <range label>`. `History.tsx:78-80`, `231-237`; `src/lib/vehicle/financial.ts:3-8`. Test: `e2e/design-v2-journal.spec.ts` ("₪1,567", "1 עלות חסרה", "1 רשומה · 0 תדלוקים").
27. Totals preserve exact stored agorot (12345, null, 0, 1050) — display is whole shekels only. `History.tsx:213`, `233` (`vehicleMoney`). Test: `e2e/design-v2-journal.spec.ts` (reads documents back).
28. Pagination: first **50** rows; "הצגת רשומות נוספות" adds 50; summary adds "מוצגות 50 מתוך N רשומות". Month groups with no visible rows are hidden but month totals use all rows of the month. `History.tsx:46`, `81`, `204-206`, `230`, `236`. Test: `e2e/cycle5.spec.ts` (button visible); count/“מוצגות” uncovered.

### Banners, coverage and empty states
29. Coverage button (`journal-coverage`) shows only when data is incomplete or a source errored: "חלק מהרשומות אינו זמין לקריאה" / "הנתונים עדיין חלקיים"; opens sheet "על אילו נתונים הסיכום מבוסס?" with the text "הסכומים מבוססים על הרשומות שעוברות את הסינון הנוכחי, כולל החזרים. עלות שלא נרשמה נשארת חסרה; אפס שנרשם נשאר אפס." plus incomplete/error paragraphs and an unsynced link. `History.tsx:96`, `191-192`, `259-266`. Test: `e2e/design-v2-journal.spec.ts`, `e2e/design-v2-journal-writes.spec.ts` (absent when complete); open state uncovered.
30. Unsynced banner "יש שינויים שעוד לא עלו לענן · בדיקה ותיקון ←" → `/settings/unsynced` whenever any outbox op exists for this vehicle. `History.tsx:98`, `193`. Test: `e2e/reliability.spec.ts` (`[data-history-unsynced]`).
31. Empty states: loading "טוענים את היומן"/"הרשומות יופיעו בעוד רגע." (`role=status`); filtered "לא נמצאו רשומות"/"נסו חיפוש או סינון אחר." + "ניקוי סינון"; incomplete "עדיין אין רשומות זמינות" + "פרטי הנתונים"; empty "אין כאן עדיין רשומות"/"אפשר להוסיף תדלוק, טיפול או הוצאה." + primary "הוספת רשומה". `History.tsx:194-202`. Test: `e2e/design-v2-journal.spec.ts` (filtered); others uncovered.

### Entry sheet
32. The sheet snapshots the record at open; if the live record changes, it shows "הרשומה עודכנה. סגרו ופתחו אותה שוב כדי לראות את העדכון." and disables delete and the segment chip. `EntrySheet.tsx:40-45`, `52`, `59`, `73`, `102`. Test: `e2e/design-v2-journal-writes.spec.ts` (sub-millisecond edit detection).
33. Headline: amount ("—" + "הסכום לא תועד" when unknown; signed + "חזר אליכם" for refunds), or gauge %, or odometer + "קילומטראז׳ שנרשם"; status "ממתין לאישור"/"דורש בדיקה". `EntrySheet.tsx:55-72`. Test: `e2e/design-v2-home.spec.ts` ("172,600", "25%").
34. Fuel segment chip (aria "פרטי המקטע") opens the SegmentSheet for the segment ending at this fill. `EntrySheet.tsx:73-76`; `History.tsx:253-254`. Uncovered in journal (SegmentSheet covered from Insights).
35. Detail rows: "מתי" (full date + time, or day + "שעת האירוע לא תועדה"), "ליטרים" (2 dp) + end label, "מחיר לליטר" (two decimals or "—" when unknown) + "מחיר משאבה שנרשם: ₪x.xx לליטר", "מה עשו ברכב", "סוג", "קילומטראז׳ שנרשם", "מחוון הדלק", "אחרי תדלוקים שלא נרשמו" + "הצריכה אינה מחושבת דרך הפער הזה.", "סיבה" (כרגיל/כמעט נגמר/לפני נסיעה/מחיר טוב/לא בטוח), "מוסך", "תזכורות שקושרו לטיפול" (titles or "תזכורת שאינה זמינה"), "הערה". `EntrySheet.tsx:23-26`, `78-98`. Test: `e2e/design-v2-journal.spec.ts` ("₪7.00", "101,840").
36. Service mileage warning paragraph shown in the sheet. `EntrySheet.tsx:53`, `99`. Test: `e2e/design-v2-journal.spec.ts` (warning entry evidence).
37. "עריכה": fill-up → `/fillup/<id>`; care → care editor; observations have no edit (single delete action). `EntrySheet.tsx:100-104`; `History.tsx:118-124`. Test: `e2e/design-v2-journal.spec.ts`, `e2e/consumption.spec.ts`.
38. Escape closes the sheet and returns focus to the originating row. Test: `e2e/design-v2-journal.spec.ts` (theme evidence loop).

### Delete and undo
39. "מחיקה" → confirm "מחיקת הרשומה?" with title and "היומן, העלויות והתזכורות יחושבו מחדש. אחרי אישור המחיקה יהיה זמן קצר לביטול."; button "מחיקת הרשומה" / "מוחקים…"; double-submit guarded; cancel blocked while busy; error shown inline (`journal-delete-error`), e.g. "בקשת המחיקה לא נשמרה.", "קריאת המקור אינה זמינה כרגע. פתחו את הרשומה שוב לאחר טעינת הנתונים.". `History.tsx:125-154`, `255-258`. Test: `e2e/design-v2-journal-writes.spec.ts`, `e2e/design-v2-foundation.spec.ts`.
40. After server acceptance: toast "הרשומה נמחקה" with Undo until the deadline (fill-ups 5 s; care/observation per `undoDeadline`); "הרשומה כבר אינה ביומן" when already absent (no Undo); unaccepted → "המחיקה דורשת בדיקה" / "הבקשה שמורה בשינויים שעוד לא עלו לענן". Undo → "הרשומה שוחזרה" or "השחזור דורש בדיקה"; failure → error toast with retry while the deadline lasts. The toast outlives the screen (provider-scoped). `History.tsx:270-309`. Test: `e2e/design-v2-journal-writes.spec.ts` (Undo after navigation; absent observation; parent vehicle archived/deleted), `src/lib/recordUndo.test.ts`, `src/lib/recordUndoPersistence.test.ts`.

### Shell / a11y
41. Tab bar shows on `/history`; atmosphere variant "journal". `src/App.tsx:131`; `src/components/Atmosphere.tsx:12`. Test: `e2e/design-v2-journal.spec.ts` (`atmosphere(page, "journal")`, 72 lines, 3 circles).
42. Chips, quiet rows and delete button are ≥44×44. Test: `e2e/design-v2-journal.spec.ts` (`target44`).

## §6 cross-check (Journal line)

| §6 item | Status | Evidence |
|---|---|---|
| Period all/month/year/3/6/12 | present | `History.tsx:168-173` |
| Year from vehicle screen | present | `?year=` `History.tsx:58-68`; `VehicleDetails.tsx:23`, `RunningCosts.tsx:13` |
| Filters incl. issues | **partial** | No "תקלות" chip; only legacy `?kind=issue` URL is honoured (`History.tsx:35,55,184`). Issues are not in the chip list `History.tsx:28-31` |
| Filters incl. odo/gauge | present | chip "ק״מ ומחוון" includes `tank` rows `History.tsx:73` |
| Search | present | `History.tsx:164-167` |
| Filtered summary | present | `History.tsx:231-237` |
| "על אילו נתונים מבוסס" | **partial** | Sheet exists ("על אילו נתונים הסיכום מבוסס?") but its trigger appears only when data is incomplete/errored (`History.tsx:191`); no always-on ⓘ on the summary |
| Unknown-cost count | present | `History.tsx:218-220`, `234` |
| 25-row pagination | **differs** | Production pages by **50** (`History.tsx:46`, `230`: `+50`). §6 says 25 |
| Unsynced banner | present | `History.tsx:193` |
| Row state ממתין לאישור | present | `JournalEntryRow.tsx:26` |
| Row state דורש בדיקה | present | `JournalEntryRow.tsx:26` |
| Row state כדאי לבדוק | present | `JournalEntryRow.tsx:51` |
| Row state אחרי תדלוקים שלא נרשמו | present | `JournalEntryRow.tsx:49` |
| Row state החזר | present | `JournalEntryRow.tsx:45`, `57` ("החזר", "חזר אליכם") |
| Row state לא בעלות הרכב | **missing-in-production** | No `excluded` field anywhere in `src` (only §7.1 new feature) |

## v3 changes to this screen

May change:
- Visual tone (§1): hairline rows, radius 20/14/10, Karantina 400 heading, card shadow, translucent tab bar.
- Money string (§5): `₪1,567` → `1,567 ₪` (narrow NBSP). Many journal e2e assertions use the `₪…` prefix (e.g. `ledger-total` "₪1,567", "+₪11", "₪0", "₪7.00") — update only those strings, never the numbers or the agorot read-backs. Per-litre stays 2 dp.
- Period chip presentation (Stage 4 "period chip", "chip fade mask"); filtered summary with an always-available info sheet (Stage 4).
- §7.1: expenses with `excluded: true` stay in the journal, its month and filtered totals, tagged "לא בעלות הרכב" (new row state). Missing field = included.
- Optionally an issues chip if §6's "filters incl. issues" is adopted; keep legacy `kind=issue|tank` URLs working.
- If pagination is changed to 25 per §6, it is a deliberate behaviour change: record it in QA.md and update `e2e/cycle5.spec.ts` expectations; otherwise keep 50.

Must not change:
- `financialTotals` semantics (net of refunds; unknown ≠ 0; known 0 stays "₪0"/"0 ₪"; "—" when nothing known); exact agorot stored.
- URL contract: `period`, `kind`, `year`, `from/to`, `plan`, `flagged`, `owner/vehicle/entry`.
- Scope remount, entry snapshot + "הרשומה עודכנה…" guard, delete confirm copy, Undo deadlines and provider-scoped toasts.
- All row states above, focus return on sheet close, 44px targets, atmosphere variant "journal".
