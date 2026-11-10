# Import (ייבוא נתונים) — Stage 0 behaviour checklist

Route `/settings/import` (reached from Account → "ייבוא נתונים").

## Sources

- `src/screens/ImportData.tsx` (screen, `VehiclePicker`, `PreviewStep`, `ReportStep`, `ImportHistory`)
- `src/lib/import/rows.ts`, `plan.ts`, `csv.ts`, `xlsx.ts`, `normalize.ts`, `schema.ts`, `tankUpdates.ts`, `zip.ts`
- Tests: `e2e/import.spec.ts`, `e2e/audit-fixes.spec.ts`, `e2e/outbox-invariants.spec.ts`, `src/lib/import/import.test.ts`, `xlsx.test.ts`, `roundtrip.test.ts`, `audit-roundtrip.test.ts`, `src/lib/outbox.test.ts`

## Behaviours

### Choose step
1. Header title "ייבוא נתונים", back navigates -1. Intro "מעבירים היסטוריה" + "קובץ CSV או Excel, מטנק מלא או מאפליקציה אחרת. הקובץ נקרא רק במכשיר, והשמירה מתחילה רק אחרי האישור שלכם." — `src/screens/ImportData.tsx:389-393`. Tests: `e2e/import.spec.ts` (navigation).
2. No active vehicle → block "צריך רכב אחד לפחות" / "בחרו רכב פעיל כדי לשייך אליו את ההיסטוריה." with button "לרכב שלי" → `/vehicle`; file input disabled — `ImportData.tsx:394-397,404`. Uncovered.
3. Vehicle picker "ייבוא לרכב" (section aria-label "רכב היעד לייבוא"), one `aria-pressed` button per active vehicle, check icon on selected; defaults to active vehicle; changing target bumps the flow version (cancels in-flight parse) — `ImportData.tsx:398-399,450-463`. Tests: `e2e/audit-fixes.spec.ts:79` (repeat import targets the second vehicle).
4. File picker is a native `<label for>` over a hidden `<input type=file accept=".csv,.xlsx,.xls,…">` (preserves Android picker gesture), label "בחירת קובץ" / "CSV · Excel"; input value reset after each pick so the same file can be picked again — `ImportData.tsx:401-408`. Tests: `e2e/import.spec.ts`.
5. Starting a new file while an import or undo is in flight is ignored — `ImportData.tsx:90`. Uncovered (guard).
6. No vehicle id at parse time → error "צריך לבחור רכב לפני הייבוא." — `ImportData.tsx:126-131`. Uncovered.
7. Parsing state: spinner + "קוראים את <file>…" (`role=status`) — `ImportData.tsx:411-413`. Uncovered.
8. `.xlsx/.xls` on a runtime without DecompressionStream → "הדפדפן הזה לא תומך בקריאת קובצי Excel. שמרו את הגיליון כ־CSV ונסו שוב." — `ImportData.tsx:145-155`; `xlsx.test.ts` ("runtime capability").
9. Unsupported/corrupt archive → "לא הצלחנו לקרוא את הקובץ. שמרו אותו כ־CSV ונסו שוב." — `ImportData.tsx:164-170`. Uncovered in e2e.
10. Any other prep failure (incl. server read denied while checking duplicates) → "לא ניתן להכין את הייבוא. נדרשים קובץ CSV או Excel תקין וחיבור לשרת כדי לאמת את הרכב ולבדוק כפילויות." and no import button — `ImportData.tsx:234`. Tests: `e2e/audit-fixes.spec.ts:380` (F05).

### Parsing rules (lib)
11. Header mapping independent of column order; Hebrew apostrophe variants normalised; legacy workbook detected from derived-column block — `src/lib/import/rows.ts`. Tests: `import.test.ts` "header mapping".
12. No date/odometer/litres headers → single rejection "לא נמצאו עמודות תאריך, קילומטראז׳ וכמות דלק — ודאו שהקובץ מכיל שורת כותרות." — `rows.ts:141`. Test: `import.test.ts` "says so when the file has no recognisable headers".
13. Row rejections with reasons: "תאריך לא תקין" (`rows.ts:184`), "קילומטראז׳ חסר או לא תקין" (`:190`), "כמות דלק חסרה או לא תקינה" (`:196`), "אין מחיר לליטר ואין מחיר כולל" (`:213`), "מצב מיכל, מקור מדידה או מחיר תחנה לא תקינים" (`:294`). Tests: `import.test.ts` "rejections", `audit-roundtrip.test.ts` (invalid tank levels).
14. Cell normalisation: bidi marks, NBSP, currency/units, "-" = empty, decimal comma vs thousands, Excel date serials, separate time column at minute precision, impossible dates rejected — `normalize.ts`. Tests: `import.test.ts` "cell normalisation", "date and time parsing"; `xlsx.test.ts`.
15. Legacy file without full-tank column → assumption "לקובץ המקורי אין סימון של תדלוק חלקי. כל התדלוקים ייובאו כתדלוק מלא…" and `fullTankSource` records it as assumed — `rows.ts:157-161`. Tests: `import.test.ts` "defaults to full tank and records that it was an assumption"; `e2e/import.spec.ts:68`.
16. Legacy derived columns ignored with assumption "עמודות החישוב מהקובץ הישן (… עלות לק״מ) לא ייובאו — כל הנתונים האלה מחושבים מחדש מהנתונים הגולמיים." — `rows.ts:163-167`. Test: `import.test.ts` "ignores the legacy derived columns entirely".
17. Legacy reset marker ("התחלת חישוב מחדש") or explicit column → `continuityBreakBefore`; segments never cross a break — `rows.ts:245-250`. Tests: `import.test.ts` ("detects the legacy reset marker…", "computes segments that never cross the break", 2026-05-27 break, 11.56 km/L segment).
18. Warnings: formula-derived cells "שורה N: … חושבו בנוסחה בגיליון ולא הוקלדו — ודאו שהערך מעודכן"; total ≠ price×litres beyond max(₪1, 5%) "שורה N: המחיר הכולל אינו תואם למחיר לליטר כפול הכמות" — `rows.ts:231-243`. Tests: `xlsx.test.ts` "a workbook whose raw inputs are formulas"; total-mismatch uncovered.
19. Duplicate prevention: deterministic row hash ignoring sub-minute differences, per vehicle, also against manually entered fills (no import hash) — `rows.ts` `fillupIdentityHash`; `ImportData.tsx:317-320`. Tests: `import.test.ts` "duplicate prevention"; `e2e/import.spec.ts:110` "re-importing the same file adds nothing".
20. Own export round-trips (format `tank-maleh-v1/v2`), raw values preserved, partial never promoted to full, break carried, machine id kept out of vehicle label — Tests: `roundtrip.test.ts`, `audit-roundtrip.test.ts`, `e2e/import.spec.ts:49`.

### Multi-vehicle source
21. Tank Malle export whose source vehicle still exists → that vehicle becomes the target automatically — `ImportData.tsx:203-209`. Test: `roundtrip.test.ts` "recognises the file as belonging to the vehicle it came from".
22. File with several vehicles → select "רכב המקור בתוך הגיבוי" (labels from file or "רכב N בקובץ"), only that source's rows imported to the shown target; note "רכב היעד: X. לבחירת יעד אחר חזרו לבחירת הקובץ."; assumption "הקובץ מכיל כמה רכבים. ייובאו רק הרשומות של רכב המקור שנבחר…"; changing the select re-parses the same file — `ImportData.tsx:188-196,211-218,414-421`. Test: `e2e/audit-fixes.spec.ts:348` (F04/F08 multi-car backup).

### Preview step (fill-ups)
23. Title "נמצאו N רשומות"; format line "זוהה כ<ייצוא של טנק מלא|יומן תדלוקים ישן|מבנה כללי> · ייובא אל <vehicle>"; notice "הקובץ יוצא מ<label>" when not same vehicle — `ImportData.tsx:466-491`. Test: `e2e/import.spec.ts:68`.
24. Stat rows "שורות בקובץ / ייובאו / כבר קיימות / לא תקינות" (danger tone when >0, muted when 0) — `ImportData.tsx:494-497,581-586`. Tests: `e2e/import.spec.ts:110,131`; `import.test.ts` "reports the plan the preview screen shows".
25. Preview list (aria "תצוגה מקדימה של הרשומות") with date · odometer ק״מ and "כפול"/"חדש", footer "מוצגות N מתוך M רשומות תקינות." — `ImportData.tsx:499-513`. Uncovered (count footer).
26. Rejected rows section "שורות שלא ייובאו", first 8 rows "שורה N" + reason, then "ועוד N שורות." — `ImportData.tsx:518-527`. Test: `e2e/import.spec.ts:131`.
27. Collapsible "פרטים נוספים": date range "טווח תאריכים: X עד Y", "נקודות התחלת תקופה חדשה · N", assumptions, first 6 warnings + disclosure "אזהרות נוספות · N" — `ImportData.tsx:529-540`. Test: `e2e/import.spec.ts:68` (assumptions stated).
28. Primary "ייבוא N רשומות" or disabled "אין מה לייבא"; link "קובץ אחר" — `ImportData.tsx:543-546`. Tests: `e2e/import.spec.ts`, `e2e/outbox-invariants.spec.ts:385`.

### Tank-update import
29. A tank-updates export is detected and shown as "עדכוני מיכל ונסיעות": "N עדכונים לרכב X. רשומות שכבר קיימות לא יוחלפו.", multi-vehicle note "הקובץ מכיל כמה רכבים. ייובאו רק עדכוני הרכב שנבחר.", rejected "שורה N: עדכון מיכל לא תקין או גרסת קובץ לא נתמכת", button "ייבוא N עדכונים" — `ImportData.tsx:183-197,422-432`; `tankUpdates.ts:55`. Test: `e2e/audit-fixes.spec.ts:79` ("ייבוא 2 עדכונים").
30. Tank updates never create purchases — `audit-roundtrip.test.ts` "round trips standalone measurements and plans without creating purchases".

### Importing and report
31. Importing state "מייבאים וממתינים לאישור השמירה…"; each record stamped `importSource`, `importBatchId` (`imp_<base36>`), `importRowHash`, `schemaVersion: 2`, tank-state provenance fields preserved — `ImportData.tsx:236-316,436`. Test: `e2e/outbox-invariants.spec.ts:385`.
32. Waits up to 6 s for server ack; if none, report shows queued and later updates itself when the receipt settles (only for this exact flow) — `ImportData.tsx:247-263`. Test: `e2e/outbox-invariants.spec.ts:385`.
33. Report titles: "הייבוא בוטל" / "הייבוא לא הושלם" / "נשמר במכשיר" / "הייבוא הסתיים חלקית" / "הייבוא הסתיים" / "לא נוספו רשומות" (heading `role=status`) — `ImportData.tsx:555-557`. Tests: `e2e/import.spec.ts:131` (never clean success with bad rows), `e2e/outbox-invariants.spec.ts:442` ("הייבוא לא הושלם").
34. Report stats "נשמרו ואושרו בשרת", "נשמרו במכשיר, ממתינים לסנכרון", "כבר היו קיימות", "לא תקינות", "לא אושרו"; queued notice "…ביטול הייבוא יהיה זמין אחרי האישור."; server refusal reason "השרת לא אישר את הייבוא. בדקו את השינויים שעוד לא עלו לענן לפני ניסיון נוסף."; rejected-rows hint "אפשר לתקן את השורות בקובץ ולייבא שוב. ייבוא חוזר לא ייצור כפילויות." — `ImportData.tsx:344-349,560-570`. Test: `e2e/outbox-invariants.spec.ts:442`.
35. Report actions: "סיום" → `/history`; "ביטול הייבוא" only when imported>0, queued=0, failed=0; link "לשינויים שעוד לא עלו לענן" when queued/failed/undo pending/undo error; "ייבוא קובץ נוסף" (disabled while undo busy) — `ImportData.tsx:438-441,574-578`. Tests: `e2e/import.spec.ts:159`.

### Undo (with server confirmation)
36. Undo confirm dialog "לבטל את הייבוא?" (danger, "ביטול הייבוא"), body "יימחקו רק הרשומות מהייבוא של <file> אל <vehicle>. בייבוא הזה נשמרו N רשומות. רשומות שהוזנו ידנית יישארו." — `ImportData.tsx:443-445`. Test: `e2e/import.spec.ts:159`.
37. Undo results: done → "N רשומות מהייבוא נמחקו, והביטול אושר בשרת." (title "הייבוא בוטל"); pending → "בקשת ביטול הייבוא ממתינה לאישור. עדיין אי אפשר לומר שהרשומות נמחקו."; refused → "ביטול הייבוא לא אושר. אפשר לבדוק…"; exception → "לא ניתן לאשר שביטול הייבוא הושלם…"; double-undo of the same batch blocked — `ImportData.tsx:356-384,560,573`. Tests: `e2e/import.spec.ts:159,200`.
38. "ייבואים קודמים" history (loaded on idle): loading "טוענים את הייבואים הקודמים…", error "לא ניתן לטעון כרגע את הייבואים הקודמים. זה לא אומר שאין היסטוריה." + "ניסיון נוסף", empty "אחרי ייבוא הוא יופיע כאן, ואפשר יהיה לבטל אותו כולו.", cap note at 50; row = file name · "N רשומות · <vehicle>" + "ביטול הייבוא" with confirm body "יימחקו N רשומות שיובאו אל X. רשומות שהזנתם ידנית יישארו. אפשר לייבא את הקובץ שוב אחר כך." — `ImportData.tsx:614-683`. Test: `e2e/import.spec.ts:159` ("rolled back by batch, long after the fact").
39. History-undo toasts: "ביטול הייבוא נכשל" / "בקשת ביטול הייבוא ממתינה לאישור" / "ביטול הייבוא לא אושר" — `ImportData.tsx:652-656`. Uncovered.
40. Re-import after rollback deterministic, same ids; rejected import retries under same ids; import batch doc written with rows (no orphan) — Tests: `e2e/import.spec.ts:200`, `e2e/outbox-invariants.spec.ts:385,442`, `src/lib/outbox.test.ts:631`.
41. Every async step is guarded by account+mount+flow version, so a sign-out/account switch mid-import never writes into another account — `ImportData.tsx:85-100`. Covered indirectly by `e2e/auth-isolation.spec.ts`? Not import-specific → uncovered.

## §6 cross-check

| §6 item | Status | Evidence |
|---|---|---|
| Import fills | present | rows 11-28, 31 |
| Import tank updates | present | rows 29-30 |
| Multi-vehicle source pick | present | row 22 |
| Warnings | present | rows 18, 27 |
| Partial | present | "הייבוא הסתיים חלקית", rejected rows (rows 26, 33) |
| Undo with server confirm | present | rows 36-38 |

No §6 discrepancy for Import. Note: the receipt PDF/text import (`receiptPdf.ts`, `receiptText.ts`) belongs to the fill-up form, not this screen (see `fillup.md`).

## v3 changes to this screen

May change:
- Tone (§1): Karantina 400 titles, hairline borders on groups/rows, radius scale, card shadow.
- Stat rows (`tm-import-stat`) and the report counts may be rendered with the facts strip (§3) — label right, mono value left.
- Category colours do not apply here.

Must not change:
- Every copy string above, the 6 s ack wait and late-receipt update, undo availability rules and server confirmation, duplicate hashing, multi-vehicle source logic, flow/account guards, native label-over-input file picking, `/history` on "סיום".
- No new CSV column is imported unless 5a adds `excluded_from_tco` to the export; if so, the importer must keep accepting files without it (missing = included). Fill-up import is unaffected.
