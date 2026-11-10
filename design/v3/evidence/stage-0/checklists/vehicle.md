# Vehicle area — Stage 0 behaviour checklist

Baseline: `main` @ `05548ba`. Routes (`src/App.tsx:137-141,155`): `/vehicle` (`?tab=due|costs|details|prefs`, `?doc=&vehicle=`), `/vehicle/edit/:vehicleId`, `/vehicle/years/:year`, `/vehicle/reminders/:planId`, `/vehicle/issues/:issueId`, `/settings/vehicles`.

## Sources

- `src/screens/Maintenance.tsx` (Vehicle hub: due / costs / details / prefs tabs)
- `src/screens/VehicleDetails.tsx` (`VehicleYear`, `ReminderDetail`, `IssueDetail`)
- `src/screens/VehicleEdit.tsx`, `src/screens/VehicleManager.tsx`
- `src/components/VehicleOverview.tsx`, `VehicleUI.tsx`, `RunningCosts.tsx`, `VehicleDocuments.tsx`, `TankPreferencesSection.tsx`
- `src/components/maintenance/CareTransfer.tsx`, `src/components/LegacyCareTransfer.tsx` (care backup — mounted from Account, not Vehicle)
- `src/lib/maintenance/model.ts` (`nextDue`, `dueStatus`), `src/lib/maintenance/export.ts`, `src/lib/vehicle/derived.ts` (`periodSummary`, `reminderRows`), `src/lib/vehicle/documents.ts`
- Editors opened from this screen are in `care-forms.md`.

## Behaviours

### Hub — empty state and header
1. No active vehicle → page "הרכב שלי" with "כאן מכירים את הרכב", body "בחרו רכב או הוסיפו אחד כדי לרכז רישוי, ביטוח ותחזוקה.", links "ניהול רכבים" (`/settings/vehicles`) and "הוספת רכב" (`/vehicles/new`). `Maintenance.tsx:34`. Tests: uncovered.
2. `?tab=` accepts only `costs|details|prefs`; anything else (incl. `issues`) or any `?doc=` present → `due` tab. Titles: costs "עלויות הרכב", details "פרטי הרכב", prefs "הגדרות הרכב", due "הרכב שלי". `Maintenance.tsx:31-32,42`. Tests: `e2e/open-design.spec.ts`, `e2e/unified-vehicle.spec.ts` (tab=costs), `e2e/design-v2-shell.spec.ts` (tab=prefs).
3. Non-due tabs show heading + "→ חזרה" back link to `/vehicle` and a vehicle-choice label; on `/vehicle` that label is a link "ניהול רכבים, <label>" to `/settings/vehicles`. `Maintenance.tsx:63`, `VehicleUI.tsx:8-20`. Tests: `e2e/design-v2-vehicle.spec.ts:306` (gallery/focus).
4. `CoverageNotice`: when data incomplete → status "הנתונים חלקיים או ממתינים לאישור מהשרת. הסכום כולל רק עלויות ידועות." `VehicleUI.tsx:22`, `Maintenance.tsx:83`. Tests: uncovered (UI); `src/lib/vehicle/derived.test.ts` covers incomplete flag.
5. Read error on care/extra collections → alert "לא ניתן לקרוא חלק מהנתונים. אפשר לנסות שוב לאחר רענון." `Maintenance.tsx:84`. Tests: uncovered.

### Overview card (due tab)
6. Shows nickname (or "הרכב שלי"), "ניהול רכבים" chip, large plate, make+model, meta "year · fuel short · מיכל N ל׳" with " · הערכה" when `tankLitersSource === 'estimate'` (tank confirmed vs estimate). `VehicleOverview.tsx:14-19`. Tests: `e2e/design-v2-vehicle.spec.ts:306`.
7. Odometer instrument: label "קילומטראז׳ · <day>"; "עדכון" chip and tapping the odometer open the odometer editor with `odometerIntent: 'current'`. `VehicleOverview.tsx:13,20-22`. Tests: `e2e/design-v2-vehicle.spec.ts:129`.
8. Same-day ambiguous readings → odometer shows no value and note "תועדו A–B ק״מ באותו יום. סדר הקריאות אינו ידוע."; no reading → "מוסיפים את הקריאה שמופיעה בלוח הקילומטרים." `VehicleOverview.tsx:22-24`. Tests: `src/lib/vehicle/derived.test.ts` ("labels ambiguous same-day readings").

### Documents — "רישוי וביטוח"
9. Always three rows: "טסט שנתי", "ביטוח חובה", "ביטוח רכב" (incl. empty and unreadable). `VehicleDocuments.tsx:42,80-97`, `lib/vehicle/documents.ts:6-8`. Tests: `e2e/design-v2-vehicle.spec.ts:75`.
10. Row description: absent test → "מתי הטסט הבא?"; absent insurance → "חברה, תוקף ועלות שנתית"; coverage none → "סימנת שאין ביטוח מקיף או צד ג׳"; otherwise type · insurer · "בתוקף עד <d/m/y>" · "<₪> לשנה" (whole-shekel `shekel`); partial → "פרטים חלקיים · להשלמה"; unreadable → "הפרטים השמורים אינם זמינים לעריכה". `VehicleDocuments.tsx:32-40`. Tests: `e2e/design-v2-vehicle.spec.ts:75`, `src/components/vehicleDocumentDraft.test.ts`.
11. Row status: "לא זמין" / "פג תוקף" (days<0, warning icon) / "היום" + "יום אחרון" / N + "יום נותר"/"ימים נותרו" (`data-soon` when <30) / "הוספה" / "שינוי". `VehicleDocuments.tsx:87-95`. Tests: `e2e/design-v2-vehicle.spec.ts:75,162`.
12. Opening a row writes `?doc=<key>&vehicle=<id>` (Back/notification can open/close it); link for another vehicle → "המסמך שבקישור שייך לרכב אחר. בחרו אותו בניהול רכבים." `VehicleDocuments.tsx:54-77,99`. Tests: `e2e/design-v2-vehicle.spec.ts:162`.
13. Sheet: coverage segmented "מקיף / צד ג׳ / אין"; "אין" → note that it clears insurer/due/cost and hides fields; insurer field + 12 insurer chips; date "תוקף הטסט"/"בתוקף עד"; cost "עלות שנתית (רשות)" / "אגרת רישוי + טסט, בשנה (רשות)"; note "נכנס לחישוב ״כמה הרכב עולה לך בחודש״."; info "על תזכורות הרישוי" (month + week before). `VehicleDocuments.tsx:186-193`. Tests: `e2e/design-v2-vehicle.spec.ts:75`.
14. Only dirty fields are written; save disabled until dirty; untouched exact cost preserved; authored zero vs clear distinct; field-level errors focus the field. `VehicleDocuments.tsx:147-178,196`. Tests: `e2e/design-v2-vehicle-writes.spec.ts:114`, `src/components/vehicleDocumentDraft.test.ts`.
15. Unreadable stored doc → read-only warning (not replaced with empties) + "אפשר להוריד גיבוי…"; unconfirmed base → "הפרטים עדיין לא אומתו לשמירה…". `VehicleDocuments.tsx:182-183`. Tests: `e2e/design-v2-vehicle-writes.spec.ts:328`.
16. Save not accepted by server → toast "השמירה טרם אושרה"; scope change (vehicle A→B→A) never mutates a newer sheet. `VehicleDocuments.tsx:160-177`. Tests: `e2e/design-v2-vehicle-writes.spec.ts:140,247,301`.

### Reminders — "תזכורות"
17. "+ תזכורת" opens the plan editor; no active reminders → "מה כדאי שנזכיר לכם?". `Maintenance.tsx:68-69`. Tests: `e2e/scan-maintenance.spec.ts:18`.
18. Dashed suggestion chips "טיפול תקופתי", "החלפת שמן", "החלפת צמיגים" shown only when no reminder of that job exists; they open the editor with `initialJob`. `Maintenance.tsx:23,70`. Tests: `e2e/home-cost-insights.spec.ts`, `e2e/open-design.spec.ts` (החלפת שמן).
19. Row: job glyph, title, subtitle "<date> או <N ק״מ>" + " · המוקדם מביניהם" when both; countdown N + "יום נותר"/"ימים נותרו"/"ק״מ נותרו" only for soon/later with a single trigger; else status label "הגיע הזמן / מתקרב / נדרש עדכון ק״מ / בהמשך / הושלם"; km countdown only if latest reading ≤30 days old and unambiguous. `Maintenance.tsx:22,44-59`. Tests: `src/lib/maintenance/model.test.ts` (dueStatus), `e2e/design-v2-foundation.spec.ts:332`.
20. Due status: due if date ≤ today or odometer crossed; unknown if mileage missing/older than 30 days; soon within 30 days or 1,000 km. `lib/maintenance/model.ts:88-98`. Tests: `src/lib/maintenance/model.test.ts:15,47`.
21. Paused reminders grouped in a disclosure "תזכורות מושהות <N>", rows labelled "מושהית". `Maintenance.tsx:39,57,71`. Tests: uncovered.
22. Info "איך נקבע מועד התזכורת?" (date and km checked separately; earliest wins). `Maintenance.tsx:72`. Tests: uncovered.

### Reminder detail (`/vehicle/reminders/:planId`)
23. Unknown plan → "התזכורת אינה זמינה ברכב הפעיל." (or "טוענים…"). `VehicleDetails.tsx:43`. Tests: uncovered.
24. Hero eyebrow "המועד הבא · מההשלמה|מחזור קבוע|הגדרה ידנית" (basis); headline date / "לפי קילומטראז׳" / "הטיפול תועד"; "או N ק״מ · המוקדם מביניהם"; "נדרשת קריאת ק״מ בטיפול האחרון כדי לחשב את היעד הבא." / "התזכורת פעילה" / "התזכורת מושהית"; intervals "כל N חודשים או כל N ק״מ" (not for manual). `VehicleDetails.tsx:46-49`. Tests: `e2e/unified-vehicle.spec.ts:37`, `src/lib/maintenance/model.test.ts`.
25. Next due recomputed from completed services (never stored): completion basis = last + interval; fixed basis keeps milestones; manual completes on first linked service. `lib/maintenance/model.ts:71-87`. Tests: `src/lib/maintenance/model.test.ts:7,11,27,30,40`.
26. "רישום טיפול שבוצע" (hidden when completed) opens the service editor with `completePlan` (log-from-reminder). `VehicleDetails.tsx:50`. Tests: `e2e/open-design.spec.ts`, `e2e/scan-maintenance.spec.ts:170`.
27. "עריכת התזכורת" opens plan editor; "היסטוריית הטיפולים" → `/history?kind=service&plan=<id>` with "N טיפולים מקושרים". `VehicleDetails.tsx:52-53`. Tests: `e2e/unified-vehicle.spec.ts:37`.
28. "הוספה ליומן המכשיר" (only when a date target exists and not completed) downloads `tank-maleh-reminder.ics` (date-only VEVENT, escaped, UTF-8-folded lines, timestamped filename); inactive/completed/km-only → no file. `VehicleDetails.tsx:54`, `lib/maintenance/export.ts:51-66`. Tests: `src/lib/maintenance/export.test.ts:26`, `e2e/scan-maintenance.spec.ts:124`.
29. Snooze is not on this screen: "דחיית הופעת ההתראה" links to `/notifications`; info "על דחיית התראה וייצוא ליומן" explains snooze does not move the due date. `VehicleDetails.tsx:55,59`. Tests: `e2e/unified-vehicle.spec.ts:37`.
30. Source line "מקור: הגדרה שלי|המלצת מוסך|הוראות יצרן"; notes shown pre-wrap. `VehicleDetails.tsx:58,60`. Tests: uncovered.
31. "מחיקת התזכורת" → confirm "מחיקת התזכורת?" / "הטיפולים שכבר תועדו נשארים ביומן."; double-submit guarded; after submission navigates to `/vehicle` and shows Undo toast after ACK; failure → inline alert. `VehicleDetails.tsx:56,62-74`. Tests: `src/components/vehicleRecordDeletion.test.ts`.

### Issues — "מה קורה ברכב"
32. Open/watching issues listed with symptoms (or day) and status "פתוחה/במעקב"; `data-soon` highlight when importance "important"; add row "משהו השתנה ברכב?" / "רעש, נורה, תקלה. נעקוב עד שזה מתוקן" opens issue editor. `Maintenance.tsx:40,61,74`. Tests: `e2e/design-v2-vehicle.spec.ts:266`, `e2e/unified-vehicle.spec.ts:34`.
33. Resolved issues in disclosure "תקלות שנפתרו <N>", auto-open when `?tab=issues`. `Maintenance.tsx:41,74`. Tests: uncovered (resolved-group rendering).
34. Issue detail: status "פתוחה|במעקב|נפתרה · חשובה|למעקב"; eyebrow "זוהתה ב־<day> · N ק״מ"; symptoms or "לא תועדו תסמינים נוספים."; not found → "התקלה אינה זמינה ברכב הפעיל." `VehicleDetails.tsx:96,121-123`. Tests: `e2e/design-v2-vehicle.spec.ts:266`.
35. "תוקן" (`issue-resolve`) sets status resolved, appends history `{day,status,note}` capped to last 10, success toast "סומן כתוקן"; unaccepted → "סימון התיקון טרם אושר…"; button shows "שומרים…" while saving. `VehicleDetails.tsx:98-124`. Tests: `e2e/design-v2-vehicle.spec.ts:266`.
36. "עדכון מצב וקישור לטיפול" opens the issue editor. Linked services listed (title, day, whole-shekel cost) and open the service editor; missing link → "הטיפול המקושר הוסר או אינו זמין."; none → "עדיין לא קושרו טיפולים לתקלה."; info says repair cost counts once via the service. `VehicleDetails.tsx:125-127`. Tests: `e2e/unified-vehicle.spec.ts:34`.
37. History disclosure "שינויי מצב <N>" with "<day> · <status> · <note>". `VehicleDetails.tsx:128`. Tests: `e2e/design-v2-vehicle.spec.ts:266`.

### Links block and add bar (due tab)
38. "<year> עד עכשיו" link → costs tab with YTD total (`vehicleMoney`, whole ₪) and sub "הסכום הידוע · נתונים חלקיים" when incomplete/unknown else "עלויות הרכב". `Maintenance.tsx:37,76`. Tests: `e2e/unified-vehicle.spec.ts:20`.
39. "טיפולים" → `/history?kind=service` with "N רשומות ביומן"; "פרטי הרכב" → edit; "הגדרות הרכב" → prefs tab. `Maintenance.tsx:77-79`. Tests: `e2e/open-design.spec.ts`.
40. Add bar "＋ טיפול", "＋ הוצאה / החזר" (no "ק״מ" on hub/costs). `VehicleUI.tsx:21`, `Maintenance.tsx:81,85`. Tests: `e2e/scan-maintenance.spec.ts:18`.

### Costs tab — "כמה עלה" by period
41. Period picker "תקופת הסיכום": "כל התקופה / השנה / החודש" (default all). `Maintenance.tsx:33,85`. Tests: `e2e/unified-vehicle.spec.ts:20`.
42. `RunningCosts`: header "עלויות הרכב" + "לרשומות ←" (→ `/history?from&to` or `?year=`); "הוצאות מתועדות · <period>"; total `running-total`; sub "N עלויות חסרות." + "הנתונים עדיין חלקיים." / "סכומים ידועים בלבד, ללא ירידת ערך."; rows "רכישות דלק / טיפולים / הוצאות נוספות / החזרים" (refund negative). `RunningCosts.tsx:7-15`. Tests: `src/components/RunningCosts.test.ts:35,64`, `src/lib/vehicle/derived.test.ts:16,22`.
43. Per-km pair "הכול לק״מ" and "רכישות דלק לק״מ" in "אג׳ לק״מ" (integer agorot), both on the same covered interval; unknown → "—"; known zero ≠ unknown. `RunningCosts.tsx:12,16`. Tests: `src/components/RunningCosts.test.ts:35,55`, `src/lib/vehicle/derived.test.ts:26,31,49,50`.
44. Disclosure "איך מחושבות העלויות?" explains distance, boundary-unknown, inconsistent mileage, continuity break, unknown costs not zero. `RunningCosts.tsx:17`. Tests: `src/components/RunningCosts.test.ts:64`.
45. "לפי שנה": one row per ledger year (desc) with total, 3-part bar (fuel/maintenance/other before refunds, aria-label "חלוקת הוצאות לפני החזרים: …"), "N רשומות · הוחזרו X · N עלויות חסרות"; row → `/vehicle/years/<year>`. `Maintenance.tsx:36,85`. Tests: `e2e/unified-vehicle.spec.ts:44`.

### Year screen (`/vehicle/years/:year`)
46. Non-4-digit year → "לא נמצאה שנה" / "בחרו שנה מאזור הרכב."; else "שנת <year>", back to costs tab, `RunningCosts` for Jan 1–Dec 31, link "כל הרשומות של השנה" → `/history?year=<year>`, note "N רשומות בשנה זו." `VehicleDetails.tsx:18-24`. Tests: `e2e/unified-vehicle.spec.ts:44`.

### Details tab — declared consumption
47. Definition list: "יצרן ודגם", "שנת ייצור" (or "לא תועדה"), "מספר רישוי" ("לא תועד"), "סוג דלק" (full label), "נפח מיכל" ("N ל׳"/"לא ידוע"), "צריכה מוצהרת" in user units or "לא תועדה". `Maintenance.tsx:86`. Tests: uncovered (details tab content).
48. "עריכת פרטי הרכב" button; links "היסטוריית הטיפולים", "רכבים נוספים וארכיון", "הנתונים שלי וגיבוי". `Maintenance.tsx:86`. Tests: uncovered.

### Prefs tab
49. Embeds tank preferences (`TankPreferenceControls`, see `tank-sheets.md`); with >1 active vehicle lists them with "פעיל"/"בחירה" and switches active vehicle (error toast "בחירת הרכב לא נשמרה"); links "רכבים וארכיון", "הוספת רכב", "העדפות האפליקציה". `Maintenance.tsx:87`. Tests: `e2e/design-v2-shell.spec.ts`, `e2e/ui-review.spec.ts`.

### Vehicle edit (`/vehicle/edit/:id`)
50. Missing vehicle → "הרכב אינו זמין בחשבון הזה." / "טוענים את פרטי הרכב…"; deletion pending → "מחיקת הרכב כבר החלה…". `VehicleEdit.tsx:34-35`. Tests: uncovered.
51. Fields: plate (digits ≤8, hint formatted plate or "אפשר להזין את הפרטים גם ללא מספר רכב"), nickname, make (required), model, year (error "שנה בין 1900 ל־2100"), fuel segmented 95/98/diesel/other, tank (error "נפח מיכל בין 0 ל־500 ליטר (ללא אפס)"), declared "נתון יצרן"/"צריכת ייחוס משוערת" ק״מ/ל׳ (error "הצריכה חייבת להיות מספר חיובי"). `VehicleEdit.tsx:73-76,161-175`. Tests: `e2e/design-v2-vehicle.spec.ts:236`.
52. Non-95 fuel → warning "רק לבנזין 95 יש מחיר מרבי בפיקוח…". `VehicleEdit.tsx:168`. Tests: uncovered.
53. Tank source hints: estimate "הערכה לפי סוג הרכב — אפשר לאשר…", trusted "נתון ממפרט יצרן", legacy "הערך הקיים נשמר בלי מקור ידוע…"; chip "בדקתי — זה נפח המיכל" promotes to user-confirmed; chip "שימוש בהערכה: N ליטר" fills an estimate. Declared hints for co2-estimate / other-year. `VehicleEdit.tsx:171-175`. Tests: uncovered.
54. "עדכון ממשרד התחבורה": plate <5 digits → spec lookup by identity; else plate lookup fills make/model/year/fuel + registry codes, note "הפרטים ממשרד התחבורה מוצגים לבדיקה. הם יישמרו בלחיצה על שמירה."; not found / unavailable / cached fallback messages; specs only fill untouched empty non-user fields ("נמצאו נתוני מפרט. נתונים שכבר הזנתם נשארו בטופס." / "אין מפרט תואם במאגר…"). No EV fields. `VehicleEdit.tsx:79-125,162-163`. Tests: uncovered for refresh (`src/lib/plateLookup.test.ts`, `src/lib/vehicleSpecs.test.ts` cover libs).
55. Save writes only dirty fields; exact decimals preserved; waits for server ACK → toast "פרטי הרכב עודכנו" and navigates back; not accepted → "השינוי טרם אושר…" + link "שינויים שעוד לא עלו לענן"; invalid → "בדקו את השדות המסומנים ואת שם היצרן." and focus first invalid. `VehicleEdit.tsx:127-155,178-180`. Tests: `e2e/design-v2-vehicle.spec.ts:236`.

### Vehicle manager (`/settings/vehicles`)
56. Header "הרכבים שלי"; active cards (link to edit) and "בארכיון" section; empty "איזה רכב מצטרף?"; "הוספת רכב". `VehicleManager.tsx:115-121`. Tests: `e2e/design-v2-vehicle.spec.ts:306`.
57. Archive confirm "להעביר לארכיון?" (records kept, reversible); restore "החזרה"; delete confirm "למחוק את הרכב?" ("…יימחקו לצמיתות. לא ניתן לשחזר.") / "השלמת מחיקה" when pending; pending labels and server-wait note; success toasts. `VehicleManager.tsx:72-79,109,133-136`. Tests: `e2e/vehicle-archive.spec.ts`, `e2e/scan-maintenance.spec.ts:190`.
58. Active-vehicle selection follow-up (pending/blocked) section with link "בדיקת הבחירה שנשמרה"; focus follows the same logical card across DOM replacement. `VehicleManager.tsx:40-57,126-132`. Tests: `e2e/vehicle-archive.spec.ts`, `e2e/design-v2-vehicle.spec.ts:306`.

### Care backup / export / import (mounted in Account → "הנתונים שלי")
59. Row "גיבוי וייצוא תחזוקה" / "תאימות לגיבויי התחזוקה הקודמים · הרכב הפעיל" opens sheet. `LegacyCareTransfer.tsx:14`, `components/account/AccountData.tsx:116`. Tests: `e2e/design-v2-shell.spec.ts`, `e2e/scan-maintenance.spec.ts:124`.
60. "הורדת גיבוי" → `tank-maleh-care.json` (format/version/ILS/incomplete flag); "ייצוא עלויות CSV" → BOM CSV, refunds negative, formula prefixes escaped. Incomplete local copy → warning. `CareTransfer.tsx:43-46`, `lib/maintenance/export.ts:7-48`. Tests: `src/lib/maintenance/export.test.ts:6,22,33`.
61. "בחירת גיבוי לשחזור": >5 MB rejected; preview "רכב בקובץ / רכב יעד", "N רשומות חדשות · N כבר קיימות · N עם תוכן שונה"; conflicts block import; mandatory checkbox "בדקתי שהרשומות שייכות לרכב היעד…"; import disabled until server data loaded ("ייבוא זמין אחרי…"); result "N רשומות יובאו ואושרו בשרת." `CareTransfer.tsx:20-58`. Tests: `src/lib/maintenance/export.test.ts:13,18`, `e2e/scan-maintenance.spec.ts:124`.

## §6 cross-check (Vehicle)

| §6 item | Status | Evidence |
|---|---|---|
| "כמה עלה" by period | present (as "עלויות הרכב" + period picker all/year/month; no facts strip) | #41–44 |
| by-year rows → year screen | present | #45–46 |
| reminders: basis completion/fixed/manual | present | #24–25, care-forms |
| km/months intervals | present | #24 |
| source | present | #30 |
| log-service | present | #26 |
| .ics export | present | #28 |
| snooze | partial — no snooze control on Vehicle; detail links to Notifications, snooze is per notification occurrence | #29 |
| pause | present (via "תזכורת פעילה" toggle in editor) | #21, care-forms |
| linked services | present | #27 |
| paused group | present | #21 |
| issues: symptoms, day, odo, importance, status, history ≤10, linked services | present (linked ≤8) | #32–37, care-forms |
| resolved group | present | #33 |
| declared consumption | present (details tab + edit) | #47, #51 |
| tank confirmed/estimate | present | #6, #53 |
| care backup/export/import | partial — exists, but lives in Account → הנתונים שלי, not on the Vehicle screen | #59–61 |
| business statement | **missing-in-production** — no `biz` field, no monthly statement, no "דוח חודשי לעסק" anywhere in `src/` (it is §7.2 new work) | grep `biz`/`דוח חודשי` → none |
| EV (plate refresh pulls battery/WLTP/motor) | **missing** — fuel types only 95/98/diesel/other; refresh maps no EV fields | `VehicleEdit.tsx:167`, `lib/format.ts:217` |

## v3 changes to this screen

May change:
- Costs tab / YTD link → facts strip (§3) for "כמה עלה" and year screen; category hues (§4) in year bars and legends; hairlines/radii/Karantina 400 (§1); money as `777 ₪` via shared formatter (§5), "לק״מ".
- Add entry "דוח חודשי לעסק" (§7.2) and vehicle `biz` fields (company, driver, usage %), with rules test.
- §7.1: expenses with `excluded: true` stay in journal totals but must be removed from `periodSummary`-driven per-km, averages and TCO shown here; "לא בעלות הרכב" tag.
- §7.4: EV vehicles — "עדכון ממשרד התחבורה" pulls `powertrain`, `battery.kwh`, `battery.wltp`, `motorKw`; no tank/engine/"נפח מיכל" rows or warnings for EVs (overview meta, details tab, edit form).

Must not change:
- Next-due/status computed from raw records (never stored); date and km independent, earliest wins; 30-day/1,000 km lead; km countdown only from fresh unambiguous reading.
- Three permanent document rows, dirty-only writes, unreadable docs preserved, scope guards and ACK-based toasts.
- Per-km on one shared covered interval; unknown ≠ zero; refunds subtracted; exact agorot retained.
- Issue history cap 10, resolve flow, linked-service cost counted once; delete-with-Undo after ACK.
- Vehicle edit preserves exact untouched numbers; archive/delete confirmations and follow-ups.
- Care backup format, conflict blocking and mandatory checkbox (location may stay in Account).
