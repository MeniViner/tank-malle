# Notifications (התראות) — Stage 0 behaviour checklist

Baseline: `05548ba`. Route `/notifications` (`src/App.tsx:142`). Preferences sheet is opened from Account → "העדפות התראות".

## Sources

- `src/screens/Notifications.tsx`
- `src/hooks/useVehicleNotifications.ts`
- `src/components/NotificationPreferences.tsx`
- `src/lib/vehicle/notificationPreferences.ts`, `src/lib/vehicle/notificationUndo.ts`, `src/lib/vehicle/documentNotifications.ts`, `src/lib/vehicle/notificationBaseline.ts`

## Behaviours

### Sources of notifications (`useVehicleNotifications`)
1. Document notifications (test/insurance/licence due) are produced from the active vehicle when reminder notifications are on. `src/hooks/useVehicleNotifications.ts:15` — `src/lib/vehicle/documentNotifications.test.ts`, `e2e/design-v2-vehicle.spec.ts` ("document Home links, notification occurrence identity and reminder preferences follow the saved civil due date").
2. Reminder notifications for active plans in `due` ("הגיע מועד הטיפול", urgent) or `soon` ("הטיפול מתקרב"), linking `/vehicle/reminders/<id>`. `useVehicleNotifications.ts:16` — `e2e/open-design.spec.ts` ("the same advance window drives Home, the vehicle badge and the notification list").
3. Issue notifications for unresolved issues marked important: detail "תקלה שסימנתם כחשובה", urgent, link `/vehicle/issues/<id>`; occurrence includes status and day (status change = new occurrence). `useVehicleNotifications.ts:17` — uncovered.
4. Sync notifications: every non-pending outbox op of this vehicle → "פעולה דורשת בדיקה" / "המידע נשמר בתור הפעולות. ארכיון אינו מבטל כתיבה."; storage health not ok → "לא ניתן לאמת את תור הפעולות" / "יש לבדוק את אחסון המכשיר."; both link `/settings/unsynced`. `useVehicleNotifications.ts:18-21` — uncovered.
5. Price notification for the vehicle's fuel when a regulated/manual price exists: title "מחיר <בנזין 95|בנזין 98|סולר|דלק> · <month label>", detail "<price 2dp> לליטר · <מחיר שהוזן ידנית|המחיר הרשמי שנשמר>"; occurrence keyed by fuel+month+price. `useVehicleNotifications.ts:22-27` — uncovered.
6. Each kind honours its preference (reminders, issues, sync, prices; default on). Deleted (tombstoned) occurrences are hidden; a new occurrence (new cycle) shows again. `useVehicleNotifications.ts:15-29`, `notificationPreferences.ts:4-12` — `src/lib/vehicle/notificationPreferences.test.ts`, `e2e/open-design.spec.ts` ("…deletion survives reload and leaves a new cycle visible").
7. Unread badge count = not archived, not snoozed, not read. `useVehicleNotifications.ts:30` — `e2e/open-design.spec.ts`.

### Screen
8. Header: back button aria "חזרה לבית" → `/`; eyebrow "עדכונים ותזכורות לרכב"; title "התראות". `src/screens/Notifications.tsx:169-170` — `e2e/open-design.spec.ts`.
9. Groups in order: "חדש" (unread), "נקרא" (read), "להמשך" (snoozed), then "בארכיון" (archived, sub "נשמר עד שתמחקו"); each group shows a count; empty groups not rendered. `Notifications.tsx:35-37,130-134,174-177` — `e2e/open-design.spec.ts` ("notifications keep unread, read and archive in one list…").
10. "סימון כנקרא (<n>)" shown when there are unread; disabled while busy or any unread baseline unavailable; success toast "כל ההתראות סומנו כנקראו"; partial → alert "חלק מהסימונים טרם אושרו. בדקו שינויים שעוד לא עלו לענן." + toast "חלק מסימוני הקריאה ממתינים לבדיקה". `Notifications.tsx:104-128,172-173` — `e2e/open-design.spec.ts`.
11. Empty (no live notes): "אין התראות" / "נודיע כשתזכורת תגיע, כשמחיר הדלק יתעדכן או כשמשהו ימתין לסנכרון."; while vehicle data incomplete: "מעדכנים את ההתראות" / "הנתונים חלקיים או ממתינים לשרת.". `Notifications.tsx:175-176` — uncovered.
12. Row: icon by kind (price → pump, sync → cloud-off, urgent → warning, else bell); unread dot; title + detail as numeric-safe text; `data-urgent`, `data-notification-ready`. `Notifications.tsx:136-146` — `e2e/open-design.spec.ts`.
13. Tapping a row link navigates to its target and marks it read (without undo) when ready and not pending. `Notifications.tsx:142-145` — `e2e/open-design.spec.ts`.
14. Not-ready rows: "מצב ההתראה אינו זמין כרגע" (state collection errored) or "ממתינים למצב ההתראה"; actions disabled. `Notifications.tsx:137,147` — uncovered.
15. Snoozed row note: "תופיע שוב ב־<day>. מועד התזכורת לא השתנה.". `Notifications.tsx:148` — `e2e/unified-vehicle.spec.ts` ("snooze and archive persist per occurrence…").
16. Reminder CTA "רישום טיפול" opens the service editor completing that plan. `Notifications.tsx:150-152` — `e2e/open-design.spec.ts` ("completing a reminder offers the last linked invoice and current mileage…"), `e2e/design-v2-vehicle.spec.ts`.
17. "דחיית הופעה" (reminder and document rows only) opens sheet "מתי להציג שוב?" with a civil date field "יום הופעה מחדש" (required); helper "דחיית ההופעה אינה משנה את המועד שנשמר ברכב."; submit "דחיית הופעת ההתראה"; a non-future day → "בחרו יום עתידי."; sheet cannot close while busy. **No preset buttons** (tomorrow/week/month). `Notifications.tsx:153-155,181-191` — `e2e/unified-vehicle.spec.ts`, `e2e/open-design.spec.ts` ("a remote active-vehicle switch closes an old snooze sheet…").
18. Price row: tapping or "מה זה משנה" opens sheet "מה שינוי המחיר אומר?" ("המחיר השמור משמש כברירת מחדל לתדלוקים חדשים ולקו ההשוואה בגרף. הוא אינו משנה את המחירים ששילמתם או את ההיסטוריה שכבר שמרתם.") with link "למחיר ולהנחה האישית" → `/settings` (redirects to `/account`); opening marks it read. `Notifications.tsx:139,143,156,192-195` — uncovered.
19. Mini button: live → archive (aria "העברה לארכיון · <title>", also marks read); archived → delete (aria "מחיקת התראה · <title>", tombstone). Archived rows also show "החזרה לפעילות". Archived helper: "מחיקה מסירה את ההתראה הזו בלבד. היא אינה מוחקת טיפול, משנה תזכורת או מבטלת פעולת סנכרון.". `Notifications.tsx:157-162,179` — `e2e/open-design.spec.ts`, `e2e/unified-vehicle.spec.ts`; "החזרה לפעילות" uncovered.
20. Every state change writes a versioned `notificationStates` record via the outbox; buttons disabled while an op for that path is pending or another action is in flight (ref guard against double-click). `Notifications.tsx:41-67,136` — `src/lib/vehicle/notificationPreferences.test.ts` ("preserves old state documents and stores deletion only as an occurrence tombstone").
21. After server confirmation a 5 s undo toast: "ההתראה נמחקה" / "ההתראה הועברה לארכיון" / "הופעת ההתראה נדחתה" / "ההתראה עודכנה"; undo → "הפעולה בוטלה" or "הביטול לא אושר — בדקו את תור הפעולות"; stale undo → "לא ניתן לבטל; ייתכן שההתראה השתנתה בינתיים.". Undo survives navigation within the same vehicle, not a vehicle switch. `Notifications.tsx:77-97` — `src/lib/vehicle/notificationUndo.test.ts` (5 tests), `e2e/unified-vehicle.spec.ts` ("notification deletion Undo survives route navigation…"), `e2e/open-design.spec.ts` ("notification Undo survives navigation in the same vehicle but cannot act after a vehicle switch").
22. Unconfirmed write → alert "העדכון טרם אושר. בדקו שינויים שעוד לא עלו לענן." + toast "העדכון לא סונכרן — הקלט נשמר בתור הפעולות". `Notifications.tsx:72-76` — uncovered.
23. All actions are scoped to the active vehicle (`tankInputScope` / `captureVehicleAction`); a vehicle switch drops sheets, errors and late completions. `Notifications.tsx:24,32-34,60` — `e2e/open-design.spec.ts` ("a remote active-vehicle switch…").

### Preferences sheet (`NotificationPreferences`)
24. Sheet "העדפות התראות": toggles "תזכורות טיפול", "עדכון מחיר דלק", "תקלות שסימנתי כחשובות" (no sync toggle). `src/components/NotificationPreferences.tsx:19-24` — `e2e/ui-review.spec.ts` ("every setting uses the same compact accessible switch…"), `e2e/design-v2-shell.spec.ts`.
25. "כמה זמן מראש?" segmented יום / 3 ימים / שבוע / שבועיים (default 7) and "כמה קילומטרים מראש?" 500 / 1,000 / 2,000 ק״מ (default 1000); unsupported stored values fall back to defaults. `NotificationPreferences.tsx:25-26`, `notificationPreferences.ts:2-11` — `src/lib/vehicle/notificationPreferences.test.ts`, `e2e/design-v2-foundation.spec.ts` ("fuel and shared segmented reminder labels isolate numbers…").
26. Helpers: "ההעדפה משנה מתי תזכורת נחשבת מתקרבת. היא אינה משנה את מועד הטיפול, את המחזור או את רשומות היומן." and "ההתראות מוצגות כשהאפליקציה פתוחה. אין שליחת Push אוטומטית כשהיא סגורה.". `NotificationPreferences.tsx:27-28` — lead-window semantics in `src/lib/vehicle/notificationPreferences.test.ts`.
27. Save failure → alert "לא ניתן לשמור את ההעדפות. נסו שוב כשהאחסון והחיבור זמינים." (only for the current open generation and account). `NotificationPreferences.tsx:15-18,29` — uncovered.

## §6 cross-check

| §6 item | Status | Evidence |
|---|---|---|
| new / read / snoozed / archive | present | groups חדש / נקרא / להמשך / בארכיון, `Notifications.tsx:174-177` |
| snooze tomorrow / week / month | **partial** | snooze exists only as a free civil-date picker ("מתי להציג שוב?"); there are **no tomorrow/week/month presets** (`Notifications.tsx:181-191`). Snooze offered only for reminder and document rows, not issue/sync/price |
| price explanation | present | sheet "מה שינוי המחיר אומר?", `Notifications.tsx:192-195` |
| CTA | present | row link to target, "רישום טיפול" for reminders, "מה זה משנה" for price |
| (Account) notification toggles master + per kind | partial | see `account.md`; no master switch, no sync toggle |

## v3 changes to this screen

May change:
- v3 tone (§1): hairlines, radius scale, Karantina 400 title, translucent surfaces.
- Spotlight on Home gains "reminder due by date" (§2.3) — must read the same occurrences/preferences as this list.
- If the design wants tomorrow/week/month chips, they can be added as shortcuts that fill the same civil-date value; the custom date must remain and the "future day" validation must stay.

Must not change:
- Occurrence identity (tombstone per occurrence, new cycle reappears), per-kind preferences and lead windows.
- Snooze never changes the stored due date; archive never cancels a write; delete removes only the notification.
- Outbox-backed writes, pending/ready gating, 5-second undo semantics and vehicle-switch scoping.
- No push copy ("אין שליחת Push אוטומטית…") stays truthful.
