# טנק מלא · Design v2 ("לוחית") — implementation spec

This folder is the reference for the v2 redesign of the production React app.
`prototype.html` + `proto/*.js` is a working, clickable prototype (React 18 +
htm, no build step). Open it in a browser at 390×844 and click through: every
number in it is computed from raw records by `proto/core.js`, exactly the way
`src/lib/stats.ts` does in production. **The prototype shows intent; production
logic (stats.ts, tank/*, prices/*, outbox, rules) stays authoritative.**

## 1. Identity

Built around the Israeli licence plate. Plate yellow is the brand and the default
accent; the user may pick one of five other curated accents (below). The licence
plate itself is always plate-yellow regardless of the accent.

| Token (light)   | Value     | Use |
| --------------- | --------- | --- |
| `--bg`          | `#F9F7F2` | bright warm off-white page background |
| `--surface`     | `#FFFFFF` | cards, sheets |
| `--surface-2`   | `#F0ECE3` | inset rows, bars, muted chips |
| `--ink`         | `#15130F` | text, 1.5–2px rules, "pressed" button shadow |
| `--ink-2`       | `#4B463C` | secondary text (≥ 4.5:1 on paper) |
| `--ink-3`       | `#6E685B` | tertiary (tab labels, notes; ≥ 4.5:1) |
| `--line`        | `#E4DFD4` | hairlines |
| `--accent`      | `#FFC915` (default) | primary action, FAB, hero highlights, active tab pill, gauge fill |
| `--lp`          | `#FFC915` | the licence plate itself (never changes with the accent; `#EFBE1A` in dark) |
| `--il`          | `#1F4AA8` | plate's blue strip only |
| `--worse`       | `#B4400B` | "used more fuel than usual" (orange) |
| `--worse-bg`    | `#F6E3D6` | |
| `--better`      | `#1F56C2` | "used less fuel than usual" (blue) |
| `--better-bg`   | `#DEE6F7` | |
| `--warn`/`-bg`  | `#8A5A00` / `#FBEFC8` | soft, non-blocking warnings |
| `--danger`      | `#B3261E` | destructive actions and hard blocks only |

Dark theme ("night", warm, deliberately soft — NOT pure black / pure white):

| Token (dark) | Value |
| --- | --- |
| `--bg` `#1E1C18` · `--surface` `#282520` · `--surface-2` `#33302A` · `--line` `#3D3932` |
| `--ink` `#DDD6C7` · `--ink-2` `#A9A292` · `--ink-3` `#8A8376` |
| `--plate` `#E6B417` (slightly dimmed) · `--worse` `#E59468` / `#3B2A20` · `--better` `#9DB6EC` / `#26304A` · `--warn` `#E3BC64` / `#3A311C` · `--danger` `#EE8F86` |
| The post-save yellow screen uses `#D9A915` at night. Toasts invert (light on dark page). |

Rules: text on the accent is always `#111` (every accent below is light enough for ≥ 7:1).
The accent is never used as text on paper. Semantic good/bad is blue/orange (colour-blind
safe), never green/red. Theme setting keeps `system | light | dark`.

### Accent palette (Account → תצוגה → צבע)

| id | label | light | dark |
| --- | --- | --- | --- |
| `plate` (default) | צהוב לוחית | `#FFC915` | `#E6B417` |
| `mint` | מנטה | `#4FD1A5` | `#46BD95` |
| `sky` | תכלת | `#78C2F3` | `#6FB2DF` |
| `peach` | אפרסק | `#FF9F6E` | `#E8906A` |
| `lilac` | לילך | `#C8A8F0` | `#B59AD8` |
| `lime` | ליים | `#CFE24E` | `#BACB48` |

Replace the current 8-colour + custom picker with exactly this list (the old stored
accent id maps to `plate`). The swatch sheet shows six 52px circles with labels and a check.

### Background atmosphere (every screen)

Screens are never a flat colour, but the atmosphere is quiet and professional: no waves,
no blobs, no texture. Behind the scrolling content, fixed to the viewport, sits a
non-interactive layer (`.bgfx`) made of three things:

1. **Wash** — a 240px linear gradient from the top, tint colour at 9% → transparent.
2. **Glow** — one 560px radial gradient (tint at 30% → transparent) centred off a top corner, opacity per variant.
3. **Dial** — a faint gauge motif: three concentric circles (r 96 / 140 / 196 in a 420px box) and 72 tick marks every 5°, every third tick longer and 1.5px. Stroke = ink, opacity .085 in light, .13 in dark. It sits off the same corner as the glow, cut by the screen edge, so only an arc of it shows. It is drawn in SVG once, in the app shell.

| Screens | Tint | Corner (RTL) | Glow opacity |
| --- | --- | --- | --- |
| Home, onboarding, sign-in | accent | start (top-right) | .55 |
| Journal | `--better` (blue) | end (top-left) | .40 |
| Insights | `--better` (blue) | start | .40 |
| Vehicle, vehicle edit, vehicle list, wizard | accent | end | .75 |
| Fill-up, service, expense | accent | end | .35 |
| Account, notifications, feedback, import, unsynced, admin | `--ink-2` | start | .16 (dial .06) |
| Legal | `--ink-2` | end | .10 (dial .05) |
| Post-save | none (the screen is solid accent) | | |

The tab bar is translucent (`color-mix(bg 88%, transparent)` + `backdrop-filter: blur(14px)`)
so the atmosphere shows through. Cards keep solid surfaces. Text over the atmosphere must
still clear 4.5:1 — the layer is light enough that this holds everywhere.

## 2. Typography (self-hosted, like today)

| Role | Family | Notes |
| --- | --- | --- |
| Display: hero numbers, screen titles, card headlines, month headers | **Karantina 700** (fallback: Secular One, Arial Narrow) | tight: `line-height .82–.9`, `letter-spacing -.01em` |
| UI / body | **IBM Plex Sans Hebrew 400–700** (fallback: Assistant, system-ui) | body 16px / 1.55 |
| Pump-style readouts: fill-up inputs, odometer digits, plate number | **IBM Plex Mono 500–600** | `tabular-nums` |

Sizes used in the prototype: hero number 128px (home consumption), 196px (post-save),
screen title 62px, card headline 34px, month header 34px, entry amount 26px,
labels 13px/600, notes 12.5px. Minimum readable text 12px; secondary text never lighter than `--ink-2`.

Host WOFF2 Hebrew+Latin subsets in `public/fonts/` with their OFL licences and precache them via vite-plugin-pwa (same mechanism as the current Assistant/Frank Ruhl Libre).

## 3. Shape & components

- No floating cards with shadows. Groups are separated by a `1.5px solid var(--ink)` top rule and `1px var(--line)` hairlines between rows. Radius: cards 20px, sheets 26px top, controls 12–16px, chips 99px, plate 12px.
- **Primary button** (`.btn`): 56px, yellow, `2px solid #111`, hard shadow `0 4px 0 #111`, presses down 3px. `.btn.ink` = ink fill, `.btn.line` = outlined, `.btn.danger` = outlined red. Disabled = 45% opacity, never "greyed yellow".
- **FAB "תדלקתי"**: 72×72, radius 22, yellow, same hard shadow, label inside the button. Sits in the tab bar, `-30px` up.
- **Tab bar**: 90px, translucent (see atmosphere), `1.5px` top rule, five slots: בית · יומן · [תדלקתי] · תובנות · רכב. Icons are the `i-t-*` symbols in `prototype.html` (home, journal, insights, car, pump), 23px, 1.8px stroke. Each icon sits in a 50×30 pill; the **active tab's pill fills with the accent**, gets a 1.5px ink inset ring and the icon/label turn ink. Press = pill scales to .92.
- **Pump display** (`.pump`): ink block, label right, mono value left (LTR), hairlines between rows, one caption line under each row (derived-value note / error / "+346 ק״מ מהרישום הקודם").
- **20-segment gauge** (`.ticks`): LTR, E…F, filled segments yellow, learned-habit marker as a 2px light line, reserve segments orange when low. Tappable in the tank sheet and in "עוד פרטים".
- **Licence plate** (`.plate-xl`, `.miniplate`): yellow, black 3px border, blue IL strip on the left, mono digits, `dir="ltr"`.
- **Odometer** (`.odo`): six ink digit cells, last cell yellow, mono 30px, LTR.
- **Bottom sheet**: 26px top radius, grab handle, title in Karantina 34px, close button, scrim 45%. Esc closes. Focus trap as today.
- **Toast**: ink pill above the tab bar (or at the top when a sheet is open), optional yellow "ביטול" button, 5s.
- **Pills**: `.pill.worse/.better/.neutral` for one-line comparisons.
- Touch targets ≥ 44px. `prefers-reduced-motion` disables the slide/scale animations.
- Icons: 2px stroke, round caps, 24px grid; category icons: tire, oil, brake, battery, tools, wrench (service) · shield, doc, parking, road, drop, ticket, coin (expense). All are inline SVG symbols in `prototype.html` — port them into `src/components/icons.tsx`.

## 4. Numbers, money, RTL (hard rules)

1. Every numeric run is an isolated LTR island (`<bdi>` / `.n` with `unicode-bidi: isolate`), the Hebrew unit word stays outside it (existing `Fmt.tsx` rule).
2. **A number that starts its own line (hero numbers, KPI values, card headlines, sheet values) is right-aligned** — it starts at the RTL start edge. Only numbers that belong at the end of a row (amount column in the journal, value column in rows, pump-display inputs) sit on the left.
3. **Money is displayed in whole shekels** (`shekel()`), never with agorot: ₪218, ₪1,374. The one exception is **per-litre price**, always two decimals (`price()`): ₪7.35. Calculations, stored values, exports and editable fields keep full precision (AGENTS.md).
4. Litres: one decimal in lists, two in forms. Consumption: one decimal. Percent: integer.
5. Dates: Hebrew day-first everywhere ("22 באוק׳", "22 באוקטובר 2026"); never `10/22/2026`. Native `<input type=date>` is acceptable for pickers.
6. Odometer digits group with commas (170,510).

## 5. Terminology & copy

- The odometer is **קילומטראז׳**; the physical counter is **לוח הקילומטרים**. Never "מד אוץ" (that is a speedometer).
- Tabs: בית · יומן · תדלקתי · תובנות · רכב. Account screen: חשבון.
- Full tank: "מילאתי עד הסוף" / partial: "תדלוק חלקי". Continuity break: "פספסתי תדלוקים לפני זה".
- Backup: "גיבוי · שמירת עותק של כל הנתונים" (not "JSON"). Unsynced: "שינויים שעוד לא עלו לענן".
- Pump-price question: "המחיר במשאבה היה ₪7.75?" asked AFTER save, never inside the form.
- Write like a driver talks. Delete explanatory paragraphs under components; explanation lives behind a tap (sheet or InfoTip). No sentence that explains what the screen does.
- Empty states: one Karantina headline, one short sentence, one action. No illustration-in-a-circle template.

## 6. Information architecture

- `/` Home · `/history` Journal · `/stats` Insights · `/vehicle` Vehicle · FAB → `/fillup/new`.
- Header (home only): plate chip + vehicle nickname → car-switch sheet; bell → `/notifications`; avatar → `/account`. **No sync dot on the avatar and no "everything is saved" banner.** Sync surfaces only when something needs the user: a conditional row in Account ("שינויים שעוד לא עלו לענן · N") that opens the existing Unsynced screen, shown only when the outbox has pending/rejected/conflict entries.
- `/account` replaces both `/settings` and `/settings/profile` (keep old routes as redirects). Sections in order: identity · דלק ומחיר (הנחה בתדלוק, מחיר 95) · תצוגה (מראה, יחידת צריכה, "כפתור תדלקתי פותח מצלמה") · התראות (כל ההתראות, טסט/ביטוח/טיפולים, שינוי מחיר) · השוואה לנהגים (opt-out toggle) · הנתונים שלי (ייצוא CSV, גיבוי, ייבוא) · ניהול (לוח בקרה, admins only) · עוד (משוב, שיתוף, תנאים, פרטיות, התנתקות, מחיקת חשבון).
- Vehicle management (add / archive / restore / edit) lives ONLY under the Vehicle tab and the car-switch sheet.

## 7. Screens (behaviour, in priority order)

### Home
0. **Spotlight** (directly under the header, above the hero): a horizontally swipeable carousel of up to 4 cards, one visible at a time, scroll-snap, dots under it (start-aligned), auto-advances every 7 s until the user touches it. **Rendered only when there is something to say; never an empty card.** Card: 1.5px ink border, radius 18, surface with a 9% tone wash, 44px icon tile in the tone colour, Karantina title (≤ 2 lines), one or two lines of body, and either a ✕ (dismiss, remembered per item id) or a › for sticky items. Items, in priority order, each with its tone and target:
   1. rejected / conflicting write → `danger`, sticky → Unsynced screen
   2. licence doc expiring ≤ 30 days (טסט, ביטוח חובה, ביטוח רכב) → `warn` (`danger` and sticky when < 7 days or expired) → that doc's sheet
   3. km-based reminder within 500 km or overdue → `warn` → reminder sheet
   4. personal-best segment (last segment is the best, ≥ 3 segments) → `better` → segment sheet
   5. regulated 95 price changed this month (95 vehicles only) with the per-tank difference → `info` (accent) → price sheet
   6. previous month's summary during the first 7 days of a month → `info` → Insights › הוצאות
   Tones: `info` = accent, `warn` = `--warn`, `danger` = `--danger`, `better` = `--better`. Dismissals persist per item id (local storage is fine; a new month/new due date creates a new id).
1. **Hero: next refuel** — ink block. Label "התדלוק הבא", Karantina "בעוד N ימים" (yellow N; "היום"/"מחר"), 20-segment gauge with the learned-habit marker, one sentence ("בדרך כלל אתה מתדלק כשנשארים 37%…"), footer "לפי המחוון שסימנת / הערכה מהטנק המלא האחרון · עדכון ›". Source: `tank/forecast` (`expectedRefuel` = action shown, `recommendedRefuel` = in the sheet). Unknown level → headline "כמה דלק יש עכשיו?" and tap opens the gauge sheet. When level ≤ reserve: label "הדלק עומד להיגמר", orange segments.
   Tap → **tank sheet**: tappable gauge to set the level, rows "מתי תרצה לתדלק" (behaviour), "מתי כדאי לתדלק לכל המאוחר" (recommendation/reserve), "טווח משוער", note with the consumption and daily-km assumptions, button "עדכון המחוון" (writes a tank observation).
2. **Consumption** — label "צריכה בתדלוק האחרון", 128px number + unit, one pill ("29% יותר דלק לק״מ מהרגיל שלך (12.0)" / "…פחות…" / "בדיוק כמו הרגיל שלך"), then the **consumption sparkline** (no bars, no dashed line): the last six closed segments as a smooth ink line (Catmull-Rom → Bézier) with a 10%→0 ink area under it, a value label above every point, dots r 4 (last point r 6.5 in the tone colour: orange worse / blue better / ink same), date labels under the baseline (last one bold), and behind everything a horizontal **"usual" band** = own average ±7%, filled with the accent at 42% (40% dark), rounded. Below the chart a two-item legend: band swatch "הטווח הרגיל שלך, סביב 12.0" and a dot "התדלוק האחרון". Oldest segment on the right. Tap any point → **segment sheet** (km, litres incl. partials, cost, agorot/km, closing fill-up, one explanatory note).
   No closed segment yet → dashed empty block: "עוד תדלוק מלא אחד ונדע" + progress bar.
3. **Trio** — three columns divided by ink rules: "נוסע ביום · 18 ק״מ · כ-550 בחודש" (from the odometer timeline / `tank/mobility`), "דלק לחודש · ₪229 · בממוצע", "95 היום · ₪7.35 · מחיר מרבי" (→ price sheet with the official-price history line, discount CTA). Unknown values show "—", never 0.
4. **לאחרונה** — last 3 entries (same row component as the journal) + "כל היומן".
5. New vehicle with no fill-ups → one dashed block "מתחילים מהתדלוק הבא" with the yellow primary button. **No zero tiles anywhere on Home** (no "₪0 · 0 רשומות", no "תחזוקה: ללא כללים").

### Fill-up (`/fillup/new`, `/fillup/:id`)
- Header: ✕ · "תדלוק חדש" · camera button (opens the scan flow as a sheet; result fills the form; nothing else changes).
- Chips: time ("היום, 08:14" → tap opens the date/time field), station ("דלק קרית מלאכי · לפי מיקום" → station sheet with search, nearest first).
- **Pump display**: סכום (₪, autofocus) · ליטרים (ל׳) · מחיר לליטר (₪, prefilled from `resolveStationPrice`/discount, smaller) · קילומטראז׳ (ק״מ). Receipt ownership per `receipt.ts`: a typed figure never moves; the untyped one is derived and labelled ("חושב לפי ₪7.75 לליטר · הקלידו לשינוי"). Three typed figures that disagree → amber box "לא מסתדרים, נשמור מה שהקלדתם". Odometer caption: "+346 ק״מ מהרישום הקודם"; hard block in red caption "הזינו בין 170,345 ל-170,999".
- Segmented "מילאתי עד הסוף / תדלוק חלקי" (ink fill on the selected one).
- **Live preview** line driven by `evaluateDraft()`: "12.3 ק״מ לליטר צפוי למקטע הזה" / "תדלוק חלקי: 28.2 ל׳ יצטרפו…" / "טנק מלא ראשון: מכאן נתחיל למדוד". Soft warnings (amber boxes) for litres > tank, implausible consumption, > 1,500 km gap ("פספסתם תדלוק?").
- **עוד פרטים** (collapsed): date-time, pre-fill gauge (optional), reason chips, "פספסתי תדלוקים לפני זה" toggle (continuityBreakBefore), note. Edit mode adds a red outlined delete button.
- Save is always a yellow enabled button; missing fields are shown as red captions after the first attempt (and the pump block shakes).

### After save (`/fillup/saved/:id` or state)
- Full yellow screen: "✓ נשמר", 196px consumption of the closed segment, "ק״מ לליטר במקטע שנסגר", one comparison line (vs. own average / "השיא שלך עד היום"), rows: הממוצע שלך · נתון היצרן · המקטע (km · ל׳) · עלות לק״מ. First full / partial: shows litres + money instead and one sentence.
- **Pump-price card**: "המחיר במשאבה היה ₪7.75?" → כן / לא, היה אחר (→ inline price input; the difference is recorded as the user's discount, never as the station's price). This replaces the in-form question; the resolver semantics stay.
- Bottom: ink "סיום" + text "ביטול השמירה (5)" counting down (existing undo).

### Journal (`/history`)
- Title "יומן" (Karantina 62) + ink pill "+ הוספה" → add menu sheet (תדלוק · טיפול · הוצאה · עדכון ק״מ).
- Search field, filter chips (הכל · תדלוקים · טיפולים · הוצאות · ק״מ ומחוון).
- Month groups: Karantina month, totals on the right (whole shekels · N תדלוקים). Rows: big day number + month, brand/category badge, title, meta line ("28.2 ל׳ · מלא · 9.3 ק״מ/ל׳"), amount in Karantina 26px at the end. Odometer updates and gauge marks are **quiet rows** (dashed hairline, small text). A service with an odometer far from the vehicle's gets "· לבדוק" in warning tone.
- Tap → entry sheet (details, edit, delete with confirm + undo toast). Pending/anomalous/continuity states stay visible as small captions.

### Insights (`/stats`)
- Title "תובנות" + period chip (3 חודשים · 6 חודשים · שנה · הכל). Chips: צריכה · מחירים · הוצאות · השוואה.
- Every card opens with a headline sentence ("אתה נוסע 12.2 ק״מ לליטר", "הכי זול לך: פז רמות", "כל ק״מ עולה לך 58 אג׳"); the chart proves it. Charts: ink line, dashed own-average, last point in tone colour, RTL axis (oldest right), no gridlines, 10.5px labels. Keep Recharts; theme it to these rules (or hand-drawn SVG like the prototype for the small ones).
- צריכה: trend + legend + vs. manufacturer line; KPIs: best / weakest segment (tap → segment sheet), measured km, litres. מחירים: paid vs. official line, station ranking bars (cheapest highlighted yellow), spread per tank. הוצאות: stacked monthly bars (fuel yellow / service ink-2 / other paper), agorot-per-km card, three rows linking to filtered journal. השוואה: progress "עוד נהג אחד ונשווה" until 4 comparable drivers, what-is-shared card; opt-out state.

### Vehicle (`/vehicle`)
- Plate XL as the header, Karantina make+model, meta line, odometer digit cells + "עדכון" chip (odometer sheet: cannot go below the last reading; > 3,000 km jump asks "נכון?").
- **רישוי וביטוח** — three rows every vehicle always has: טסט שנתי · ביטוח חובה (insurer, valid-until, yearly cost) · ביטוח רכב (מקיף / צד ג׳ / אין, insurer from a chip list or free text, valid-until, cost). Right side shows days left (orange < 30, "פג תוקף" when past) or a dashed "+ הוספה" chip. Each row opens a sheet. Reminders: a month before and a week before. New data on the vehicle document (`docs: { test, mandatory, coverage }`), optional, additive — check `firestore.rules` `validVehicle` and the rules tests; keep `hasOnly` lists intact where they exist.
- **תזכורות** — km-based plans (טיפול תקופתי, החלפת שמן, החלפת צמיגים) with suggestion chips for the missing ones; row shows km/days left.
- **מה קורה ברכב** — open issues + "משהו השתנה ברכב?" row (sheet with quick chips: רעש מוזר · נורה בלוח · רעידות · ריח; mark as fixed).
- Rows: "2026 עד עכשיו · ₪1,774", "טיפולים", "פרטי הרכב" (edit screen: nickname, make/model, year, fuel segmented with the 95-only-regulated warning, tank with "הערכה" hint, manufacturer figure, "עדכון ממשרד התחבורה").
- "ניהול רכבים" chip → vehicle list (active with "פעיל"/"בחירה", archive icon, add button, archive section with "החזרה").

### Account, Notifications, Feedback, Import, Unsynced, Legal
Restyle with the same components; behaviour unchanged except: Profile+Settings merged into Account (section order above), accent picker removed, sync toggle removed, "quick scan" toggle makes the FAB open the camera first. Notifications: cards with an unread dot and "העברה לארכיון". Feedback: segmented רעיון · תקלה · מחמאה + one textarea + counter. Import: pick → reading → preview (new / duplicate rows, "assumed full tank" warning) → done with undo.

### Onboarding, sign-in, vehicle wizard
Same yellow/ink language from the first screen (no turquoise). Three slides with real UI fragments as illustrations. Sign-in: consent checkbox must be ticked (shake + red caption otherwise), Google button, one trust line. Wizard: plate keypad in pump-key style, lookup → "זה הרכב שלך?" read-only rows + "תיקון פרטים", step 3 optional nickname/tank/manufacturer figure, "אשלים אחר כך".

### Admin (`/admin`)
Same four tabs (סקירה · משתמשים · נתונים · משוב) and the same read-only guarantees; restyled: KPI tiles in Karantina, stacked spend bars, user rows with avatar initial, fuel-price rows with "עודכן אוטומטית/ידנית · מתי", health rows, feedback cards with handled state. Entry from Account → ניהול → לוח בקרה (admins only).

## 8. Out of scope for the redesign
`stats.ts`, `continuity`, `tank/*` engine, `prices/*` resolver, outbox/write states, Firestore rules semantics (only additive optional vehicle fields), import pipeline, benchmarks. The redesign changes what the user sees and how they get there, not what is computed.
