# Care forms — service / expense / reminder / odometer / issue editors — Stage 0 checklist

Baseline: `main` @ `05548ba`. All care editors are opened through `VehicleDataContext.edit({collection, record?, completePlan?, initialJob?, odometerIntent?})` and rendered once by `VehicleRecordEditor` (mounted in `src/App.tsx`), from Vehicle, Journal, Home spotlight and reminder detail.

## Sources

- `src/components/VehicleRecordEditor.tsx` (adapter + `IssueEditor`)
- `src/components/maintenance/CareEditor.tsx` (service, expense, reminder, odometer)
- `src/components/maintenance/CareConflictDetails.tsx` (field labels for conflict review in Unsynced)
- `src/lib/maintenance/model.ts` (`JOBS`, `EXPENSES`, `validCareRecord`, `mileageIssue`), `src/lib/maintenance/draft.ts`
- `src/lib/vehicle/model.ts` (`validVehicleRecord` for issues)

## Behaviours

### Shared shell (service / expense)
1. Two-step full-height sheet: header with close (step 1) or back "חזרה לבחירה" + close (step 2), counter "1 / 2" / "2 / 2" (`aria-label "שלב N מתוך 2"`). Editing an existing record, completing a plan, `initialJob`, or a restored draft opens directly on step 2. `CareEditor.tsx:68,162-173`. Tests: `e2e/design-v2-journal.spec.ts:105,156`, `e2e/cycle6.spec.ts:86`.
2. Sheet titles: "טיפול שבוצע", "הוצאה לרכב", "תזכורת לטיפול", "עדכון קילומטראז׳", prefixed "עריכת " when editing. Step headings: "מה עשו ברכב?" / "על מה ההוצאה?" / "למה נזכיר לך?" → step 2 "מתי להזכיר לך?" / "עדכון קילומטראז׳" / "עריכת טיפול" / "עריכת הוצאה" / title. Heading receives focus on step change. `CareEditor.tsx:21,71,147-151`. Tests: `e2e/design-v2-journal.spec.ts:105`.
3. Draft autosave to localStorage per uid/vehicle/collection/record (30-day expiry); restored → status "הטיוטה שוחזרה" (`care-draft-restored`); footer "טיוטה נשמרת במכשיר" + "מחיקת הטיוטה" → confirm "למחוק את הטיוטה?" / "הפרטים שערכתם עדיין לא נשמרו ביומן." ("יציאה ללא שמירה" / "המשך עריכה"). `CareEditor.tsx:32-39,79-94,183,301-310`, `lib/maintenance/draft.ts`. Tests: `src/lib/maintenance/draft.test.ts`, `e2e/design-v2-journal.spec.ts:105`, `e2e/cycle6.spec.ts:9`, `e2e/design-v2-foundation.spec.ts:354`.
4. Storage failure → alert "לא ניתן לשמור טיוטה במכשיר. השאירו את הטופס פתוח.", footer "הטיוטה לא נשמרה", `beforeunload` guard, close asks discard; app update blocked while dirty-unsaved or busy. `CareEditor.tsx:81-94,296`. Tests: `src/lib/maintenance/draft.test.ts:11`, `e2e/care-pwa-upgrade.spec.ts:112`, `e2e/scan-maintenance.spec.ts:184`.
5. Draft is cleared at durable local acceptance; a stale account/editor completion never clears a newer draft. `CareEditor.tsx:129-136`. Tests: `e2e/care-pwa.spec.ts:90`.
6. Fields disabled and save shows loading while busy; double submit guarded. `CareEditor.tsx:96,133,182,300`. Tests: `e2e/care-pwa.spec.ts:66,90`.

### Service ("טיפול שבוצע")
7. Step 1: multi-select job grid (`JOBS`: טיפול תקופתי, שמן ומסננים, צמיגים, בלמים, מצבר, תיקון, אחר); note "אפשר לבחור כמה עבודות. העלות נרשמת פעם אחת." / "עבודה אחת בחשבונית" / "N עבודות בחשבונית אחת · סכום כולל אחד"; "המשך" (`care-next`) disabled until ≥1 job. Title auto-composed "A · B" until user edits it. `CareEditor.tsx:139-143,192-207,299`, `lib/maintenance/model.ts:4`. Tests: `e2e/design-v2-journal.spec.ts:105`.
8. Cost field "עלות כוללת" ₪, placeholder "לא ידוע", note "ריק אם לא ידוע · 0 אם לא שילמתם"; empty → `costAgorot: null`, 0 → 0, >2 decimals rejected; stored as integer agorot exactly. `CareEditor.tsx:103-104,223-228`. Tests: `src/lib/maintenance/model.test.ts:22`, `e2e/design-v2-journal.spec.ts:47`.
9. "תאריך ביצוע" civil date (dd/mm/yyyy); invalid → "בדקו את התאריך — למשל 05/09/2026."; future date rejected. `CareEditor.tsx:99-111,231`. Tests: `src/components/CivilDateField.test.ts`, `src/lib/civilDate.test.ts`.
10. "קילומטראז׳ בזמן הטיפול" (optional, integer). `CareEditor.tsx:233-235`. Tests: `e2e/scan-maintenance.spec.ts:18`.
11. "עוד פרטים" disclosure: "תיאור" (shown inline instead when editing or job "אחר") and "מוסך / ספק" (`care-garage`, ≤160). `CareEditor.tsx:152,279-283`. Tests: `e2e/design-v2-journal.spec.ts:105`.
12. Notes "הערות" placeholder "מה הוחלף?" (≤2000). `CareEditor.tsx:154-159`. Tests: uncovered.
13. "עדכון תזכורות" disclosure (only if plans exist): checkboxes for active (or already-linked) plans, max 8; summary "הטיפול הזה משלים תזכורת?" / "1 סומנה כהושלמה" / "N סומנו כהושלמו"; note "רק התזכורות שתסמנו יתקדמו למועד הבא." `CareEditor.tsx:269-278`. Tests: `src/lib/maintenance/model.test.ts:40`, `e2e/scan-maintenance.spec.ts:170`.
14. Log-from-reminder (`completePlan`): title/job/completed plan prefilled; cost and garage defaulted from the latest previous completion of that plan, odometer from current unambiguous reading; note "הצעה מהטיפול ב־<day>: עלות ומוסך|עלות|מוסך". `VehicleRecordEditor.tsx:20-21`, `CareEditor.tsx:44,50-55,216-220`. Tests: `e2e/open-design.spec.ts`, `e2e/scan-maintenance.spec.ts:170`; source note uncovered.

### Expense ("הוצאה לרכב")
15. Step 1 single-select category (`EXPENSES`: ביטוח, רישוי וטסט, חניה, כבישי אגרה, שטיפה, אחר, החזר / זיכוי) advances to step 2; note "גם כסף שהוחזר לכם נכנס לכאן." `CareEditor.tsx:143,194-206`, `lib/maintenance/model.ts:5`. Tests: `e2e/cycle6.spec.ts:86`.
16. Refund: category `refund` → label "סכום שהוחזר", note "סכום חיובי שהוחזר לכם"; stored positive, subtracted in totals and negative in CSV. `CareEditor.tsx:224-227`, `lib/maintenance/export.ts:45`. Tests: `e2e/design-v2-journal.spec.ts:47`, `src/lib/maintenance/export.test.ts:33`, `src/lib/maintenance/costs.test.ts:6`.
17. Same cost rule/note "ריק אם לא ידוע · 0 אם לא שילמתם" for non-refund; title field shown inline for "אחר" or when editing, otherwise in "עוד פרטים". No "include in TCO" toggle exists. `CareEditor.tsx:152-153,223-228`. Tests: `e2e/design-v2-journal.spec.ts:47`.

### Reminder ("תזכורת לטיפול")
18. Step 1 job choice (or `initialJob` from suggestion chip); step 2 shows a selection row "הטיפול הבא · <job>" to go back. `CareEditor.tsx:209-214`. Tests: `e2e/scan-maintenance.spec.ts:18`.
19. "תאריך יעד" (optional civil date) and "יעד קילומטראז׳"; at least one required; note "אפשר תאריך, קילומטרים או שניהם — המוקדם מביניהם…". `CareEditor.tsx:246-252`, `lib/maintenance/model.ts:44`. Tests: `src/lib/maintenance/model.test.ts`.
20. Toggle "תזכורת חוזרת" with sub "לקבוע גם את הטיפול הבא": on → basis `completion`, shows "חזרה כל מספר חודשים" / "חזרה כל מספר ק״מ" and select "חישוב המועד הבא": "מהטיפול האחרון שבוצע" | "לפי יעדים קבועים מהיעד הראשון"; note "חזרה בחודשים דורשת תאריך יעד, וחזרה בק״מ דורשת יעד קילומטראז׳." Off → manual, intervals saved as null. `CareEditor.tsx:107,253-265`. Tests: `e2e/scan-maintenance.spec.ts:18`, `src/lib/maintenance/model.test.ts:7,11`.
21. "עוד פרטים": "תיאור", "מקור ההנחיה" (הגדרה שלי / הוראות יצרן / המלצת מוסך), toggle "תזכורת פעילה" (pause), notes. `CareEditor.tsx:279-290`. Tests: uncovered (pause toggle).
22. Invalid plan → "יש להזין שם ויעד בתאריך או בק״מ. מרווח חזרה צריך להיות מספר שלם וחיובי, עם יעד מתאים." `CareEditor.tsx:110-111`. Tests: uncovered (message); `src/lib/maintenance/model.test.ts:22` (validation).

### Odometer ("עדכון קילומטראז׳")
23. Pump-display style input "קילומטראז׳" with caption "הקריאה האחרונה: N ק״מ · <day>" or ambiguous "באותו יום תועדו A–B ק״מ. סדר הקריאות אינו ידוע."; notes placeholder "למשל: לפני נסיעה ארוכה". `CareEditor.tsx:236-242,158`. Tests: `e2e/design-v2-vehicle.spec.ts:129`.
24. New, current-intent, today-dated reading lower than latest (max if ambiguous) → blocking error "הקריאה נמוכה מקילומטראז׳ שכבר תועד (N ק״מ). בדקו את המספר או בחרו תאריך היסטורי מתאים." `CareEditor.tsx:116-120`. Tests: `e2e/design-v2-vehicle.spec.ts:129`.
25. Same flow, jump > **3,000** km → confirm "הקילומטראז׳ נכון?" body "הזנתם N ק״מ — תוספת של M ק״מ מהקריאה האחרונה." (ambiguous variant with range) — "כן, זו הקריאה" / "לתקן את המספר"; confirmation keyed to exact inputs. `CareEditor.tsx:121-126,311-315`. Tests: `e2e/design-v2-vehicle.spec.ts:129` ("asks only above the 3000 km boundary").

### Odometer validation for every record with a reading (adapter)
26. Any service/odometer save with an odometer is checked against readings on *other days* (all four sources, excluding itself): lower than an earlier day → "הקילומטראז׳ נמוך מקריאה קודמת (N ק״מ). בדקו את התאריך או תקנו את הקריאה הקודמת."; higher than a later day → "הקילומטראז׳ גבוה מקריאה מאוחרת יותר (N ק״מ)…". Same-day order is not compared. `VehicleRecordEditor.tsx:25`, `lib/maintenance/model.ts:100-107`. Tests: uncovered directly (no test references `mileageIssue` messages).
27. Save not confirmed by server → toast "הסנכרון לא הושלם — בדקו שינויים שעוד לא עלו לענן"; account/vehicle switched mid-save → error "הרכב או החשבון התחלפו". `VehicleRecordEditor.tsx:22-31`. Tests: `e2e/scan-maintenance.spec.ts:44,190`.
28. Generic invalid → "בדקו את השדות: תאריך עד היום, שם, קילומטראז׳ שלם ועלות שאינה שלילית (עד שתי ספרות אחרי הנקודה)."; save error keeps input: "השמירה לא הושלמה. הפרטים נשארו כאן." `CareEditor.tsx:111,135`. Tests: `e2e/scan-maintenance.spec.ts:184`.
29. Stale edit (record changed elsewhere) → retained input and explicit conflict resolution (field labels from `CareConflictDetails`) advancing the version. `CareConflictDetails.tsx`, `lib/maintenance/persistence.ts`. Tests: `e2e/scan-maintenance.spec.ts:58`, `e2e/design-v2-journal-writes.spec.ts:215`, `src/lib/maintenance/persistence.test.ts`.
30. Unknown future schema fields are quarantined, not dropped, on edit. Tests: `src/lib/maintenance/model.test.ts:35`.

### Issue editor ("מה קורה ברכב?" / "מעקב אחר תקלה")
31. New issue: quick chips "רעש מוזר", "נורה בלוח", "רעידות", "ריח" set the title. `VehicleRecordEditor.tsx:54`. Tests: `e2e/design-v2-vehicle.spec.ts:266`.
32. Fields: "שם התקלה" (required ≤120, placeholder "למשל, רעש בזמן בלימה"), "מה שמתם לב?" (symptoms ≤2000), "יום הגילוי" (civil date, `issue-day`), "קילומטראז׳ בגילוי (רשות)", "חשיבות" (למעקב רגיל / חשוב לי לטפל בקרוב), "מצב" (פתוחה / במעקב / נפתרה), "הערות ועדכון". `VehicleRecordEditor.tsx:55-62`. Tests: `e2e/design-v2-vehicle.spec.ts:266`.
33. "טיפולים שקשורים לתקלה" checkboxes over service events, max 8; note "עלויות נספרות דרך הטיפול בלבד. סימון קישור אינו יוצר הוצאה נוספת."; none → "אחרי רישום הטיפול ביומן אפשר לקשר אותו כאן."; missing linked ids kept with note. `VehicleRecordEditor.tsx:61,63`. Tests: `e2e/unified-vehicle.spec.ts:34`.
34. Status change on edit appends `{day: today, status, note: notes[:500]}`; history capped to last 10; disclosure "שינויי המצב האחרונים (עד 10)". `VehicleRecordEditor.tsx:46,64`. Tests: `e2e/design-v2-vehicle.spec.ts:266`, `src/lib/vehicle/derived.test.ts:45`.
35. Validation: invalid date → "בדקו את התאריך — למשל 05/09/2026."; invalid record → "בדקו את הכותרת, התאריך והקילומטראז׳."; record changed since opening → "הרשומה השתנתה. סגרו ופתחו שוב לפני שמירה."; unconfirmed → toast "שמירת התקלה טרם אושרה"; buttons "שמירת תקלה" / "שמירת העדכון" / "שומרים…". `VehicleRecordEditor.tsx:44-51,66`. Tests: `e2e/design-v2-vehicle.spec.ts:266` (Escape during enqueue); messages otherwise uncovered.

## §6 cross-check (Service/expense form + reminder/issue editors)

| §6 item | Status | Evidence |
|---|---|---|
| garage | present (inside "עוד פרטים") | #11 |
| "ריק אם לא ידוע · 0 אם לא שילמתם" | present (service and non-refund expense) | #8, #17 |
| refund | present (expense category "החזר / זיכוי") | #16 |
| odometer validation: lower → error | present, but split: service form only rejects lower than an *earlier-day* reading (`mileageIssue`); the "lower than latest" message is in the current odometer sheet | #24, #26 |
| odometer validation: jump > 1,500 → confirm | **differs** — production threshold is **3,000 km**, and only in the new current-intent odometer sheet; the service form has no jump confirmation | #25, `CareEditor.tsx:124` |
| "לקבוע גם את הטיפול הבא" | partial — exists as the sub-label of "תזכורת חוזרת" in the **reminder** editor, not in the service/expense form | #20 |
| log-from-reminder | present | #14 |
| reminder basis / intervals / source / pause | present | #20–21 |
| issue fields, status, history ≤10, linked services | present (linked capped at 8) | #31–34 |
| "לכלול בעלות הרכב" toggle | missing (expected — §7.1 new) | #17 |

## v3 changes to these forms

May change:
- v3 look per `proto/more.js`/`sheets.js`: hairlines, `--r-md` inputs/chips, Karantina 400 headings, category hues on glyphs (§1, §4); money displays `N ₪` (§5).
- §7.1: add "לכלול בעלות הרכב" toggle to every expense (default on; ⓘ explainer sheet); off writes `excluded: true` (missing field = included), with Firestore rule + rules test, CSV column `excluded_from_tco`, journal tag "לא בעלות הרכב". Must round-trip through drafts, conflicts (`CareConflictDetails` label), backup validation (`validCareRecord` keys) and Undo.
- If the team adopts the §6 wording, any change to the 3,000 km threshold or adding a jump confirm to the service form is a **behaviour change** that needs an explicit decision and test update — not a silent v3 restyle.

Must not change:
- Two-step flow, draft autosave/restore/discard semantics, storage-failure guard, update blocker.
- Unknown cost (empty) vs zero vs refund; integer agorot; ≤2 decimals; no rounding of stored values.
- Dates via civil-date fields; future dates rejected for records.
- Odometer rules (#24–26) and scope/ACK guards; conflict review; schema-field quarantine.
- Plan validation (target required; month interval needs date, km interval needs km), linked-plan cap 8, issue history cap 10.
- EV (§7.4): editors themselves have no tank/engine fields; keep it that way.
