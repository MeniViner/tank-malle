# Unsynced / sync (שינויים שעוד לא עלו לענן) — Stage 0 behaviour checklist

Baseline: `05548ba`. Route `/settings/unsynced` (`src/App.tsx:157`). Entry points: Account → "שינויים שעוד לא עלו לענן" (conditional, see `account.md` #35), sync notifications (`notifications.md` #4), journal unsynced banner.

## Sources

- `src/screens/Unsynced.tsx` (screen + exported `OperationCard`)
- `src/lib/outboxPresentation.ts`, `src/lib/outbox.ts` (`outboxStatusText`, `exportOperations`), `src/lib/writes.ts` (`MUTATION_LABELS`, `describeError`)
- `src/components/maintenance/CareConflictDetails.tsx`
- `src/context/DataContext.tsx` (`offline` from `navigator.onLine`, `retryOperation`, `resolveConflict`, `discardOperation`)

## Behaviours

1. Screen is keyed by uid; all actions guarded by account-action + mount scope (late results after account switch are dropped). `src/screens/Unsynced.tsx:32-35,74-89` — `e2e/reliability.spec.ts` ("a pending record survives sign-out A → B → A and never shows up for B").
2. Header title "סנכרון", back = history back; trailing "ייצוא" only when the outbox is non-empty. `Unsynced.tsx:109-123` — `e2e/reliability.spec.ts`.
3. Heading: "בודקים את השינויים" (outbox not ready) / "לא הצלחנו לבדוק את הסנכרון" (health not ok) / "שינויים שעוד לא עלו לענן" (items) / "הכל מעודכן" (none). `Unsynced.tsx:126` — `e2e/pwa-offline.spec.ts`, `e2e/design-v2-shell.spec.ts`.
4. Offline with items → info notice "אין חיבור. פעולות ממתינות יישלחו כשהחיבור יחזור; לפעולות שנכשלו אפשר לנסות שוב." Offline is the real browser state (`navigator.onLine` + events), there is no in-app toggle. `Unsynced.tsx:127-129`, `src/context/DataContext.tsx:785,1038` — uncovered (copy); offline flows in `e2e/pwa-offline.spec.ts` use `context.setOffline`.
5. Storage health not ok → role=alert with `data-outbox-health`: "אחסון הפעולות המקומי אינו זמין" or "חלק מהרשומות המקומיות לא ניתנות לקריאה" + message + "הרשימה למטה עשויה להיות חלקית; אין לראות בה אישור שהכול סונכרן.". `Unsynced.tsx:131-146` — `e2e/design-v2-shell.spec.ts` ("unknown outbox health keeps Account actionable…").
6. Loading → "טוענים את השינויים השמורים במכשיר…"; empty+healthy → "אין במכשיר הזה שינויים שממתינים לאישור."; empty+unhealthy → "לא נמצאו פעולות ברשימה — אבל מצב האחסון לא מאפשר לומר שהכול סונכרן.". `Unsynced.tsx:148-155` — partially `e2e/design-v2-shell.spec.ts`.
7. Order: conflicts first, then failed, then pending; newest updated first within a rank. `Unsynced.tsx:59-67` — uncovered.
8. Card heading: mutation label (`MUTATION_LABELS`) + vehicle "make model"; status pill (`data-state`): "ממתין לאישור השרת" / "לא אושר · הנתונים נשמרו לתיקון" / "התנגשות עם גרסה חדשה יותר". `Unsynced.tsx:266-275`, `src/lib/outbox.ts:1042-1051` — `e2e/reliability.spec.ts`, `e2e/outbox-invariants.spec.ts`.
9. Fill-up payload (add/restore/update/import) or delete before-image shows date · time, "<odo> ק״מ · <litres 1dp> ל׳ · <total whole ₪>", station, notes; unreadable date → "תאריך לא קריא". `Unsynced.tsx:253-337` — `src/screens/Unsynced.test.ts` ("flags a real total difference hidden by whole-shekel display").
10. Care record summary: title (fallback "עדכון תחזוקת רכב"), day, amount (`vehicleMoney`) or "עלות לא צוינה" when the field exists but is null; note "הנתונים המלאים כלולים בייצוא השינויים שעוד לא עלו לענן.". `Unsynced.tsx:281-288` — `src/screens/Unsynced.test.ts` ("renders decoded care summary and both conflict sides…"), `src/lib/outboxPresentation.test.ts`.
11. Observation summary: "עדכון קילומטראז׳" / "עדכון מצב המיכל", observed time, odometer or "לא צוין", level percent or "לא צוין" (absence vs null distinguished). `Unsynced.tsx:289-296` — `src/screens/Unsynced.test.ts` ("shows observation timestamps with distinct microseconds…").
12. Price-rule summary: station name or "כלל תמחור אישי", label, fuel type label, "הנחה אישית לליטר:" / "תוספת אישית לליטר:" and "מחיר אישי לליטר:" at 2dp. `Unsynced.tsx:297-305` — `src/screens/Unsynced.test.ts` ("shows private rule scope and per-litre precision…"), `src/lib/outboxPresentation.test.ts`.
13. Vehicle document and vehicle selection summaries (type, insurer, "בתוקף עד", "עלות שנתית:"; active vehicle id). `Unsynced.tsx:306-316` — `src/lib/outboxPresentation.test.ts` ("does not turn an invalid negative annual cost into a positive displayed amount").
14. Malformed payload/base/server image → alert "לא ניתן לקרוא את תמונת הרשומה. העותק המקורי נשמר לייצוא; החלפת גרסת השרת אינה זמינה." and overwrite disabled. `Unsynced.tsx:277-279,366` — `src/screens/Unsynced.test.ts` (it.each malformed), `src/lib/outboxPresentation.test.ts`.
15. Conflicts show mine vs server (`CareConflictDetails`) and actions "להשאיר את גרסת השרת" / "לדרוס עם הגרסה שלי" (`outbox-overwrite`). `Unsynced.tsx:317-318,361-369` — `e2e/outbox-invariants.spec.ts` ("a stale edit is refused by the server, kept as a conflict…"), `e2e/scan-maintenance.spec.ts`, `e2e/mobile-fuel-release.spec.ts`, `src/screens/Unsynced.test.ts`.
16. Error line: for `unconfirmed`/`conflict`/`unverified` the stored message, else `describeError(code)`. `Unsynced.tsx:339-350` — `e2e/reliability.spec.ts` ("a fill-up the server rejects is kept with its input…").
17. Disclosure "פרטי הפעולה": "ניסיונות: <n> · עודכן <date time> · גרסה <n>" and raw LTR error code/message. `Unsynced.tsx:352-358` — uncovered.
18. Pending ops: no retry button — text "ממתין — יישלח אוטומטית כשהשרת זמין" (SDK owns the write). Failed ops: "ניסיון חוזר" (loading while busy; per-op in-flight guard). `Unsynced.tsx:370-381,55-56,78` — `e2e/reliability.spec.ts`, `e2e/pwa-offline.spec.ts` ("two fill-ups saved across offline restarts are kept through a server rejection and sync once on retry"), `e2e/outbox-invariants.spec.ts` ("a retry that cannot verify against the server writes nothing").
19. "עריכה" for fill-up add/restore/update and import batch: opens the **rejected input** (`/fillup/new?op=…` or `/fillup/<docId>?op=…`) and re-sends under the same op. `Unsynced.tsx:164-179,382-390` — `e2e/reliability.spec.ts` ("a rejected record can be edited and re-sent under the same document id"), `e2e/outbox-invariants.spec.ts` ("correcting a rejected edit opens the rejected input…").
20. Discard: pending → button "הסרה מהמעקב", dialog "להסיר את הרשומה מהמעקב?" ("…הסרה מהרשימה לא מבטלת אותה — הכתיבה עצמה עדיין עשויה להגיע לשרת…"), confirm "הסרה מהמעקב"; failed/conflict → button "מחיקה", dialog "למחוק את הרשומה שלא סונכרנה?" / "זהו העותק היחיד של מה שהקלדתם. אם תרצו לשמור אותו — ייצאו קודם.", confirm "מחיקה לצמיתות". `Unsynced.tsx:204-225,391-397` — uncovered.
21. Export: downloads timestamped `tank-malle-unsynced.json` (`exportOperations`, no credentials) and toast "הקובץ מכיל נתונים פרטיים — שמרו אותו במקום בטוח"; export bytes unaffected by display decoding. `Unsynced.tsx:91-105` — `src/lib/outboxPresentation.test.ts` ("decodes care payload/base/server without changing retry or export bytes"), `src/lib/exportFilename.test.ts`.
22. Disclosure "איך נשמרים השינויים?" with ordered steps "נשמר במכשיר" → "נשלח לשרת" → "אושר וסונכרן" ("רק אחרי האישור הפעולה יוצאת מהרשימה.") and persistence note (survives refresh/close/sign-out; cleared with site data; use export). `Unsynced.tsx:191-201` — uncovered.
23. Confirmed operations leave the list (there is no visible "confirmed" row state on this screen). `Unsynced.tsx:197` (copy), outbox semantics — `e2e/pwa-offline.spec.ts` ("a fill-up saved after an offline restart reaches the server exactly once…"), `e2e/reliability.spec.ts` ("three fill-ups saved offline survive a reload and reach the server exactly once"), `e2e/outbox-invariants.spec.ts`.

## §6 cross-check

| §6 item | Status | Evidence |
|---|---|---|
| device → sent → confirmed | **partial** | exists only as an explanatory 3-step list in a disclosure (`Unsynced.tsx:194-198`). Per-row states are pending / failed / conflict; confirmed rows disappear, so no row is ever shown as "confirmed" here (journal rows carry pending state separately) |
| error | present | `Unsynced.tsx:339-350` |
| retry | present | failed/unconfirmed only; pending has no retry by design (`Unsynced.tsx:370-381`) |
| drop | present | "הסרה מהמעקב" / "מחיקה" with confirm (`Unsynced.tsx:204-225`) |
| export | present | `Unsynced.tsx:91-105` |
| offline demo | **missing-in-production** | no in-app offline toggle/demo; offline state is `navigator.onLine` only (`DataContext.tsx:785`). The PROMPT smoke step "unsynced (offline toggle)" and "enable the offline mode" must use browser/devtools offline (Playwright `context.setOffline`) unless v3 adds a toggle |

## v3 changes to this screen

May change:
- v3 tone (§1) for cards, status pills and disclosures; money stays whole shekels, per-litre rule values 2dp (§5).
- A visual device → sent → confirmed stepper may be promoted out of the disclosure, but it must be derived from real op state (no fake "confirmed" row that the outbox doesn't have).
- If an offline demo toggle is added it is a new feature (needs tests; must not interfere with real `navigator.onLine` handling).

Must not change:
- Op ordering, status texts, pending-has-no-retry rule, edit-opens-rejected-input, conflict choices and overwrite gating on unverified images.
- Discard confirm copy and the distinction between "remove from tracking" (pending) and permanent delete.
- Export contents/bytes and the privacy toast; health-unknown messaging never implies "all synced".
