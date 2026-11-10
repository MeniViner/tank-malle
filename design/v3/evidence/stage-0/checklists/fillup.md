# Fill-up — baseline behaviour checklist (Stage 0)

Scope: fill-up form (`/fillup/new`, `/fillup/:fillupId`, rejected-write correction), two-photo scan entry, receipt import sheet, local draft, Saved screen with post-save pump-price confirmation, 5-second undo, edit/delete. Station picker is in `station-sheet.md`; the tank sheet/capacity confirm sheet is in `tank-sheets.md`.

Baseline commit `05548ba`. Line numbers refer to that tree.

## Sources

- `src/screens/FillupForm.tsx` (controller, validation, save/undo/delete, pump confirmation)
- `src/components/fillup/FillupEssentials.tsx` (pump display: total, litres, price, odometer; end-state segmented; live preview; warnings)
- `src/components/fillup/FillupMore.tsx` ("עוד פרטים": before gauge, missed-fills toggle, note, stored pump price, after-state, reconciliation)
- `src/components/fillup/FillupSaved.tsx`, `src/components/fillup/savedResult.ts` (Saved screen)
- `src/components/fillup/DateSheet.tsx`, `src/components/fillup/tankEdit.ts`
- `src/components/ReceiptImport.tsx`, `src/lib/import/receiptText.ts`, `src/lib/import/receiptPdf.ts`
- `src/components/scan/ScanWizard.tsx`
- `src/lib/fillupDraft.ts`, `src/lib/receipt.ts`, `src/lib/fillupPricing.ts`, `src/lib/stats.ts` (`hardBlock`, `softWarnings`, `odometerBounds`, `evaluateDraft`), `src/lib/fillupSerializer.ts` (`FILLUP_LIMITS`, `validateFillupInput`), `src/lib/tank/capacityChecks.ts`, `src/lib/fillupUndo.ts`, `src/lib/fillupLifecycle.ts`
- Unused in production: `src/components/TankStateSection.tsx` (contains the reason picker; imported nowhere — see §6 cross-check)

## Behaviours

### Entry, routing and guards

1. Header title: "תדלוק חדש" (new) / "עריכת תדלוק" (edit) / "תיקון תדלוק" (correcting a rejected outbox write). `src/screens/FillupForm.tsx:1118`. Covered: `e2e/design-v2-fillup.spec.ts`, `e2e/reliability.spec.ts` (rejected edit).
2. Close (×, aria "סגירה") navigates back; if draft storage failed and the form is dirty, asks `window.confirm("לא ניתן לשמור טיוטה במכשיר. לצאת ולאבד את הפרטים?")`. `FillupForm.tsx:465-467,1117`. Uncovered (confirm path).
3. No active vehicle → empty state "בחרו רכב לתדלוק" with action "לבחירת רכב" → `/vehicle`. `FillupForm.tsx:1105-1106`. Uncovered.
4. Rejected operation that belongs to another vehicle → "הפעולה שייכת לרכב אחר" with "מעבר ל<make> <model>" switching the active vehicle. `FillupForm.tsx:1100-1103`. Covered: `e2e/reliability.spec.ts` (sign-out A→B→A), partially.
5. Deep link to a missing record → "הרשומה לא נמצאה" / "ייתכן שנמחקה, או שהיא שייכת לרכב אחר." (never an empty new form); history load error → "ההיסטוריה לא נטענה"; vanished operation → "הפעולה כבר לא קיימת". `FillupForm.tsx:70,115,167,176`. Covered: `e2e/reliability.spec.ts` ("a deep link to a missing record shows not-found…").
6. Camera button (aria "צילום המשאבה ולוח הקילומטרים", `data-testid=fillup-camera`) opens the two-photo `ScanWizard` ("תדלוק בשני צילומים", steps משאבה → קילומטראז׳, "דילוג לקילומטראז׳"). With account preference `quickEntry === true` a new form opens directly in the camera. `FillupForm.tsx:307,1119`; `src/components/scan/ScanWizard.tsx:34-40`. Covered: `e2e/scan-maintenance.spec.ts`, `e2e/cycle5.spec.ts` ("one scan step can be skipped…"), `e2e/camera-zoom.spec.ts`, `e2e/design-v2-entry.spec.ts` (quickEntry).
7. After a scan, status "הצילום הועבר לטופס. בדקו את הספרות לפני השמירה." `FillupForm.tsx:1151`. Covered: `e2e/scan-maintenance.spec.ts`.

### Date and station chips

8. Date chip shows relative date + time once confirmed, else "בחירת תאריך"; opens `DateSheet` ("תאריך ושעה", "עכשיו", "אישור", future capped by `maxDate`) which shows "טווח קילומטראז׳ מותר לתאריך זה: min – max". `FillupForm.tsx:1123-1127`; `src/components/fillup/DateSheet.tsx:30-59`. Covered: `e2e/datetime.spec.ts`, `e2e/dated-fillup-price.spec.ts`.
9. Saving without a confirmed date → alert "בחרו תאריך ושעה לפני השמירה" and focus moves to the date chip. `FillupForm.tsx:850-861,1178`. Covered: `e2e/design-v2-fillup.spec.ts` ("Save exposes invalid input…") partially; copy uncovered.
10. Changing the date re-resolves the dated official price/discount (Israel midnight boundary); an older date without evidence clears derived amounts but keeps typed measurements and manual prices; editing a saved record's date keeps its exact paid price/total. `FillupForm.tsx:509-546`. Covered: `e2e/dated-fillup-price.spec.ts` (3 tests).
11. Station chip shows the station name or "בחירת תחנה"; auto-chosen station shows " · לפי מיקום". `FillupForm.tsx:1129-1132`. Covered: `e2e/design-v2-fillup.spec.ts`, `e2e/station-nearby-order.spec.ts`.
12. New form (not edit, not correction, no station yet) requests geolocation once and auto-selects: nearest past station within 300 m, else the first nearby catalog station (400 m radius). `FillupForm.tsx:583-628,647-650`; `src/lib/stations.ts:328-363`. Covered: `src/lib/stations.test.ts`, `e2e/station-nearby-order.spec.ts`.
13. A delayed geolocation result never overwrites a station chosen manually while it was pending (selection generation counter). `FillupForm.tsx:588-616,844-849`. Covered: `e2e/design-v2-fillup.spec.ts` ("a delayed geolocation result cannot overwrite…").

### Pump display (amounts) and price chain

14. Four pump rows in order: "סכום" (₪, placeholder 0.00, autofocus on new), "ליטרים" (ל׳), "מחיר לליטר" (₪, small), "קילומטראז׳" (ק״מ, numeric). `src/components/fillup/FillupEssentials.tsx:63-87`. Covered: `e2e/design-v2-fillup.spec.ts`, `e2e/input-live-update.spec.ts`.
15. Any two of total/litres/price derive the third; derived captions: "חושב מהליטרים ומהמחיר · הקלידו לשינוי", "חושב לפי <price> לליטר · הקלידו לשינוי", "חושב מהסכום ומהליטרים"; typed price caption "המחיר שהקלדתם". A suggestion never moves a typed litres/total. `FillupEssentials.tsx:69-81`; `src/lib/receipt.ts:52-145`. Covered: `src/lib/receipt.test.ts`, `e2e/design-v2-fillup.spec.ts` ("manual receipt figures survive live price changes…").
16. Fuel type per vehicle drives the price: 95 → dated regulated maximum named as such; 98/diesel never receive the 95 figure nor a regulated prefill — they get a real station/driver observation or the last price paid ("המחיר ששילמת כאן לאחרונה"), else empty with caption "הזינו את המחיר ששילמתם". `src/lib/fillupPricing.ts:276-319`. Covered: `src/lib/fillupPricing.test.ts`, `e2e/pricing.spec.ts` (95 / diesel / 98 tests).
17. Price caption labels the source: official reference label, "מחיר ששילמת בעבר", "מחיר מהתחנה", "מחיר מדיווח נהגים"; a saved private rule or vehicle discount appends "· <difference> (לפי ההגדרה הנוכחית)". `fillupPricing.ts:295-318`. Covered: `src/lib/fillupPricing.test.ts`, `e2e/pricing.spec.ts` ("a personal discount is not published as the station's price").
18. Last-paid default only uses earlier fills of the same fuel type with a known price (a legacy normalized 0 is not evidence; a raw paid 0 is). `FillupForm.tsx:513-546`; `fillupPricing.ts:225-230`. Covered: `src/lib/fillupPricing.test.ts`, `e2e/design-v2-fillup.spec.ts` ("missing and null legacy prices stay unknown on edit…").
19. Receipt conflict (total ≠ litres × price): warning "הסכום, הליטרים והמחיר לא מסתדרים. נשמור את מה שהקלדתם, בלי לשנות אף מספר." (soft) or "…בדקו את המספרים." when serializer bounds block. `FillupEssentials.tsx:90-94`; `receipt.ts:147-164`. Covered: `src/lib/receipt.test.ts`, `e2e/design-v2-fillup.spec.ts`, `e2e/ui-review.spec.ts`.
20. Ambiguous numeric input (e.g. comma/decimal) shows its interpretation line under the pump. `FillupForm.tsx:1159-1160`; `src/lib/numeric.ts`. Covered: `src/lib/numeric.test.ts`.
21. Hard limits from the serializer (same as server rules): price ≤ `FILLUP_LIMITS.pricePerLiterMax` (100) with "המחיר לליטר חייב להיות עד <price>", litres ≤ 500, total ≤ 50,000, odometer < 3,000,000, notes ≤ 500. `src/lib/fillupSerializer.ts:67-75,333-336`; `FillupEssentials.tsx:80`. Covered: `src/lib/fillupSerializer.test.ts`.
22. On save attempt, missing fields: "חסר סכום תקין", "חסרים ליטרים", "חסר מחיר לליטר", "חסר קילומטראז׳"; the pump display shakes (420 ms) and focus goes to the first invalid field; a notes error opens "עוד פרטים". `FillupForm.tsx:812-825,850-861`. Covered: `e2e/design-v2-fillup.spec.ts` ("Save exposes invalid input…").

### Odometer

23. Odometer caption: "+N ק״מ מהרישום הקודם" while typing, "אחרון: N" before, "הקריאה בלוח הקילומטרים" with no history; placeholder = previous minimum. `FillupEssentials.tsx:55-60,82-86`. Covered: `e2e/design-v2-fillup.spec.ts`.
24. Odometer outside the neighbouring records' range (dated insertion) → **blocking** range error "הזינו בין <min> ל־<max>" / "הזינו <min> ומעלה" / "הזינו עד <max>"; `hardBlock` texts "הזן בין … — לפי הרשומות הסמוכות", "הקילומטראז׳ חייב להיות <min> ומעלה", "הקילומטראז׳ חייב להיות עד <max>", "יש להזין קילומטראז׳ תקין". Save disabled while blocked. `FillupEssentials.tsx:46-54`; `src/lib/stats.ts:906-925`; `FillupForm.tsx:631-637,799-808`. Covered: `src/lib/stats.test.ts`, `e2e/design-v2-fillup.spec.ts` ("…real inclusive odometer range…"), `e2e/audit-fixes.spec.ts` (F06 backward reading).
25. Odometer jump > 2.5 × typical segment km → soft warning "קפיצת קילומטראז׳ חריגה — בדקו את הערך" with detail "מאז התדלוק האחרון נוספו N ק״מ, הרבה מעל הרגיל. אפשר לשמור בכל זאת." plus suffix " · פספסתם תדלוק? אפשר לסמן בפרטים הנוספים." `stats.ts:867-881`; `FillupEssentials.tsx:108-111`. Covered: `src/lib/stats.test.ts` (softWarnings) — copy uncovered. (Note: relative 2.5× rule, not the fixed 1,500 km used by the care forms.)
26. Price ≤ 0 or > 20 → soft warning "מחיר לליטר חריג" / "המחיר שהוזן רחוק מהטווח המקובל בישראל." `stats.ts:891-897`. Covered: `src/lib/stats.test.ts`.

### Tank state (end state, before, after, capacity)

27. End-state segmented "מצב המיכל בסוף התדלוק": "מילאתי עד הסוף" / "תדלוק חלקי"; neither → "מצב המיכל לא ידוע" (a fill can be saved without a tank answer). `FillupEssentials.tsx:96-102`. Covered: `e2e/tank.spec.ts` ("§16.16 the tank section is optional…").
28. Live preview (aria-live) under the pump: "צפוי למקטע הזה" + consumption; "טנק מלא ראשון: מכאן נתחיל למדוד" / "…אחרי הפספוס…"; "תדלוק חלקי · נתחיל למדוד אחרי מילוי עד הסוף"; "מצב המיכל לא צוין · אפשר לשמור כך"; "תדלוק חלקי: X ל׳ במקטע הפתוח"; "מלאו סכום וקילומטראז׳ ונראה מה יצא"; incomplete history → "ההיסטוריה לא זמינה במלואה לחישוב". `FillupEssentials.tsx:103-126`. Covered: `e2e/design-v2-fillup.spec.ts`, `e2e/reliability.spec.ts`, `e2e/ui-review.spec.ts`.
29. "עוד פרטים" toggle (sub "מחוון דלק, רצף תדלוקים, הערה"). `src/components/fillup/FillupMore.tsx:59-63`. Covered: `e2e/ui-review.spec.ts`, `e2e/helpers/fillup.ts`.
30. Before gauge "כמה היה במיכל לפני התדלוק? (לא חובה)" with ⓘ "על עדכון מצב המיכל" → sheet "מצב המיכל"; "הקישו על המחוון"; "ניקוי הסימון"; captions "· משוער לפי הכמות" / "· לפי הסימון שלכם" / "· מהרשומה הקיימת". Gauge draggable and keyboard operable. `FillupMore.tsx:52-76,140-142`. Covered: `e2e/tank.spec.ts` (§16.15.9, §16.15.10, §16.15.1, §16.15.3).
31. After state ("מצב המיכל אחרי התדלוק", in `<details>`): after gauge derived from before + litres + capacity; "לא יודע" chip, "ניקוי הבחירה"; override "לא נראה נכון?" → "תיקון המד אחרי" / "סיום תיקון המד" / "הסרת המד אחרי"; captions "· תיקון שלכם", "· מחושב לפי הכמות"; "מלא לפי הבחירה שלכם" / "עדיין אין הערכה"; legacy end state retained: "מצב המיכל מהרשומה הקיימת יישאר כמו שנשמר, עד שתבחרו אחרת." `FillupMore.tsx:96-117`. Covered: `e2e/design-v2-fillup.spec.ts` (after-level tests), `e2e/tank.spec.ts` ("after-only entry without capacity…", "unknown endpoint preserves before evidence…"), `src/components/fillup/tankEdit.test.ts`, `src/lib/tank/outcome.test.ts`.
32. Capacity reconciliation (states overCapacity / capacitySuspect / conflict): title "נראה שנפח המיכל גדול מההערכה" (capacitySuspect) or "הנתונים לא מסתדרים עם נפח המיכל", implied level "לפי הסימון והכמות יוצא N%", actions "התאמת המצב לפני", "מילאתי עד הסוף", "בדיקת נפח המיכל" (→ `/vehicle?tab=details`), "המשך בלי המדים". `FillupMore.tsx:118-131`; `FillupForm.tsx:1163`. Covered: `src/lib/tank/outcome.test.ts`, `tankEdit.test.ts` (logic); UI uncovered.
33. Litres vs capacity soft warning: confirmed tank → "הכמות גדולה מנפח המיכל שאישרת" ("N ליטר לעומת M ליטר נפח…"); estimated tank → "נפח המיכל המשוער כנראה נמוך מדי" ("נכנסו N ליטר, יותר מ־M ליטר שהוערכו. אפשר לאשר או לתקן…"). `src/lib/tank/capacityChecks.ts:59-68`; `stats.ts:862-866`. Covered: `src/lib/tank/outcome.test.ts`.
34. No capacity → "הוספת נפח מיכל"; estimated capacity → "<capacityNote> · לאישור או תיקון"; "ניקוי המדים". All navigate through `canLeaveDraft()`. `FillupMore.tsx:134-136`. Uncovered.
35. Untouched tank measurements on edit keep their provenance; a quantity-only edit refreshes the derived after-level using the stored capacity revision (`capacityLitersAtEntry`). `src/components/fillup/tankEdit.ts`; `FillupForm.tsx:660-675`. Covered: `tankEdit.test.ts`, `e2e/design-v2-fillup.spec.ts` (4 tests on tank edits).
36. Refuel reason is **not choosable** in the current form; a historical `refuelReason` is preserved through edits, gauge clearing and draft restore, and shown read-only in the journal entry sheet ("סיבה": כרגיל/כמעט נגמר/לפני נסיעה/מחיר טוב/לא בטוח). `tankEdit.ts:12,55-56,97`; `src/components/journal/EntrySheet.tsx:22-25,92`. Covered: `e2e/design-v2-fillup.spec.ts` ("editing a note preserves the historical refuel reason…", "clearing gauges preserves the hidden historical refuel reason…"), `tankEdit.test.ts`.

### Missed fills, note, stored pump price

37. Toggle "פספסתי תדלוקים לפני זה" / "נתחיל מדידה חדשה מכאן, וההיסטוריה נשארת" → `continuityBreakBefore: true`. `FillupMore.tsx:78-81`. Covered: `src/lib/continuity.test.ts`, `e2e/consumption.spec.ts`, `e2e/statistics.spec.ts`.
38. Note textarea "הערה", placeholder "למשל: שטיפה כלולה", max 500. `FillupMore.tsx:82-86`. Covered: `e2e/design-v2-fillup.spec.ts`, `e2e/design-v2-journal-writes.spec.ts`.
39. Edit with a stored pump price: "מחיר משאבה שאושר: <price>" with "הסרת האישור" / "החזרת האישור הקודם"; removal note "האישור יוסר בשמירה. המחיר ששילמתם לא ישתנה." An untouched question keeps the stored `postedPricePerLiter` exactly. `FillupMore.tsx:88-94`; `FillupForm.tsx:762-764`. Covered: `e2e/outbox-invariants.spec.ts`, `e2e/reliability.spec.ts`.

### Draft

40. Every dirty change writes a local draft keyed by uid + vehicle + record/operation (`localStorage`, envelope version 1, expires after 30 days); clean forms remove it. `FillupForm.tsx:304,444-458`; `src/lib/fillupDraft.ts:13-31`. Covered: `e2e/audit-fixes.spec.ts` (F09/F12 "a draft survives navigation and reload"), `e2e/design-v2-fillup.spec.ts`, `src/lib/audit-regressions.test.ts`.
41. Restored draft banner (`data-testid=fillup-draft-status`, `data-draft-state=restored`): "הטיוטה שלכם שוחזרה" + "מחיקת טיוטה" (confirm "למחוק את הטיוטה ולהתחיל מחדש?" → clear + reload). `FillupForm.tsx:1134-1140`. Covered: `e2e/audit-fixes.spec.ts`, `e2e/care-pwa-upgrade.spec.ts`; copy text uncovered.
42. Storage failure banner (`data-draft-state=failed`): "הטיוטה לא נשמרה במכשיר. השאירו את הטופס פתוח."; app-update reload is blocked while that dirty, unsaved state lasts (`useAppUpdateBlocker`). `FillupForm.tsx:453,1136`. Uncovered.
43. Edit opened on a record changed on another device: "הרשומה השתנתה במכשיר אחר" / "מה שהקלדתם נשאר כאן. השמירה תיבדק מול הגרסה שפתחתם." with "טעינת הגרסה החדשה"; deleted elsewhere: "הרשומה נמחקה במכשיר אחר. שמירה תישאר במכשיר לבדיקה."; malformed: "הרשומה נקראה חלקית: <reason>". `FillupForm.tsx:1145-1150`. Covered: `e2e/reliability.spec.ts` ("a record changed on another device is flagged…"), `e2e/audit-fixes.spec.ts` (F12 loading server version).

### Receipt import

44. "ייבוא קבלה מקובץ או טקסט" shown only on new (not edit/correction) forms; opens sheet "ייבוא קבלה" with intro "PDF עם טקסט או טקסט שהעתקתם. חילוץ כללי וניסיוני; בדקו מול הקבלה. המסמך עצמו נשאר במכשיר ואינו נשמר." `FillupForm.tsx:1168,1194-1198`; `src/components/ReceiptImport.tsx:64-65`. Covered: `e2e/design-v2-fillup.spec.ts`, `e2e/cycle5.spec.ts`.
45. Inputs: "בחירת PDF" (local text extraction, no network OCR), textarea "טקסט הקבלה" + "חילוץ נתונים מהטקסט"; status "קוראים במכשיר…"; read failure "לא ניתן לקרוא את הקובץ. אפשר להדביק טקסט."; link "לייבוא CSV / XLSX הקיים" → `/settings/import`. `ReceiptImport.tsx:32,66-70`. Covered: `e2e/cycle5.spec.ts` ("local PDF text extraction works without network…"), `src/lib/import/receiptText.test.ts`.
46. Credit note (חשבונית/תעודת זיכוי/credit note) is refused: "זהו מסמך זיכוי. אין להוסיף ממנו ליטרים. אפשר לרשום החזר ב״הרכב שלי״." and on apply "מסמך זיכוי אינו תדלוק. רשמו החזר במסך הרכב שלי." `ReceiptImport.tsx:49,73`; `receiptText.ts:25-32`. Covered: `e2e/cycle5.spec.ts`, `receiptText.test.ts`.
47. Review fields: "עלות הדלק ששולמה" (₪), "ליטרים בקבלה", "תאריך הקבלה" (civil day-first, invalid drafts retained), "שעת התדלוק" (24-hour); details "פירוט השורות שזוהו" and "מזהי מסמך למניעת כפילות" (issuer/series/branch/number) with note "בלי ארבעה מזהים מאושרים נבדקת חזרה של אותו טקסט בלבד…". `ReceiptImport.tsx:72-83`. Covered: `e2e/cycle5.spec.ts` ("receipt civil dates and 24-hour time…").
48. Mandatory checkbox "בדקתי: אלה ליטרים ועלות דלק ששולמה, אחרי הנח…"; when the form already has authored values a second checkbox "להחליף את הסכום, הליטרים והתאריך שכבר…" is required; possible duplicate matches must be acknowledged; otherwise "יש לבדוק ולאשר את הנתונים ואת ההתאמות האפשריות." Missing data → "בדקו סכום דלק, ליטרים, תאריך ושעה מהקבלה." `ReceiptImport.tsx:52,59,84-86`. Covered: `e2e/cycle5.spec.ts` ("import protects authored values…").
49. Exact repeat import blocked: "המסמך הזה כבר יובא לרכב הזה, גם אם הרשומה נערכה מאז…" (matched by `importRowHash`/`importBatchId`); the import identity survives later edits. `ReceiptImport.tsx:58,84`; `FillupForm.tsx:766-769`. Covered: `e2e/cycle5.spec.ts` ("receipt uses durable offline writes, retains identity after edit and rejects repeated import"), `e2e/cycle6.spec.ts`.
50. "העברה לבדיקה בטופס" transfers values into the form (status "הקבלה הועברה לבדיקה. השלימו קילומטראז׳ ובחרו מצב מיכל."); "חזרה לטופס" closes; candidate disappears on vehicle/account change. `ReceiptImport.tsx:87,91`; `FillupForm.tsx:1152`. Covered: `e2e/cycle5.spec.ts`.

### Save, Saved screen, undo

51. Save button "שמירת תדלוק" / "שמירת שינויים" / "שמירה ושליחה מחדש"; enabled only when the serialized record validates, odometer is not blocked and the date is confirmed. Write goes through the outbox; storage refusal toast "השמירה נכשלה" / "הפרטים נשארו בטופס. פנו מקום ונסו שוב." (8 s) keeps the form. `FillupForm.tsx:799-808,907-985,1183`. Covered: `e2e/reliability.spec.ts`, `e2e/pwa-offline.spec.ts`, `e2e/outbox-invariants.spec.ts`, `src/lib/fillupLifecycle.test.ts`.
52. New fill → Saved screen ("נשמר" stamp, heading focused); write status line, "השמירה דורשת בדיקה" link → `/settings/unsynced` when rejected. `src/components/fillup/FillupSaved.tsx:79-89`. Covered: `e2e/design-v2-fillup.spec.ts`, `e2e/design-v2-fillup-writes.spec.ts`.
53. Saved hero when a segment closed: consumption in the account unit ("ק״מ לליטר במקטע שנסגר" / "ל׳ ל-100 ק״מ במקטע שנסגר"), "השיא שלך עד היום" or comparison "בדיוק כמו הרגיל שלך" / "N% יותר|פחות דלק לק״מ מהרגיל שלך"; rows "הממוצע שלך", manufacturer reference (labels "הנתון שהזנתם"/"נתון היצרן"/"נתון משנה אחרת"/"הערכת צריכה"/"נתון לייחוס"), "המקטע" km · litres, "עלות לק״מ" in אג׳ or "—" with "עלות חסרה באחד התדלוקים במקטע." Canonical partial-inclusive segment. `FillupSaved.tsx:92-105`; `savedResult.ts:14-17`. Covered: `e2e/design-v2-fillup.spec.ts` ("Saved uses the closed canonical partial-inclusive segment…").
54. Saved hero for an open segment: litres · total money and one of "נקודת התחלה חדשה נקבעה…", "נקודת ההתחלה נקבעה…", "תדלוק חלקי נשמר. נתחיל למדוד אחרי מילוי עד הסוף.", "התדלוק נשמר בלי בחירה של מצב המיכל.", "תדלוק חלקי נשמר. הליטרים יצטרפו לחישוב במילוי המלא הבא.", "ההיסטוריה לא הייתה זמינה במלואה בשמירה הזו." `FillupSaved.tsx:106-115`. Covered: `e2e/design-v2-fillup.spec.ts` (partial).
55. 5-second undo on Saved: "ביטול השמירה (N)" countdown (deadline = submit + 5000 ms); busy "רושמים ביטול…"; success toast "התדלוק בוטל", otherwise "בקשת הביטול דורשת בדיקה" / "הנתונים שמורים בשינויים שעוד לא עלו לענן"; undo returns to Home. `FillupForm.tsx:863-883,965`; `FillupSaved.tsx:148-151`. Covered: `e2e/design-v2-fillup-writes.spec.ts`, `e2e/reliability.spec.ts` ("Undo of a newly created fill-up…"), `src/lib/fillupUndoPersistence.test.ts`.
56. "סיום" (or browser Back) transfers only the remaining undo time into a toast "תדלוק חדש" with "ביטול"; reload never restarts it; offline undo drains the SDK create first and never resurrects; a transferred undo cannot act after an A→B→A vehicle switch. `FillupForm.tsx:885-905`. Covered: `e2e/design-v2-fillup-writes.spec.ts` (7 tests).
57. Edit save: toast "עריכת תדלוק" with "ביטול" for 5 s, then "התדלוק עודכן" carrying the remaining undo; failure "שמירת התדלוק דורשת בדיקה". Navigates Home (or to `/settings/unsynced` for a correction, toast "שליחה מחדש"). `FillupForm.tsx:925-972`. Covered: `e2e/reliability.spec.ts` ("Undo after an edit restores the previous record on the server").
58. Post-save pump-price question (hidden if the record already has a posted price): "המחיר במשאבה היה <price>?" with "כן" / "לא, היה אחר". Buttons enabled only after the undo deadline passed **and** the creation is server-acknowledged ("אפשר לאשר אחרי שזמן הביטול יסתיים."); "סיום" stays available offline. `FillupSaved.tsx:117-138`; `FillupForm.tsx:1027-1030,1110`. Covered: `e2e/design-v2-fillup-writes.spec.ts` ("pump confirmation requires the expired deadline and true creation ACK…"); waiting copy uncovered.
59. "כן" writes `postedPricePerLiter = pricePerLiter` on the fill (records the station's posted price) → "מחיר המשאבה אושר."; failures "האישור לא נרשם. נסו שוב." / "האישור לא נשמר". `FillupForm.tsx:1031-1055`; `FillupSaved.tsx:141`. Covered: `e2e/pricing.spec.ts` ("confirming the pump price does record it as the station's posted price").
60. "לא, היה אחר" → "מה המחיר שהיה כתוב במשאבה?" field (₪ לליטר) + "שמירה"/"שומרים…", note "ההפרש יירשם כהנחה או התאמה אישית, ולא כמחיר התחנה."; saves a private price rule, never a public price. Scope is chosen **automatically**: catalog station → station rule; named station → name rule; otherwise/occupied-incompatible → this receipt only. Results: "ההתאמה האישית נשמרה לתדלוקים הבאים כאן." vs "ההתאמה נשמרה לתדלוק הזה בלבד."; errors "הזינו את המחיר שהיה במשאבה", "ההפרש גדול מדי. בדקו את מחיר המשאבה.", "לא ניתן לזהות את התחנה כרגע…", "ההתאמה לא נרשמה כדי לא להחליף כלל אחר…"; rules loading "טוענים את ההנחות שלך…". `FillupForm.tsx:1056-1096`; `fillupPricing.ts:148-175`; `FillupSaved.tsx:123-142`. Covered: `e2e/design-v2-fillup-pricing.spec.ts` (3 tests), `src/lib/fillupPricing.test.ts`.
61. Pump answer cannot report success before durable journaling; storage refusal keeps the typed price; queued answer → "הבקשה שמורה במכשיר ודורשת בדיקה." `FillupSaved.tsx:139-142`. Covered: `e2e/design-v2-fillup-pricing.spec.ts` ("a pump answer cannot report success before durable journaling…").

### Delete / correction

62. Edit form: "מחיקת התדלוק" → confirm "למחוק את התדלוק?" / "אחרי שהמחיקה תאושר, אפשר יהיה לשחזר מיד." → toast "התדלוק נמחק" with "שחזור" (5 s) → "התדלוק שוחזר"; else "המחיקה דורשת בדיקה". Restores the same document, receipt identity and creation identity. `FillupForm.tsx:989-1020,1170,1192-1193`. Covered: `e2e/design-v2-fillup.spec.ts` ("edit deletion Undo restores the same document…"), `e2e/consumption.spec.ts`.
63. Rejected-write correction: banner "שמירה שדורשת בדיקה" + error + "הפרטים שמורים במכשיר. שליחה מחדש לא תוסיף תדלוק כפול."; "הסרת הפעולה מהרשימה המקומית" discards it. Re-send keeps the same document id. `FillupForm.tsx:1141-1144,1171-1176`. Covered: `e2e/reliability.spec.ts` ("a rejected record can be edited and re-sent under the same document id").

## §6 cross-check (Fill-up line)

| §6 item | Status | Evidence |
|---|---|---|
| Fuel type per vehicle (95 regulated; 98/diesel manual pump price, last-paid default) | present | #16-18; `fillupPricing.ts:284-294`; `e2e/pricing.spec.ts` |
| Tank state before **and after** (partial) | present | #27-31 |
| Capacity check "נראה שנפח המיכל גדול מההערכה" → confirm sheet | **partial** | Copy exists (`FillupMore.tsx:120`), but in the form the action "בדיקת נפח המיכל" **navigates to `/vehicle?tab=details`**; there is no confirm sheet from the fill-up form. The confirm sheet (`TankCapacityConfirm`) is only reachable from the tank sheet (`TankSheets.tsx:88`). |
| Reasons (כרגיל/כמעט נגמר/לפני נסיעה/מחיר טוב/לא בטוח) | **missing-in-production (as an input)** | The picker lives in `src/components/TankStateSection.tsx:28-33,243-250`, which is imported nowhere. The form cannot set a reason; existing `refuelReason` is only preserved (#36) and displayed in `EntrySheet.tsx:22-25` (labels match §6). Picker labels in the orphan differ ("הדלק נמוך", "לפני נסיעה ארוכה", "מחיר משתלם / עצירה נוחה"). |
| Missed-fills flag | present | #37 |
| Receipt import (PDF/text; credit-note refusal; mandatory checkbox) | present | #44-50 |
| Draft restore "הטיוטה שלכם שוחזרה" | present | #40-42 |
| Station sheet | present | see `station-sheet.md` |
| Post-save pump-price confirmation with scope (this fill / station adjustment) | **partial** | Both scopes exist, but the scope is **chosen automatically** from station identity / rule occupancy (`fillupPricing.ts:166-171`), not by the user; the outcome text tells which one was used (#60). |
| 5-second undo | present | #55-57 |

Also note: no EV/charge mode exists in the form (no "טענתי", no kWh fields) — any EV fill-up in v3 is new work, not parity.

## v3 changes to this screen

May change (DESIGN-V3 §1, §5, §7):
- Visual tone only: Karantina 400 headings, hairline borders, radius scale 20/14/10, shadows, accent `#F3C54B`; the pump display/odometer keep their ink rules as "instruments" (§1).
- Money display per §5: totals whole shekels with narrow NBSP + ₪ after the number; per-litre price keeps two decimals (`7.35 ₪`). Editable inputs keep exact decimals (AGENTS.md).
- Layout of sheets per `proto/more.js` / `sheets.js` (Stage 4).
- If the reason picker is (re)introduced to satisfy §6, it must write `refuelReason` through `tankEdit.ts` semantics and keep preserving historical reasons.
- §7.4/§2: EV vehicles get "טענתי" and no tank/engine fields — new behaviour, must not affect fuel vehicles.
- §8 OCR changes only the scan pipeline behind `scanV2`; the two-photo flow and "הצילום הועבר לטופס…" review step stay.

Must not change:
- All validation, hard odometer range block, soft warnings, serializer limits, price chain (no 95 figure for 98/diesel), derived-field semantics in `receipt.ts`.
- Draft keying/restore/failure handling, update-blocker, conflict/deleted-elsewhere banners.
- Saved screen gating (undo deadline + server ACK before pump confirmation), automatic scope rules, private-rule never public, undo transfer/no-restart, delete-with-restore, rejected-write correction.
- Receipt import guards (credit refusal, mandatory checkbox, replace checkbox, duplicate identity).
