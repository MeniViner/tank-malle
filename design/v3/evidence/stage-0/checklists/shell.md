# App shell — tab bar, FAB, header, car switcher, update banner, atmosphere, toasts, sheets — Stage 0 behaviour checklist

## Sources

- `src/App.tsx` (routing, gating, tab-bar visibility, atmosphere route)
- `src/components/TabBar.tsx`, `src/shell-design.css`
- `src/components/AppHeader.tsx` (`AppHeader`, `ScreenHeader`), `src/components/Avatar.tsx`, `src/components/CarSwitchSheet.tsx`
- `src/components/UpdatePrompt.tsx`, `src/components/UpdateCheckButton.tsx`, `src/lib/appUpdates.ts`, `src/hooks/useAppUpdateBlocker.ts`
- `src/components/Atmosphere.tsx`, `src/design.css:60-73`, `src/index.css` (`--dial-opacity`, accent)
- `src/components/Toaster.tsx`, `src/context/ToastContext.tsx`
- `src/components/Sheet.tsx` (`Modal`, `Sheet`, `ConfirmDialog`), `src/components/modalLayers.ts`, `src/components/RouteScroll.tsx`
- Tests: `e2e/design-v2-shell.spec.ts`, `e2e/design-v2-foundation.spec.ts`, `e2e/care-pwa-upgrade.spec.ts`, `e2e/audit-fixes.spec.ts`, `e2e/design-v2-home.spec.ts`, `e2e/open-design.spec.ts`, `e2e/ui-review.spec.ts`, `src/lib/appUpdates.test.ts`

## Behaviours

### Routing and gating
1. Routes: `/`, `/vehicle`, `/vehicle/edit/:vehicleId`, `/vehicle/years/:year`, `/vehicle/reminders/:planId`, `/vehicle/issues/:issueId`, `/notifications`, `/history`, `/stats` (lazy, skeleton fallback), `/account`, `/settings` & `/settings/profile` → `/account`, `/settings/vehicles`, `/settings/import`, `/settings/unsynced`, `/legal/:doc`, `/feedback`, `/admin` (lazy), `/vehicles/new`, `/fillup/new`, `/fillup/:fillupId`; unknown → `/` — `src/App.tsx:134-179`. Tests: `e2e/design-v2-shell.spec.ts:212` (legacy routes).
2. Zero vehicles → first-run wizard except on `/vehicles/new`, `/admin`, `/legal`, `/account`, `/settings`, `/feedback`, `/notifications` — `src/App.tsx:43-45,129`. Test: `e2e/design-v2-shell.spec.ts:212`.
3. Account deletion pending → every route redirects to `/account` — `src/App.tsx:124`. Test: `e2e/audit-fixes.spec.ts:55`.
4. Tab bar only on `/`, `/history`, `/stats`, `/vehicle` (trailing slash tolerated); pushed screens use `ScreenHeader` with a back/close control — `src/App.tsx:132,181`. Test: `e2e/design-v2-shell.spec.ts:75`.
5. `UpdatePrompt`, `VehicleRecordEditor`, `Toaster` are mounted unconditionally (service worker registered before sign-in) — `src/App.tsx:60-71`. Test: `e2e/care-pwa-upgrade.spec.ts:27`.
6. `VITE_LOCAL_CARE=1` shows banner "תצוגה מקומית · נתוני הדגמה" — `src/App.tsx:62`. Uncovered.
7. Pushed screens start at their heading; Back restores the previous scroll (`history.scrollRestoration = "manual"`) — `src/components/RouteScroll.tsx:18-30`. Test: `e2e/audit-fixes.spec.ts:273` (F15/F16).

### Tab bar and FAB
8. `<nav aria-label="ניווט ראשי">` with 5 slots: בית, יומן, [FAB], תובנות, רכב (4 links + 1 button); `end` match for `/`; active link `aria-current="page"` — `TabBar.tsx:8-13,24-31`. Test: `e2e/design-v2-shell.spec.ts:75` (4 links, 5 children, texts, aria-current).
9. Active tab: 50×30 icon pill filled with accent + 1.5px inset ink ring; inactive `--ink-2` — `shell-design.css:33-47`. Test: `e2e/design-v2-shell.spec.ts:75` (pill 50×30).
10. Tab bar surface: fixed, max 430px, translucent `color-mix(--bg 88%)` + 14px blur, **1.5px ink top border**, safe-area padding — `shell-design.css:1-18`. Visual only (`e2e/design-v2-foundation.spec.ts` screenshots).
11. "רכב" tab badge = active reminders due/soon (if reminder notifications on) + important unresolved issues (if issue notifications on); aria-label "רכב, N התראות"; badge `data-testid="vehicle-alert-count"` — `TabBar.tsx:18-21,34-42`. Tests: `e2e/open-design.spec.ts`, `e2e/ui-review.spec.ts`.
12. FAB: square 72×72, radius 22px, 2px ink border, accent fill, 5px ink drop shadow (pressed: translateY 4px), label and aria "תדלקתי", in viewport; disabled (opacity .45) without an active vehicle; → `/fillup/new` — `TabBar.tsx:26-29`, `shell-design.css:49-70`. Test: `e2e/design-v2-shell.spec.ts:75` (name, text, radius, 72×72, inViewport).
13. FAB opens the manual form by default; Account switch "כפתור תדלקתי פותח מצלמה" (`settings.quickEntry`) makes it open the scan wizard, keeping the manual draft — `src/screens/FillupForm.tsx:307`, `src/components/account/AccountPreferences.tsx:60`. Test: `e2e/design-v2-shell.spec.ts:179`.
14. FAB label is always "תדלקתי"; there is no "טענתי" (EV) variant — `TabBar.tsx:27-28`. Uncovered.
15. Reduced motion disables tab/FAB transitions and press transforms — `shell-design.css:131-132`. Uncovered.

### Home header
16. `AppHeader` (Home only) has exactly 3 buttons: car switcher, bell, account; no sync/cloud button — `AppHeader.tsx:22-43`. Test: `e2e/design-v2-shell.spec.ts:75` (3 buttons, none named סנכרון/ענן).
17. Car switcher: mini plate (or car icon) + short name (or "בחירת רכב"), chevron; aria-label "החלפת רכב, <name>, לוחית <plate>", aria-description "הרכב הפעיל"/"אין כרגע רכב פעיל", `aria-haspopup=dialog`, `aria-expanded` — `AppHeader.tsx:20-30`. Test: `e2e/design-v2-shell.spec.ts:132`.
18. Bell (aria "התראות", description "N התראות חדשות"/"אין התראות חדשות"), unread dot → `/notifications` — `AppHeader.tsx:32-36`. Tests: `e2e/design-v2-home.spec.ts`.
19. Account button (aria "חשבון", `open-account`) with Avatar 40px → `/account` — `AppHeader.tsx:37-40`. Test: `e2e/design-v2-shell.spec.ts:75` (URL `/account`, heading in viewport).
20. Avatar: Google photo (`referrerPolicy=no-referrer`), falls back on load error to initials on `bg-accent-soft` — `Avatar.tsx:5-40`. Uncovered.
21. `ScreenHeader`: back button default aria "סגירה" with close icon, title `h1`, optional subtitle/trailing — `AppHeader.tsx:46-58`. Test: `e2e/audit-fixes.spec.ts:273`.

### Car switcher sheet
22. Sheet "הרכבים שלי" lists **active** vehicles only (aria "רכבים פעילים"): plate + short name + detail (make model · year when nicknamed); selected has check + `aria-pressed` + aria suffix ", הרכב הפעיל" — `CarSwitchSheet.tsx:52-73`. Test: `e2e/design-v2-shell.spec.ts:132`.
23. Selecting another vehicle: single-flight, buttons disabled while pending, closes and toasts "הרכב הפעיל הוחלף"; failure "לא הצלחנו להחליף רכב. נסו שוב."; selecting the current one just closes; a late result for a previous account/unmounted sheet does nothing — `CarSwitchSheet.tsx:27-47`. Tests: `e2e/design-v2-shell.spec.ts:132,285`.
24. Empty states: "כל הרכבים נמצאים בארכיון." / "עוד אין רכב בחשבון." — `CarSwitchSheet.tsx:74-76`. Test: `e2e/design-v2-shell.spec.ts:243` (archived-only).
25. Actions: "הוספת רכב" → `/vehicles/new`; "ניהול רכבים וארכיון" → `/settings/vehicles` — `CarSwitchSheet.tsx:78-82`. Test: `e2e/design-v2-shell.spec.ts:132`.

### Update banner
26. When a new SW build is staged (or `tm:app-update-available` fires) → floating card above the tab bar: "גרסה חדשה זמינה" / "רעננו כדי לעבור אליה", buttons "רענון" and "אחר כך" — `UpdatePrompt.tsx:47-94`. Tests: `e2e/care-pwa-upgrade.spec.ts:27,43`.
27. Never reloads under the user: `tm:before-app-update` is cancellable; dirty editors (`useAppUpdateBlocker`) refuse → "סיימו את השמירה או שמרו את הטיוטה לפני הרענון." — `appUpdates.ts:9-11`, `useAppUpdateBlocker.ts`, `UpdatePrompt.tsx:25-28,59`. Tests: `src/lib/appUpdates.test.ts:36`, `e2e/care-pwa-upgrade.spec.ts:43,112`.
28. Activation states: "מפעילים את העדכון…" (uncontrolled tab waits for activation), failure "העדכון לא הושלם. אפשר לנסות שוב." — `UpdatePrompt.tsx:59-81`. Tests: `src/lib/appUpdates.test.ts:93`, `e2e/care-pwa-upgrade.spec.ts:27`.
29. Discovery on focus/online/visibility and hourly, throttled to 60 s, never offline or hidden — `appUpdates.ts:15-36`. Tests: `src/lib/appUpdates.test.ts:18,27`.
30. Manual "בדיקת עדכון" (Account/Settings): "בודקים עדכון…", results "גרסה חדשה זמינה — לחצו על רענון בהודעה." / "לא נמצא עדכון חדש." / "חזרו לחיבור לאינטרנט כדי לבדוק עדכון." / "לא ניתן לבדוק עדכון כרגע. אפשר לנסות שוב."; server line "בשרת: גרסה X · בילד <10 chars>"; same-version different commit counts as available — `UpdateCheckButton.tsx:6-27`, `appUpdates.ts:85-107`. Tests: `src/lib/appUpdates.test.ts:41,48,53`, `e2e/care-pwa-upgrade.spec.ts:82,104`.

### Atmosphere (Bgfx)
31. One fixed, `aria-hidden` atmosphere (`data-testid="app-atmosphere"`): wash (240px gradient, 9% tint), radial glow (560px, top −250px), dial SVG (3 circles r 96/140/196, 72 ticks, every 3rd longer/thicker) — `Atmosphere.tsx:4-33`, `design.css:60-63`. Test: `e2e/design-v2-foundation.spec.ts:189-262`.
32. Variant per route: saved→none, /history→journal, /stats→insights, /vehicle|/maintenance|/settings/vehicles→vehicle, /fillup|/service|/expense→entry, /legal→legal, /account|/settings|/notifications|/feedback|/admin→account, else home; signed-out → home; first-run → vehicle (wizard) — `Atmosphere.tsx:10-19`, `src/App.tsx:45-53`. Test: `e2e/design-v2-foundation.spec.ts` (atmosphere-* captures with variant/side/glow).
33. Variant tuning: journal/insights tint `--better` glow .40; vehicle glow .75; entry .35; account `--ink-2` .16 dial .06; legal .10 dial .05; journal/vehicle/entry/legal mirror to the other side — `design.css:64-71`. Test: `e2e/design-v2-foundation.spec.ts` (asserts side and glow).
34. Dial already at `top: -170px`; opacity `--dial-opacity` = .085 light / .13 dark — `design.css:63`, `src/index.css:32,75,99`.
35. Full-screen native dialogs can host the atmosphere (`data-app-atmosphere-host` + `atmosphereRoute`); nested ordinary sheets keep the parent's — `modalLayers.ts:9-10`, `Sheet.tsx:65-70`. Uncovered directly.

### Toasts
36. `role=status aria-live=polite` stack; tones success/error/info with icons; title/detail as NumericText; default 5000 ms; a new toast replaces any existing toast of the same tone — `Toaster.tsx`, `ToastContext.tsx:47-58`. Tests: `e2e/design-v2-fillup-writes.spec.ts`, `e2e/design-v2-journal.spec.ts`.
37. Toast with `onUndo` shows an action button (`undoLabel`, default "ביטול") that runs and dismisses; otherwise a close button aria "סגירת ההודעה" — `Toaster.tsx:24-28`. Test: `e2e/design-v2-fillup-writes.spec.ts` (undo).
38. While a modal is open, toasts render inside the top dialog's toast host (top layer) — `Toaster.tsx:14-15,32`, `modalLayers.ts`. Test: `e2e/design-v2-journal.spec.ts`.

### Sheets and dialogs
39. `Sheet` = native `<dialog>` via `showModal()`, `role=dialog aria-modal`, labelled by title (default sr-only "פרטים נוספים"), grab handle, close button aria "סגירה" gets initial focus — `Sheet.tsx:7-82`. Test: `e2e/audit-fixes.spec.ts:252` (F13 modal focus).
40. Tab/Shift-Tab trapped inside; Escape (`cancel`) and scrim click close; focus returns to the opener (or a `returnFocus` resolver, or into the remaining parent dialog) — `Sheet.tsx:20-58`. Tests: `e2e/audit-fixes.spec.ts:252`, `e2e/design-v2-shell.spec.ts:339` (keyboard sheets).
41. Body scroll locked while any modal is open, restored after the last closes — `modalLayers.ts:15-27`. Uncovered.
42. `ConfirmDialog`: `role=alertdialog`, title/body, confirm (danger or primary) + cancel "ביטול" which gets initial focus — `Sheet.tsx:85-106`. Tests: `e2e/import.spec.ts:159`, `e2e/audit-fixes.spec.ts:46`.

## §6 cross-check

| §6 item | Status | Evidence |
|---|---|---|
| Update banner | present | rows 26-30 |

Related v3 §1/§2 claims about the current shell (not §6, noted for implementers):
- §1 "FAB stays the square 'תדלקתי' / 'טענתי' block": **"טענתי" does not exist in production** (row 14; no EV powertrain exists — see `wizard.md` row 38).
- §1 dial "raised to `top: -170px`": already −170px in production (row 34); only `--do: .04` opacity is a change (now .085/.13).
- §1 tab bar "translucent surface": already translucent with blur (row 10); the change is the pill tint and hairline instead of the 1.5px ink rule.

## v3 changes to this screen

May change (§1, §2.1):
- Tab bar: hairline top border instead of 1.5px ink; active pill as a soft tint (no inset ink ring) — update `e2e/design-v2-shell.spec.ts:75` only if it asserts the ring (it asserts size 50×30, keep that).
- FAB stays square 72×72 ink-bordered block (the only ink block on Home); label becomes "טענתי" for EV vehicles once §7.4 lands.
- Avatar: initial on `--surface` with a 2.5px accent ring open at the bottom (SVG circle, dasharray 112/132, rotate 117°) — new; photo fallback behaviour must stay.
- Atmosphere dial opacity → `--do: .04`; radii/shadows/accent `#F3C54B` tokens; Karantina 400.
- Update banner/toasts adopt hairline + `--r-lg` radius.

Must not change:
- Route table, first-vehicle gating, deletion-pending redirect, tab-bar visibility rule, 4 links + FAB structure and labels, FAB disabled without a vehicle, quick-entry camera preference.
- Header has exactly 3 buttons; car switcher shows active vehicles only, single-flight with account guards, all copy above.
- Update flow never reloads under a dirty editor; manual check result strings.
- Native dialog modality, focus trap/restore, toast top-layer hosting, same-tone replacement, 5 s default duration (the fill-up 5-second undo depends on it).
