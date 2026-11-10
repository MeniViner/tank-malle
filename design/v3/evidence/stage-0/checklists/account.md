# Account (חשבון) — Stage 0 behaviour checklist

Baseline: `05548ba`. Route `/account` (`src/App.tsx:152`); `/settings` and `/settings/profile` redirect to `/account` (`src/App.tsx:153-154`).

## Sources

- `src/screens/Account.tsx` (composition)
- `src/components/account/AccountIdentity.tsx`, `AccountFuel.tsx`, `AccountPreferences.tsx`, `AccountData.tsx`, `AccountMore.tsx`, `AccountActions.tsx`, `useAccountSummary.ts`, `useAccountScope.ts`
- `src/components/UnifiedTransfer.tsx` (full backup / restore preview), `src/components/LegacyCareTransfer.tsx` → `src/components/maintenance/CareTransfer.tsx`
- `src/components/NotificationPreferences.tsx` (see `notifications.md`), `src/components/UpdateCheckButton.tsx`
- `src/lib/accountExport.ts`, `src/lib/csv.ts`, `src/lib/vehicle/backup.ts`, `src/lib/restorablePreferences.ts`, `src/lib/accountDeletion.ts`, `src/lib/share.ts`, `src/lib/version.ts`
- **Dead code:** `src/screens/Profile.tsx` and `src/screens/Settings.tsx` are not imported by any route or module (grep for `screens/Profile` / `screens/Settings` returns nothing). They contain an older copy of the same features; do not treat them as the live screen. v3 may delete them, but nothing in them is reachable today.

## Behaviours

### Structure
1. Header title "חשבון", back label "חזרה", back navigates to `/` (not history back). `src/screens/Account.tsx:28` — covered by `e2e/design-v2-shell.spec.ts` ("Account and shell evidence…").
2. Section order: identity button → (if not deletion-pending) דלק ומחיר → תצוגה → התראות → השוואה לנהגים → הנתונים שלי → ניהול (admin only, after claims load) → עוד (incl. sign-out/delete). `src/screens/Account.tsx:30-42`, `AccountPreferences.tsx:50-109` — `e2e/home-profile-update.spec.ts` ("backup belongs to My Data after account information"), `e2e/design-v2-shell.spec.ts`.
3. Account deletion pending → role=alert "מחיקת החשבון ממתינה להשלמה. נתונים שכבר נמחקו לא ישוחזרו. רעננו ונסו שוב דרך ״מחיקת החשבון״ למטה." and all middle sections hidden; identity + עוד remain. `src/screens/Account.tsx:31-33` — `e2e/audit-fixes.spec.ts` (F01/F02 partial deletion).
4. Whole body is keyed by uid: switching account remounts sheets/pending requests; every async completion is guarded by `useAccountScope` (A→B→A late results are dropped). `src/screens/Account.tsx:17-19`, `useAccountScope.ts:4-15` — `e2e/design-v2-shell.spec.ts` ("a delayed vehicle selection cannot close or toast…", "an export finishing after Account unmount cannot download…"), `e2e/auth-isolation.spec.ts`.
5. Admin: "ניהול" section with row "לוח בקרה" → `/admin`, only when `claimsLoaded && isAdmin`. `src/screens/Account.tsx:37-40` — `e2e/design-v2-shell.spec.ts` (`account-admin`).

### Identity (פרטי החשבון)
6. Identity button: avatar 61px, display name (fallback "החשבון שלי"), email as LTR `<bdi>`, pill "מנהל מערכת" for admins; aria-label "<name>, <email> · פרטי החשבון והפעילות שלי"; opens sheet "פרטי החשבון". `AccountIdentity.tsx:23-33` — `e2e/design-integration.spec.ts`, `e2e/auth-isolation.spec.ts`.
7. Sheet rows: "חבר מאז" = Firebase `metadata.creationTime` (fullDate) or "—" when missing/invalid. `AccountIdentity.tsx:15-16,36` — uncovered (value), row presence in `e2e/design-v2-shell.spec.ts`.
8. "התחברות קודמת": `undefined` → "טוענים…"; `null` → "זו ההתחברות הראשונה"; else "נכנס לאחרונה <loginMoment>". Uses `previousLoginAt` (rotated once per real authentication), never `lastSignInTime`. `AccountIdentity.tsx:37-38` — `e2e/auth-isolation.spec.ts` ("a refresh does not invent a new previous login", "previous login advances only after a genuine new authentication").
9. "שיטת התחברות" = "חשבון Google" (hard-coded); "הרשאות" = "מנהל מערכת" only for admins. `AccountIdentity.tsx:39-40` — uncovered.

### Activity (הפעילות שלי · all vehicles)
10. "הפעילות שלי" / "כל הרכבים, כולל הארכיון": four metrics — תדלוקים (count, sub "<litres> ליטר בסך הכול"), סה״כ הוצאה (`vehicleMoney`, whole shekels), ק״מ שתועדו (unit ק״מ), רכבים. `AccountIdentity.tsx:42-57` — `e2e/audit-fixes.spec.ts` (F08 "profile counts and exports all vehicles including archived ones"), `e2e/unified-vehicle.spec.ts` ("known monthly running costs agree across ledger, vehicle, insights and profile").
11. Total spend sub-line: if any record has unknown cost → "<n> רשומות עם עלות חסרה לא נכללו"; else if all fuel costs known and litres > 0 → "כולל תחזוקה והוצאות · ממוצע דלק <price 2dp> לליטר"; else "רכישות דלק, טיפולים והוצאות פחות החזרים". `AccountIdentity.tsx:19-20,48-51` — partially `e2e/unified-vehicle.spec.ts`; unknown-cost branch uncovered.
12. Distance unknown (insufficient odometer coverage) → value "—" and "אין כיסוי קילומטראז׳ מספק בכל הרכבים"; otherwise "המרחק שתועד בכל הרכבים". `AccountIdentity.tsx:52-53` — uncovered.
13. Vehicles metric sub: archived exist → "<a> פעילים · <b> בארכיון"; exactly one active → its nickname or "make model"; else none. `AccountIdentity.tsx:54-56` — `e2e/audit-fixes.spec.ts` (F08, F17).
14. Data source: server snapshot of all vehicles (`loadAccountExport`, debounced 100 ms, refetched on catalog change, active vehicle change, import, refresh) overlaid with live active-vehicle data only when every live source is ready; otherwise server-only. `useAccountSummary.ts:22-53` — `e2e/audit-fixes.spec.ts` (F17 "summary refreshes edited liters/date and removes archived vehicles").
15. Freshness note: "נתוני שאר הרכבים נכונים ל־<HH:MM>." or "טוענים את סיכום החשבון."; then "נתוני הרכב הפעיל כוללים מידע מקומי או שטרם סונכרן." / "הרכב הפעיל מתעדכן בזמן אמת." / "הרכב הפעיל יוצג לפי תמונת השרת עד השלמת הטעינה.". `AccountIdentity.tsx:58-62` — uncovered.
16. Snapshot failure → role=alert "לא ניתן לרענן את נתוני כל הרכבים. נדרש חיבור לשרת."; button "רענון הסיכום" / "מרעננים…", disabled while loading or deletion pending. `useAccountSummary.ts:30`, `AccountIdentity.tsx:63-66` — uncovered.

### Fuel & price (דלק ומחיר)
17. 95 vehicles only: row "הנחה בתדלוק" showing percent / per-litre (2dp) or "אין"; opens `FuelDiscountSheet`. `AccountFuel.tsx:29-31,48-49` — `e2e/tank-pricing-followup.spec.ts`, `e2e/design-v2-shell.spec.ts`.
18. Price row title per fuel: "מחיר בנזין 95" / "מחיר בנזין 98" / "מחיר סולר" / "מחיר הדלק"; value `price()` 2dp or "—"; aria-label "<title>, <price|לא ידוע>". `AccountFuel.tsx:23,33-35` — `e2e/home-profile-update.spec.ts`.
19. 98/diesel with no official price → market row "מחירון בנזין 98" / "מחירון סולר" from `useMarketFuelPrice`, sheet renders `MarketFuelPrice`. `AccountFuel.tsx:24,32,45,53-58` — `e2e/home-profile-update.spec.ts` ("diesel list price refreshes independently and never becomes a receipt default", "98 is labelled as a network reference…").
20. Price sheet: big reading, "<fuel label> · <describeOfficialPrice | אין מחיר רשמי לסוג הדלק הזה>", "עודכן <day month>" when known; for 95: "המחיר הרשמי הוא תקרה. המחיר ששולם בפועל נשמר בכל תדלוק, והנחה אישית נשארת נפרדת ממנו.". `AccountFuel.tsx:37-47` — partially `e2e/home-profile-update.spec.ts`.

### Display (תצוגה)
21. "צבע" row → sheet with accent swatches (aria-pressed, `accent-<id>` test ids, swatch colour per resolved theme); choosing saves `accentColor` and clears `customAccent`. `AccountPreferences.tsx:53-55,117-128` — `e2e/design-v2-foundation.spec.ts` ("six accessible swatches persist…", "legacy and custom accent data normalize…").
22. "מראה" → ChoiceList לפי המכשיר / בהיר / כהה; applied immediately and saved as `theme`. `AccountPreferences.tsx:20-24,56,111-113` — `e2e/design-integration.spec.ts` ("display choices persist…").
23. "יחידת צריכה" → ק״מ לליטר / ליטר ל-100 ק״מ (default ק״מ לליטר). `AccountPreferences.tsx:25-28,57-58,114-116` — `e2e/design-integration.spec.ts`, `e2e/design-v2-home.spec.ts`.
24. Toggle "כפתור תדלקתי פותח מצלמה" (`quickEntry === true`, default off); failure toast "העדפת התדלוק לא נשמרה" / "בדקו את החיבור ונסו שוב". `AccountPreferences.tsx:59-62,42-47` — `e2e/design-v2-entry.spec.ts`, `e2e/design-v2-shell.spec.ts` ("the FAB starts manually by default…"), `e2e/ui-review.spec.ts`.
25. Any failed preference save → error toast "ההעדפה לא נשמרה" (or the specific title). `AccountPreferences.tsx:42-47` — uncovered.

### Notifications (התראות)
26. Row "כל ההתראות" → `/notifications` (navigation, not a master switch). `AccountPreferences.tsx:69` — `e2e/design-v2-shell.spec.ts`.
27. Inline toggles "טסט, ביטוח וטיפולים" (`reminderNotifications`) and "שינוי במחיר הדלק" (`priceNotifications`), both default on. `AccountPreferences.tsx:70-75` — uncovered by name; defaults in `src/lib/vehicle/notificationPreferences.test.ts`.
28. "העדפות התראות" → `NotificationPreferences` sheet (details in `notifications.md`). `AccountPreferences.tsx:76,129` — `e2e/ui-review.spec.ts`, `e2e/design-v2-shell.spec.ts`.

### Community sharing (השוואה לנהגים)
29. Fuel sharing toggle "שיתוף סיכום דלק להשוואה" — **default ON** (`shareBenchmarks !== false`), ⓘ "מה משותף בהשוואה" opens sheet "השוואה לנהגים" (4 paragraphs: what is shared; "שם, מייל, מספר רישוי, קילומטראז׳, מועדי התדלוקים ותחנות אינם משותפים."; identifiers; withdrawal). `AccountPreferences.tsx:83-87,145-152` — `e2e/audit-fixes.spec.ts` (F03), `e2e/cost-community.spec.ts`.
30. Fuel sharing off → status: "שיתוף הדלק כבוי. סיכומי הדלק הוסרו מהשרת." / "הסרת סיכומי הדלק עדיין לא אושרה. נדרש חיבור לשרת." + "ניסיון חוזר" / "ממתינים לאישור הסרת סיכומי הדלק מהשרת…". `AccountPreferences.tsx:103-108` — `e2e/audit-fixes.spec.ts` (F03 "Settings withdraws every contribution and reports the server result").
31. Cost sharing toggle "שיתוף סיכום עלות הרכב" — separate, **default OFF** (`shareTcoBenchmarks === true`). Turning ON never saves directly: it opens consent sheet "שיתוף סיכום עלות הרכב" (`cost-sharing-consent`) whose first line is "השיתוף הזה נפרד משיתוף נתוני הדלק וכבוי כברירת מחדל."; only "אישור והפעלת שיתוף עלות" saves; failure toast "שיתוף העלות לא הופעל". Turning OFF saves immediately. ⓘ "מה משותף בסיכום העלות" opens the same sheet. `AccountPreferences.tsx:88-92,130-144` — `e2e/cost-community.spec.ts` (all 7 tests).
32. Cost sharing status line: off → "שיתוף העלות כבוי. סיכומי העלות הוסרו מהשרת." / "…הסרת הסיכומים מהשרת טרם אושרה." + "ניסיון חוזר" / "…ממתינים לאישור הסרת הסיכומים מהשרת…"; on → "סיכום עלות חיובי משותף רק כשהרישומים מלאים ומסונכרנים. פרטים חסרים אינם משותפים." or publication error + "ניסיון חוזר". `AccountPreferences.tsx:94-102` — `e2e/cost-community.spec.ts` ("offline cost opt-out never claims server withdrawal before reconnection…").
33. Backup restore never grants optional financial-summary consent. `src/lib/restorablePreferences.ts` — `src/lib/restorablePreferences.test.ts`.

### My data (הנתונים שלי)
34. Rows: "ייצוא ל-Excel" (sheet), "גיבוי" / "שמירת עותק של כל הנתונים" (sheet), "ייבוא נתונים" → `/settings/import`. `AccountData.tsx:84-87` — `e2e/design-v2-shell.spec.ts`, `e2e/design-integration.spec.ts` ("legacy settings reaches Account and its data sheets…").
35. Unsynced row "שינויים שעוד לא עלו לענן" is shown **only when** outbox non-empty, tracker pending/failed, or storage health unknown; value = outbox count; subtitle "מצב האחסון לא ידוע" or "יש שינויים שדורשים טיפול"; → `/settings/unsynced`. `AccountData.tsx:37,88-91` — `e2e/design-v2-shell.spec.ts` ("unknown outbox health keeps Account actionable…"), `e2e/pwa-offline.spec.ts`, `e2e/reliability.spec.ts`.
36. Export sheet "ייצוא נתונים": "היקף הייצוא" row → ChoiceList "כל הרכבים, כולל הארכיון" (default) / "הרכב הפעיל". `AccountData.tsx:19-22,35,94-97,109-112` — `e2e/design-v2-shell.spec.ts`.
37. "ייצוא תדלוקים" (CSV · scope) and "ייצוא עדכוני מיכל ונסיעות" (CSV נפרד · scope); subtitle "טוענים נתונים מכל הרכבים…" while exporting; disabled while exporting or when scope=active and no active vehicle. One file per gesture. `AccountData.tsx:98-103` — `e2e/audit-fixes.spec.ts` (F08), `e2e/design-integration.spec.ts`; tank export uncovered by test id.
38. Account scope export always reads a fresh `loadAccountExport` snapshot (includes archived). No data → info toast "אין עדיין נתונים מהסוג הזה לייצוא"; success → "הקובץ הוכן להורדה" / "כולל רכבים בארכיון. בדקו שהקובץ נשמר בהורדות הדפדפן."; failure → alert "הייצוא לא הושלם. בדקו את החיבור ונסו שוב.". Active scope uses live data, toast "הקובץ הוכן להורדה". Disabled while deletion pending. `AccountData.tsx:40-80` — `e2e/audit-fixes.spec.ts` (F08), `e2e/design-v2-shell.spec.ts` (unmount guard).
39. Note "כל קובץ יורד בנפרד ונפתח ב-Excel. בייצוא של כל החשבון נדרש חיבור לשרת.". `AccountData.tsx:105` — uncovered.
40. Export filenames are timestamped (`exportFilename`). `src/lib/exportFilename.ts` — `src/lib/exportFilename.test.ts`.
41. Backup sheet "גיבוי": `UnifiedTransfer` ("כל הרכבים, הרשומות וההעדפות בקובץ אחד. תמונות אינן כלולות.") + `LegacyCareTransfer` row "גיבוי וייצוא תחזוקה" / "תאימות לגיבויי התחזוקה הקודמים · הרכב הפעיל" (hidden when no active vehicle). `AccountData.tsx:113-118`, `UnifiedTransfer.tsx:104`, `LegacyCareTransfer.tsx:12-15` — `e2e/home-profile-update.spec.ts`, `e2e/scan-maintenance.spec.ts`.
42. "הורדת גיבוי מלא" downloads `tank-maleh-account-v2.json` (timestamped) including all vehicles, records, preferences, notification state, pending ops and drafts; message "הגיבוי הוכן: כל הרכבים, הרשומות, ההעדפות, התראות, שינויים ממתינים וטיוטות. תמונות אינן כלולות.". `UnifiedTransfer.tsx:30-48,106-107` — `e2e/unified-vehicle.spec.ts` ("year details … new account backups preserve expanded collections"), `src/lib/vehicle/backup.test.ts`.
43. "שחזור מגיבוי מלא" / "תצוגה מקדימה לפני הוספה": file input `.json`; >8 MB → "הקובץ גדול מדי."; parse errors shown as alert; label "טוענים…" while reading. `UnifiedTransfer.tsx:50-73,108-118` — `src/lib/vehicle/backup.test.ts` ("rejects missing parents…").
44. Restore preview sheet "מה ישוחזר?": "<n> רשומות חדשות · <n> זהות · <n> התנגשויות שלא יוחלפו."; explanatory note (IDs/links preserved, add-only, history not replaced); checkboxes "שחזור העדפות אישיות" and "שחזור <n> טיוטות במכשיר הזה" (both default unchecked); pending ops note (not re-queued). Button "הוספת הנתונים שנבחרו" / "משחזרים…" disabled when nothing to add and no checkbox. `UnifiedTransfer.tsx:123-135` — `e2e/design-v2-account-restore.spec.ts`, `e2e/unified-vehicle.spec.ts` ("full-account restore adds a vehicle … once"), `e2e/design-v2-shell.spec.ts`, `src/lib/vehicle/backup.test.ts` ("preview separates identical records, missing records and conflicts without overwriting").
45. Restore result: "נוספו <n> רשומות באישור השרת." + drafts "שוחזרו <n> טיוטות; <n> טיוטות קיימות לא הוחלפו." + "העדפות נשלחו לשמירה."; during "השחזור נמשך. ממתינים לאישור השרת."; error default "השחזור נעצר. ניתן לנסות שוב; רשומות שכבר נוספו לא יוכפלו."; triggers summary refresh. `UnifiedTransfer.tsx:75-101,120-122` — `e2e/design-v2-account-restore.spec.ts` (Escape on pending offline preview keeps queued entry), `src/lib/vehicle/backup.test.ts`.
46. Multi-car legacy care backup can restore a chosen source into a new vehicle. `CareTransfer.tsx` — `e2e/audit-fixes.spec.ts` (F04/F05, F04/F08).

### More (עוד)
47. Rows: "שליחת משוב" → `/feedback`; "שיתוף האפליקציה"; "התקנת האפליקציה" / "האפליקציה מותקנת" (+ check); "תנאי שימוש" → `/legal/terms`; "מדיניות פרטיות" → `/legal/privacy`; then sign-out and delete rows. `AccountMore.tsx:99-114` — `e2e/design-v2-shell.spec.ts`.
48. Share: native share → nothing extra; clipboard → toast "הקישור הועתק"; otherwise manual sheet "שיתוף האפליקציה" with share text, readonly LTR URL input "קישור לשיתוף", copy button "העתקת הקישור"; copy failure selects text + "הקישור מסומן. אפשר להעתיק אותו ידנית."; note "הקישור לעמוד הראשי ואינו כולל נתונים מהחשבון שלך.". Share never includes route/vehicle/account data. `AccountMore.tsx:37-71,121-134` — `e2e/design-v2-shell.spec.ts` (`account-share`).
49. Install: `available` → prompt, toast "האפליקציה הותקנה" on accept, "לא ניתן לפתוח את ההתקנה כרגע" on error, value "ממתינים…" while waiting; `manual` → subtitle "בספארי: שיתוף ← הוספה למסך הבית" (iOS) or "בתפריט הדפדפן: התקנת אפליקציה"; `installed` → non-actionable. `AccountMore.tsx:73-95,103-110` — uncovered.
50. Version line "טנק מלא · גרסה <APP_VERSION> · בילד <commit 10 chars>" + " · שינויים מקומיים" when dirty. `AccountMore.tsx:115-118` — uncovered by assertion.
51. "בדיקת עדכון" / "בודקים עדכון…" → status: "גרסה חדשה זמינה — לחצו על רענון בהודעה." / "לא נמצא עדכון חדש." / "חזרו לחיבור לאינטרנט כדי לבדוק עדכון." / "לא ניתן לבדוק עדכון כרגע. אפשר לנסות שוב." + server version/build line. `UpdateCheckButton.tsx:6-27` — `e2e/care-pwa-upgrade.spec.ts`, `src/lib/appUpdates.test.ts`.

### Sign-out and delete
52. Sign-out opens a dialog and re-checks device-wide unacknowledged writes (`checkUnacknowledged`); stale checks (generation counter) ignored. `AccountActions.tsx:33-44` — `e2e/design-v2-shell.spec.ts`.
53. Sign-out dialog title "שינויים שעוד לא עלו לענן" when attention (own outbox, tracker pending/failed, health unknown, other account pending, unknown) else "להתנתק מהחשבון?"; body copy per state (5 variants + "בודקים את השינויים שבמכשיר. התנתקות תשאיר את הנתונים המקומיים." while checking, default "הנתונים שבענן יחזרו בהתחברות הבאה. הנתונים המקומיים נשמרים במכשיר."); confirm "התנתקות בכל זאת" (danger) / "התנתקות". `AccountActions.tsx:98-113` — `e2e/design-v2-shell.spec.ts` ("unknown outbox health…"), `e2e/reliability.spec.ts` ("a pending record survives sign-out A → B → A…").
54. **Local-data checkbox lives on the sign-out dialog**: "למחוק גם את הנתונים המקומיים במכשיר הזה (מחשב משותף)", shown only when device state is "none", health ok and no account attention; default unchecked; auth layer re-checks before clearing. `AccountActions.tsx:31,54,107-110` — `e2e/design-v2-shell.spec.ts` (asserts checkbox absent when health unknown); positive path uncovered.
55. Sign-out refused → info toast with reason; failure → "ההתנתקות לא הושלמה" / "נסו שוב. הנתונים המקומיים נשמרים."; row shows "מתנתקים…". `AccountActions.tsx:46-62,92` — uncovered.
56. Delete is two-step: step 1 "למחוק את החשבון?" / "כל הרכבים, התדלוקים, הטיפולים והנתונים יימחקו לצמיתות. לא ניתן לשחזר. כדאי לשמור גיבוי קודם." / "המשך למחיקה"; step 2 "אישור אחרון" / "זו ההזדמנות האחרונה לבטל. למחוק את כל הנתונים לצמיתות?" / "כן, מחקו הכול". Cancel at either step returns to 0. No checkbox in the delete flow. `AccountActions.tsx:114-119` — `e2e/audit-fixes.spec.ts`, `e2e/design-v2-shell.spec.ts`.
57. Delete outcomes: reauth needed → "נדרשת התחברות מחדש לפני המחיקה" / "לא נמחק דבר. התחברו שוב ונסו שנית."; ok → "החשבון וכל הנתונים נמחקו"; partial → "המחיקה נעצרה לפני השלמתה" / none → "המחיקה לא החלה" with detail for pending-writes / local-cache / generic; exception → "מחיקת החשבון נכשלה". While deleting: row "מוחקים את החשבון…", status "המחיקה מתבצעת. ממתינים לאישור השרת."; delete and sign-out mutually disabled. `AccountActions.tsx:64-96` — `e2e/audit-fixes.spec.ts` (F01/F02 ×2), `src/lib/accountDeletion.test.ts` (6 tests), `e2e/cost-community.spec.ts` ("modern account deletion removes cost summaries…").

## §6 cross-check

| §6 item | Status | Evidence |
|---|---|---|
| identity (provider, since, last login, role) | present | in a sheet behind the identity button, `AccountIdentity.tsx:33-41`; provider is hard-coded "חשבון Google" |
| activity across all vehicles | present | `AccountIdentity.tsx:42-67`, `useAccountSummary.ts` |
| 98/diesel price readings | present | market "מחירון" row, `AccountFuel.tsx:32,53-58` |
| notification toggles (master + per kind) | **partial** | no master switch — "כל ההתראות" is a link to `/notifications` (`AccountPreferences.tsx:69`). Per-kind: reminders + prices inline; issues only inside the preferences sheet; `syncNotifications` exists in settings (`notificationPreferences.ts:8`) but has **no UI toggle anywhere** |
| fuel sharing + separate cost sharing (default off) with info sheets | present (note) | cost sharing default off with consent sheet (`AccountPreferences.tsx:88-92,130-144`); **fuel sharing defaults ON** (`shareBenchmarks !== false`) — §6 "default off" applies only to cost sharing |
| export scope | present | `AccountData.tsx:97,109-112` |
| four exports | present (interpretation) | fillups CSV, tank-updates CSV, full backup JSON, legacy care export (`CareTransfer`). Unsynced JSON export is separate. No single "four exports" list in UI |
| full backup | present | `UnifiedTransfer.tsx:30-48` |
| restore preview | present | "מה ישוחזר?" sheet, `UnifiedTransfer.tsx:123-135` |
| unsynced | present (conditional) | row only rendered when something needs attention, `AccountData.tsx:88` |
| install PWA | present | `AccountMore.tsx:103-110` |
| share link | present | `AccountMore.tsx:101,121-134` |
| sign-out warning | present | `AccountActions.tsx:98-113` |
| two-step delete with local-data checkbox | **differs** | delete is two-step but has **no** checkbox; the local-data checkbox is on the **sign-out** dialog (`AccountActions.tsx:107-110`) |
| version/build | present | `AccountMore.tsx:115-118` + update check |
| business statement entry (Account → הנתונים שלי, §7.2) | missing-in-production (new feature) | not in `AccountData.tsx` |
| scanV2 A/B switch under "כפתור תדלקתי פותח מצלמה" (PROMPT Stage 6) | missing-in-production (new) | only the `quickEntry` toggle exists |

## v3 changes to this screen

May change:
- Visual tone (§1): Karantina 400, hairline borders, radius scale, card shadows, accent `#F3C54B`.
- Identity sheet and activity metrics rendered as the facts strip (§3) instead of the `account-metrics` grid; money via `fmt.money` whole shekels, avg fuel price stays 2dp (§5).
- Add "דוח חודשי לעסק" entry under הנתונים שלי (§7.2) and the `excluded_from_tco` CSV column in fill-up/expense exports (§7.1).
- Stage 6: A/B switch for `scanV2` next to the quick-entry toggle.
- Dead `Profile.tsx` / `Settings.tsx` may be removed (no route).

Must not change:
- Every copy string, state branch and guard above (scope guards, fresh snapshot per export, one file per gesture, deletion-pending lock).
- Cost sharing remains separate, default off, consent-before-enable; fuel sharing keeps its current default; withdrawal status lines never claim server removal before confirmation.
- Restore stays add-only with preview and opt-in prefs/drafts; pending ops never re-queued.
- Sign-out device-wide checks and the conditional local-data checkbox; delete stays two-step with reauth-before-delete semantics.
- If v3 decides to add a master notification switch or a checkbox to delete (to match §6 literally), that is a new behaviour needing its own tests — not a parity item.
