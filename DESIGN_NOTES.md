# Design Notes — טנק מלא (Tank Male)

The current interface integrates the existing Open Design project
`b3eca5a7-c0ed-4d56-a6f3-3884af335e5c` with the production React application.
Base viewport 430px; verified layouts also cover 320px and 360px. Full Hebrew RTL.

The prototype supplies visual direction, not account records or calculations.
Production statistics, station identities, pricing, offline drafts and durable
outbox remain authoritative. No schema or Rules changes are required.
Settings contains behavior and appearance; Profile contains account/data tools.
Profile export scope explicitly chooses all vehicles (including archive) or the
active vehicle. Fill-up and tank-update CSV downloads remain separate gestures.
The preferred refuel level means remaining fuel WHEN refuelling, not a target
fill amount. Actual install detection and admin claims replace prototype samples.

## Design tokens

Semantic tokens, light on bare `:root`, dark under `[data-theme="dark"]` and
`@media (prefers-color-scheme: dark)` when the theme setting is `system`.

| Token               | Light     | Dark      | Usage                                  |
| ------------------- | --------- | --------- | -------------------------------------- |
| `--bg`              | `#F4F5F5` | `#0D0F10` | App background                          |
| `--surface`         | `#FFFFFF` | `#16191B` | Cards, sheets, bars                     |
| `--surface-2`       | `#EBEDEE` | `#1F2326` | Inset rows, muted chips, segmented bg   |
| `--ink`             | `#14171A` | `#E8EBEC` | Primary text                            |
| `--muted`           | `#636A70` | `#959CA1` | Secondary text, labels                  |
| `--line`            | `#E2E5E6` | `#262B2E` | Borders, dividers                       |
| `--accent`          | `#0B6B5E` | `#4FD3BC` | Primary action + hero number only       |
| `--accent-contrast` | `#FFFFFF` | `#0B1613` | Text/icon on accent fill                |
| `--accent-soft`     | `#E3F0ED` | `#123A34` | Accent-tinted chip/icon backgrounds     |
| `--success`         | `#2E9E5B` | `#58C98B` | Better than average                     |
| `--success-soft`    | `#E1F3E7` | `#12331F` | Success chip background                 |
| `--success-ink`     | `#1D7A43` | `#8FE3B0` | Success chip text                       |
| `--warning`         | `#B45309` | `#E5A54C` | Soft, non-blocking validation warnings  |
| `--warning-soft`    | `#FDF0DC` | `#3A2A11` | Warning banner background               |
| `--danger`          | `#CC3D2E` | `#EF7A69` | Destructive / hard blocks only          |
| `--danger-soft`     | `#FCE7E3` | `#3A1A16` | Danger banner background                |
| `--hero`            | `--surface` | `--surface` | Compatibility tokens for the form receipt |
| `--hero-ink`        | `--ink` | `--ink` | Receipt text |
| `--hero-muted`      | `--muted` | `--muted` | Receipt secondary text |
| `--hero-accent`     | `--accent` | `--accent` | Receipt accent |

Accent identifies primary actions, meaningful status and selected controls.
Semantic colors are independent of the accent choice.

### Accent palette (settings swatches)

`טורקיז נפט #0B6B5E` (default) · `כחול ים #1D5FA8` · `סגול #6D4AA8` ·
`ורוד #B03A72` · `אדום חמרה #B33A2B` · `כתום #B4620E` · `ירוק זית #4A7A22` ·
`אפור פחם #44544C`, plus a custom color input.
Each accent ships a lightened dark-mode variant that keeps AA contrast.

## Typography

Locally hosted Assistant (200–800) for UI and Frank Ruhl Libre (300–900) for headings and headline figures. WOFF2 Hebrew/Latin subsets are precached by the PWA. Upstream OFL licenses are in `public/fonts/`.

| Role                   | Style                    |
| ---------------------- | ------------------------ |
| Hero number            | Frank Ruhl Libre `500 64px/1` on Home, `600 26–30px` elsewhere, `tabular-nums` |
| Screen title           | Frank Ruhl Libre `600 30px` (pushed headers use Assistant `700 18px`) |
| Card title             | `700 19px`               |
| Body                   | `400 16px`               |
| Row title              | `600 15px`               |
| Secondary / meta       | `400 13px`, muted        |
| Field label            | `600 13px`, `letter-spacing:.02em`, muted |
| Chip / tab label       | `600 12.5px` / `700 11px` |

Every digit run uses `font-variant-numeric: tabular-nums` and is wrapped in
`dir="ltr"` so Latin/numeric values do not reorder inside RTL text.

## Shape & elevation

- Groups: `border-radius: 14px`, `var(--surface)`, hairlines between rows. Home consumption and chart sections sit directly on the page.
- Pills/chips/FAB: `border-radius: 99px` / `50%`.
- Controls: `10px` radius; sheets: `22px`. Icons are bare semantic glyphs. Cards have no shadows.
- Phone frame in the kit: `30px` radius (app itself is edge-to-edge).
- Elevation is used sparingly: bottom bar hairline `1px` top border; FAB has
  `0 12px 24px -8px rgba(14,122,107,.6)` and a `4px` ring in `--bg`.

## Layout

- Screen padding: `20px` horizontal; content gap `13px`.
- Status bar `44px` (device), app header `~48px`, bottom bar `88px` incl. home indicator.
- FAB: `56px` circle, centered in the tab bar, `margin-top:-24px`.
- Touch targets ≥ 44px; primary actions live in the thumb zone.
- `prefers-reduced-motion` disables transitions/animations.

## Screen inventory

| #   | Screen                    | Route / surface                          |
| --- | ------------------------- | ---------------------------------------- |
| 01  | ספלאש                     | `/` boot splash                          |
| 02–04 | אונבורדינג 1–3          | `/onboarding` (first visit only)         |
| 05  | התחברות                   | `/signin` — Google only                  |
| 06  | אשף · לוחית רישוי         | `/vehicles/new` step 1 + numeric keypad   |
| 07  | אשף · אימות פרטים         | `/vehicles/new` step 2                   |
| 08  | אשף · פרטים אופציונליים   | `/vehicles/new` step 3                   |
| 09  | מסך הבית · בהיר           | `/` dashboard                            |
| 10  | תדלוק חדש · ממולא מראש    | `/fillup/new`                            |
| 11  | תדלוק חדש · אזהרה רכה     | `/fillup/new` soft-warning state         |
| 12  | אישור שמירה + ביטול       | success toast + 5s undo                  |
| 13  | תדלוק בתאריך עבר          | backdated state w/ allowed odometer range |
| 14  | היסטוריה · לפי חודש       | `/history`                               |
| 15  | פעולות על רשומה           | history row action sheet                 |
| 16  | היסטוריה · מצב ריק        | `/history` empty state                   |
| 17  | סטטיסטיקות                | `/stats`                                 |
| 18  | הגדרות                    | `/settings`                              |
| 19  | פרופיל וחשבון             | `/settings/profile`                      |
| 20  | ניהול רכבים · ארכיון      | `/settings/vehicles`                     |
| 21–24 | מצב כהה                 | dark variants of 09, 10, 17, 18          |

## Component patterns

- **Vehicle switcher pill** — white pill with car icon + `מאזדה 3 · 2018` + chevron, top-right avatar.
- **Hero consumption card** (Home) — a DARK card in both themes, on its own
  `--hero*` tokens: label + outcome chip, 52px number + `קמ״ל`, a sparkline of
  the last six closed segments (newest bar in `--hero-accent`), then a hairline
  and the footer pair `ממוצע כולל 14.1 קמ״ל` / `מבוסס על 3 מקטעים · 5 תדלוקים`.
- **Stat pair** — two equal cards: `הוצאה החודש` / `מחיר דלק נוכחי`. A month with
  no fill-up in it reads `טרם תודלק` + `אחרון: 31 באוג׳`, never `₪0`.
- **Timeline** (Home history) — rail down the end edge, one node per record
  (newest filled in `--accent`, the rest hollow); row = name + meta at the
  start, consumption at the end. No card around it.
- **Info strip** — `--surface-2`, radius 14, icon + 13px text.
- **List card** — rows separated by `1px solid` hairline; row = title + meta, trailing chip.
- **Form card** — grouped rows with a 36px icon tile, label above value, trailing action link.
- **Paired inputs** — `ליטרים` ⇄ `סה״כ לתשלום`, each editable, the other recomputed live.
- **Soft warning** — amber banner inside the field card; never blocks saving.
- **Hard block** — red helper text with the allowed range, e.g. `הזן בין 41,200 ל־42,850`.
- **Segmented control** — pill track in `--surface-2`, active segment `--surface` (theme,
  units, stats range `3ח׳ / 6ח׳ / שנה / הכול`).
- **Bottom sheet** — radius-28 top corners, grab handle, action list, `סגירה`.
- **Bottom tab bar** — `בית · היסטוריה · [FAB תדלוק] · סטטיסטיקות · הגדרות`.

## Charts (screen 17)

Recharts, RTL-adjusted (reversed X axis, right-side Y axis), tokens for colors:
consumption trend line (accent) + dashed average reference line, monthly spend
bars, paid-vs-official price dual line, cumulative odometer area. Records cards:
`התדלוק היקר ביותר`, `החודש החסכוני`.
