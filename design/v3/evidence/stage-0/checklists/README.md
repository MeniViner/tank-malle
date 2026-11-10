# Stage 0 — per-screen behaviour checklists

Baseline: `feat/design-v3` at `05548ba`. Each file enumerates the current production behaviours of one area (source `path:line` + covering tests or "uncovered"), cross-checks DESIGN-V3 §6, and ends with "v3 changes to this screen". These are the acceptance checklists for Stages 1–7: an item may change look, never behaviour, unless the v3 section says so.

## Index

| File | Area | Behaviours |
|---|---|---|
| [home.md](home.md) | Home | 54 |
| [fillup.md](fillup.md) | Fill-up form, receipt import, draft, post-save price confirmation, undo | 63 |
| [tank-sheets.md](tank-sheets.md) | Tank sheet, planned trips, preferences, measurement sheet, capacity confirm | 35 |
| [station-sheet.md](station-sheet.md) | Station sheet | 25 |
| [journal.md](journal.md) | Journal (History, entry sheet, rows) | 42 |
| [insights.md](insights.md) | Insights, all tabs | 47 |
| [vehicle.md](vehicle.md) | Vehicle: cost, year screen, reminders, issues, docs, declared consumption, care backup | 61 |
| [care-forms.md](care-forms.md) | Service / expense / reminder / issue editors | 35 |
| [account.md](account.md) | Account | 57 |
| [notifications.md](notifications.md) | Notifications + preferences | 27 |
| [unsynced.md](unsynced.md) | Unsynced / outbox | 23 |
| [import.md](import.md) | Import | 41 |
| [wizard.md](wizard.md) | Vehicle wizard, plate lookup, EV | 38 |
| [onboarding-signin.md](onboarding-signin.md) | Onboarding, sign-in, splash | 21 |
| [shell.md](shell.md) | Tab bar, FAB, header, car switcher, update banner, atmosphere | 42 |
| **Total** | | **611** |

## §6 items that are missing or differ from production

§6 says "everything below already exists in production". These items do not, or not as described. Implementers must not treat them as parity; each is either new work (needs a decision and tests) or a wording correction to §6.

### Missing in production
1. **Fill-up reasons picker** (כרגיל/כמעט נגמר/לפני נסיעה/מחיר טוב/לא בטוח) — picker lives in `src/components/TankStateSection.tsx`, which nothing imports; reasons are only preserved on edit and shown read-only in `EntrySheet.tsx`. Unused labels also differ ("הדלק נמוך", "לפני נסיעה ארוכה", "מחיר משתלם / עצירה נוחה"). → fillup.md
2. **Planned trip "date" option** — trip sheet offers today/tomorrow/3 days/week only. → tank-sheets.md
3. **Measurement sheet: "full" count and "restarts"** — no full-fill count row; restarts appear only on Insights (`ConsumptionInsights.tsx`). → tank-sheets.md
4. **Journal row state "לא בעלות הרכב"** and **Insights "excluded expenses"** — no `excluded` field anywhere; this is the §7.1 new feature. → journal.md, insights.md
5. **Business statement** on Vehicle — no `biz`, no "דוח חודשי"; it is §7.2. → vehicle.md
6. **EV plate lookup (battery kWh / WLTP / motor kW)** and EV refresh — electric registry label maps to `fuelType: "other"` (`src/lib/plateLookup.ts:127`); `FuelType` is `"95"|"98"|"diesel"|"other"`; no `powertrain`/`battery`/`motorKw`; extras step asks "נפח מיכל" for EVs. It is §7.4. → wizard.md, vehicle.md
7. **EV charge mode** ("טענתי", kWh) — FAB and form are fuel-only. → fillup.md, shell.md
8. **Unsynced "offline demo"** — offline is the browser's real state; no in-app toggle (smoke cycle needs Playwright `context.setOffline`). → unsynced.md

### Partially present / differs
9. **Capacity check → confirm sheet** — copy "נראה שנפח המיכל גדול מההערכה" exists, but from the fill-up form "בדיקת נפח המיכל" navigates to `/vehicle?tab=details`; `TankCapacityConfirm` opens only from the tank sheet. → fillup.md
10. **Post-save pump-price scope** — both scopes exist but are chosen automatically (`fillupPricing.ts:166-171`), not by the user. → fillup.md
11. **Reserve 10–25%** — UI accepts 0–100%, rules 5–90%; 10–25 enforced nowhere. → tank-sheets.md
12. **Journal pagination** — 50 rows per page + "הצגת רשומות נוספות" (`History.tsx:46,230`), not 25. → journal.md
13. **Journal issues filter** — no "תקלות" chip; only legacy `?kind=issue` URL. → journal.md
14. **"על אילו נתונים מבוסס"** — info sheet button appears only when data is incomplete/failed, not as an always-visible ⓘ. → journal.md
15. **Insights price extremes** — station ranking spread + single most expensive fill total; no cheapest/dearest per-litre. → insights.md
16. **Reminder snooze** — no snooze on Vehicle screen (detail links to `/notifications`); Notifications snooze is a free date picker, no tomorrow/week/month presets, and only on reminder/document rows. → vehicle.md, notifications.md
17. **Care backup/export/import** — exists, but in Account → הנתונים שלי, not on Vehicle. → vehicle.md, account.md
18. **Service-form odometer validation** — "lower" check only against an earlier day's reading; the "lower than latest" error and the jump confirm (> **3,000** km, not 1,500) live only in the current-reading odometer sheet. Fill-up form warns at > 2.5× usual segment. → care-forms.md, fillup.md
19. **"לקבוע גם את הטיפול הבא"** — it is the sub-label of the "תזכורת חוזרת" toggle in the reminder editor, not in the service/expense form. → care-forms.md
20. **Notification toggles "master + per kind"** — no master switch ("כל ההתראות" is a link); reminders/prices toggles on Account, issues toggle only in the preferences sheet, sync setting has no toggle. → account.md, notifications.md
21. **Two-step delete with local-data checkbox** — delete is two-step, but the local-data checkbox is on the sign-out dialog, not delete. → account.md
22. **Unsynced device → sent → confirmed** — shown only as an explanatory list; rows are pending/failed/conflict; confirmed rows just leave. → unsynced.md
23. **Fuel sharing default** — fuel sharing defaults ON (cost sharing defaults off, as §6 says). → account.md
24. **Wizard make/model/year catalogue** — present, but no e2e asserts a catalogue pick. → wizard.md

### §2/§1 "new" items that already exist
- Spotlight "reminder due by date" and "rejected write" already exist in production (home.md). Only "כדאי לתדלק לפני הנסיעה" as a spotlight card is new.
- Atmosphere dial already at `top: -170px` (only opacity changes); tab bar already translucent (shell.md).

## Cross-cutting notes for implementers
- Money currently renders symbol-first (`₪1,567`) and many e2e assertions match that; §5 moves the symbol after the number. Update the string format in those assertions only, never the values, and log each change in the stage `QA.md`.
- Home: per-km uses a local `₪${num(…,2)}` (violates AGENTS.md), copy says "לכל ק״מ" (v3: "לק״מ"), TCO legend shows first 4 parts in engine order, fuel cell has no previous-month fallback, "לאחרונה" shows 3 rows. See home.md.
- Dead code (no route/import): `src/screens/Profile.tsx`, `src/screens/Settings.tsx`, `src/components/Landing.tsx`, `src/components/Previews.tsx`, `src/components/TankStateSection.tsx`.
