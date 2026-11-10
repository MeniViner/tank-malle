# Onboarding, sign-in and splash — Stage 0 behaviour checklist

Shown when signed out (`Shell` in `src/App.tsx`), before any route.

## Sources

- `src/screens/Onboarding.tsx`, `src/components/entry/OnboardingArt.tsx`
- `src/screens/SignIn.tsx`, `src/lib/authFlow.ts`, `src/context/AuthContext.tsx` (`signIn`, redirect recovery)
- `src/screens/Splash.tsx`
- `src/components/Landing.tsx`, `src/components/Previews.tsx` — **not imported anywhere** in `src/` (dead code; no production screen renders them)
- `src/App.tsx` (gating), `src/entry-design.css`
- Tests: `e2e/design-v2-entry.spec.ts`, `e2e/design-completion.spec.ts`, `e2e/design-v2-foundation.spec.ts`, `src/lib/mobileFuel.test.ts`

## Behaviours

### Gating
1. While auth is loading or signing out → `Splash` — `src/App.tsx:90`. Covered indirectly by every e2e sign-in.
2. Signed out and `localStorage["tm.onboarded"] !== "1"` → Onboarding; finishing or skipping writes `"1"` (storage failures ignored) and shows SignIn — `src/App.tsx:42,81-87,104-121`. Test: `e2e/design-v2-foundation.spec.ts:250-262` (removes the key, reloads, sees slides).
3. `/legal/*` is reachable while signed out (renders `Legal`, other paths under it → `/legal/terms`) — `src/App.tsx:94-102`. Test: `e2e/design-v2-entry.spec.ts:83` (legal links from consent).

### Splash
4. `role=status` aria "טוען את טנק מלא", title "טנק מלא" (72px display), subtitle "יומן התדלוקים שלך" — `src/screens/Splash.tsx:7-10`. Uncovered (copy).

### Onboarding
5. Three slides, in order: "תדלוק נרשם ב־15 שניות" / "סכום, ליטרים וקילומטראז׳. את מה שכבר ידוע, נמלא בשבילכם."; "צריכה אמיתית, לא הבטחות" / "בין שני מילויים עד הסוף, עם השוואה לרגיל שלכם ולנתון היצרן כשיש כזה."; "יודעים מתי לתדלק" / "הערכה למועד התדלוק הבא, לפי הנהיגה שלכם." — `Onboarding.tsx:7-11`. Tests: `e2e/design-completion.spec.ts:11`, `e2e/design-v2-foundation.spec.ts:252-262`.
6. Progressbar aria "היכרות עם טנק מלא", `aria-valuemin=1`, `aria-valuemax=3`, `aria-valuenow`=slide; `data-slide` 1–3 on the section — `Onboarding.tsx:21-27`. Test: `e2e/design-v2-foundation.spec.ts:255-257`.
7. "דילוג" (aria "דלג") on every slide ends onboarding immediately — `Onboarding.tsx:25`. Tests: `e2e/design-v2-entry.spec.ts:86`, `e2e/design-v2-foundation.spec.ts:253`.
8. Primary "הבא"; on the last slide "מתחילים" ends onboarding — `Onboarding.tsx:33-35`. Test: `e2e/design-completion.spec.ts:16-22`.
9. Heading receives focus on slide change after the first — `Onboarding.tsx:17`. Uncovered.
10. Art built from real primitives, labelled "נתונים לדוגמה": slide 1 `PumpDisplay` (סכום 218 ₪, קילומטראז׳ 170,344); slide 2 "צריכת הדלק שלכם" 12.8 km/L + pill "5% פחות דלק לק״מ מהרגיל"; slide 3 "התדלוק הבא" "בעוד 4 ימים" + `Gauge` (aria "דוגמה למחוון הדלק", value .45, habit .3) — `OnboardingArt.tsx:4-19`. Tests: `e2e/design-completion.spec.ts:18`, `e2e/design-v2-foundation.spec.ts:258`.

### Sign-in
11. Brand mark "טנק מלא"; headline "כל תדלוק, כל שקל, כל ק״מ."; intro "צריכה אמיתית, הוצאה חודשית, ומתי לתדלק. במקום אחד, גם בלי קליטה."; trust line "הנתונים נשמרים בחשבון שלכם." — `SignIn.tsx:33-35,62`. Test: `e2e/design-v2-foundation.spec.ts:247` (button name).
12. Consent checkbox unchecked by default, aria "קראתי ואני מסכים/ה לתנאי השימוש ולמדיניות הפרטיות", visible "קראתי ואני מסכים/ה" + links "לתנאי השימוש" (`/legal/terms`) and "ולמדיניות הפרטיות" (`/legal/privacy`); following a link does not check it — `SignIn.tsx:38-52`. Tests: `e2e/design-v2-entry.spec.ts:83`, `e2e/design-completion.spec.ts:22`.
13. Submitting without consent: no popup, no auth request; checkbox focused, `aria-invalid=true`, shake animation (none under reduced motion), error "צריך לסמן את התיבה כדי להמשיך" (`role=alert`) — `SignIn.tsx:18-26,54-56`. Test: `e2e/design-v2-entry.spec.ts:83` (popups/authRequests = 0, shake finished, animation none on retry).
14. With consent: "התחברות עם Google" opens `signInWithPopup` synchronously in the gesture (installed Safari); single-flight; button disabled with spinner and "מתחברים…" while signing in — `SignIn.tsx:27-29,57-60`; `AuthContext.tsx:164-170`. Test: `e2e/design-v2-entry.spec.ts:83` (real popup).
15. Popup closed/cancelled → no error — `AuthContext.tsx:173-174`; `authFlow.ts:11`. Uncovered.
16. Popup blocked / unsupported env → redirect fallback only when `authDomain === location.hostname` (sets `tm.auth.redirect` marker), otherwise "חלון ההתחברות נחסם. אפשרו חלונות קופצים ונסו שוב." — `AuthContext.tsx:175-182`; `authFlow.ts:8,13`. Test: `src/lib/mobileFuel.test.ts:23` (authDomainFor never invents a redirect). Redirect path uncovered in e2e.
17. Error messages: network "אין חיבור לאינטרנט. נסו שוב כשיש קליטה."; unauthorized domain "כתובת האפליקציה אינה מורשית להתחברות."; storage "שמירת ההתחברות חסומה בדפדפן. אפשרו אחסון לאתר ונסו שוב."; fallback "ההתחברות לא הושלמה. נסו שוב."; redirect returned without user "ההתחברות לא נשמרה. נסו שוב מתוך האפליקציה." — `authFlow.ts:12-16`; `AuthContext.tsx:102-108`; shown as `role=alert` `signin-auth-error` — `SignIn.tsx:61`. Uncovered.
18. Login initialises the profile before queued writes; live recovery fills only absent fields; offline preference with missing profile survives reload — `AuthContext.tsx`, `src/lib/profileBootstrap.ts`. Tests: `e2e/design-v2-entry.spec.ts:131,305`, `src/lib/profileBootstrap.test.ts`.
19. Signed in with zero vehicles → first-run wizard (see `wizard.md`) — `src/App.tsx:129`. Test: `e2e/design-v2-entry.spec.ts:511`.
20. Entry screens render with the "home" atmosphere (signed-out route maps to `/`) — `src/App.tsx:45-53`. Test: `e2e/design-v2-foundation.spec.ts:248,259`.
21. Gallery at phone width in both themes and every accent — Test: `e2e/design-v2-entry.spec.ts:618`; 320 px usability `e2e/design-completion.spec.ts:11`.

## §6 cross-check

§6 lists no onboarding/sign-in parity item. §7.3 items are new and confirmed **not** in production:

| Item | Status | Evidence |
|---|---|---|
| 4 slides on car-cost management (§7.3) | missing-in-production (new feature, expected) | 3 fuel-only slides — `Onboarding.tsx:7-11` |
| Sign-in headline "כל מה שהרכב עולה. במקום אחד." (§7.3) | missing-in-production (new feature, expected) | current "כל תדלוק, כל שקל, כל ק״מ." — `SignIn.tsx:34` |
| `Landing.tsx` / `Previews.tsx` | exist but unused | no importer in `src/` |

## v3 changes to this screen

May change:
- Slides become 4 (§7.3): TCO card with categories → one record in 15 s for fill/charge/service/expense → real consumption and per-km → nothing falls through (test, insurance, service, issues, refuel forecast); artwork from the real components (TCO card, pump display, consumption number, spotlight + next card), still labelled "נתונים לדוגמה". Progressbar `aria-valuemax` becomes 4 — update `e2e/design-v2-foundation.spec.ts:252-262` and `e2e/design-completion.spec.ts:15-21` (slide count) and record it in QA.md.
- Sign-in headline → "כל מה שהרכב עולה. במקום אחד." (update the copy assertions, if any, only for this string).
- Tone (§1): Karantina 400, hairlines, radius scale, light accent `#F3C54B`; Bgfx atmosphere per §1.

Must not change:
- `tm.onboarded` key and semantics, skip on every slide, focus handling.
- Consent gate (no popup/auth request without consent, focus + aria-invalid + error copy, reduced-motion shake), legal links reachable signed-out and not checking consent.
- Popup-in-gesture, redirect fallback rule, every auth error string, profile bootstrap ordering.
