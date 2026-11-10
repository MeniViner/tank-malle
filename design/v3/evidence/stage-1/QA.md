# Stage 1 · Tokens, tone and the money rule: QA

Scope: DESIGN-V3 §1 (airy tone), §4 (category colours), §5 (money/units), and
the "previous month with data" helper. No screen logic changed. Home/Insights
layout work (sorted full legend, month/year chip, facts strip) is Stage 2/3.

## Token table (old → new)

| token / rule | v2 | v3 (Stage 1) | where |
|---|---|---|---|
| Display weight (Karantina) | 700 (some 600) | **400** everywhere. 66 CSS declarations + 9 TSX `font-display font-bold/semibold` → `font-normal`; `.tm-number.font-display` 700 → 400 | all `src/*.css`, 6 TSX files |
| Karantina 400 face | not bundled | **added** `karantina-{hebrew,latin}-400.woff2` (Google Fonts, same source as 700) | `public/fonts`, `src/fonts-v2.css`, manifest |
| IBM Plex Mono 400 face | not bundled | **added** `ibm-plex-mono-{latin,latin-ext}-400.woff2` for §3 facts values | same |
| `--r-lg / --r-md / --r-sm` | — | **20 / 14 / 10px** | `src/index.css :root` |
| Tailwind radii | card 20, tile 12, sheet 26, control 16; sm/md/lg/xl = tw defaults | card/sheet → `--r-lg`, tile/control/xl → `--r-md`, `sm` → `--r-sm`, `md` → `--r-md`, `lg` → `--r-lg` | `@theme inline` |
| CSS radii | 7…26px literals | 113 literals → tokens: 7–11px → `--r-sm`, 12–17px → `--r-md`, ≥18px → `--r-lg`. Kept: `50%`, `99px/999px` pills, `inherit`, ≤6px micro radii (ticks, bars, focus rings), the licence plate (12px/4px, a drawing of a physical object). Spotlight inner button = `calc(--r-lg − 1px)` | all `src/*.css` |
| TSX radii | `rounded-[8…24px]`, `rounded-md/lg/xl` | mapped by the same rule to `rounded-sm/md/lg` (52 class changes); `Field` input → `rounded-md` | 25 TSX files |
| Card/row borders | 1.5–2px ink (`--ink` / `#111`) | **1px `--line`** (59 rules by script, then ~20 by hand). Fixed-light surfaces on the saved screen / pump question use `1px rgb(17 17 17 / .25)` (prototype `.yellow .ask`) | all `src/*.css` |
| Ink kept (pressed/selected + instruments) | — | primary `.tm-button` (1.5px), FAB (2px), mini/xl plates, `aria-pressed` admin tabs, switch track, consent checkbox, brand mark, editable gauge filled ticks, wizard fuel `:checked`, tank habit marker; odometer/pump keep their readout lines | — |
| `--shadow-card` | `none` | light `0 1px 0 rgb(21 19 15/.04), 0 8px 24px -18px rgb(21 19 15/.25)`; dark `none`; applied to Card, TCO, spotlight, insights/secondary/admin cards, vehicle hero/links, entry art | `index.css`, card rules |
| Primary button | 2px ink, `0 4px 0 #111`, weight 700, press 3px | 1.5px ink, `0 2px 0 rgb(17 17 17/.55)`, weight 600, press 2px/no shadow; `.tm-button-line` border `--line` | `design-primitives.css` |
| Light accent default (`plate`) | `#FFC915` | **`#F3C54B`** (dark `#E6B417` unchanged; `--lp` plate `#FFC915`/`#EFBE1A` unchanged) | `index.css`, `accents.ts`, `index.html` pre-paint |
| Category colours | TCO: accent / ink / ink-2 / ink-3 / better / surface-2 | `--cat-fuel` (=accent), `--cat-service #15130F/#D9D2C3`, `--cat-ins1 #2E5C8A/#6E9ED4`, `--cat-ins2 #86ACCF/#A9C6E4`, `--cat-test #8C6A3F/#B99263`, `--cat-other #B9B2A4/#6F685D` + `--cat-*-on` icon colours | `index.css`; used in `TcoBlock.tsx` (bar, legend, sheet tiles), `SpendingInsights.tsx` (stacked bars, legend, fuel bar), `admin.css .vehicle-year-bar` |
| Dial opacity | light .085, dark .13, account .06, legal .05 | **light .04, dark .06** (prototype `--do .04`, ×1.5 dark), one value for every variant | `index.css`, `design.css` |
| Dial position | `top: -170px` | unchanged (already −170px) | `design.css` |
| Atmosphere glow / wash | glow .55 (journal/insights .40, vehicle .75, entry .35), wash 240px | glow **.30** (lite.css `--go .3`); variants scaled: journal/insights .22, vehicle .40, entry .20, account .16, legal .10; wash **200px** | `design.css` |
| Tab bar | translucent, 1.5px ink top rule, active pill = solid accent + 1.5px ink ring | translucent (unchanged), **1px `--line`** top rule, active pill = `color-mix(accent 38%, transparent)`, ink icon, no ring | `shell-design.css` |
| FAB | square, 2px ink, `0 5px 0 #111`, radius 22 | square kept, 2px ink, `0 3px 0 #111`, press 3px, radius `--r-lg` (20) | `shell-design.css` |

Judgement calls (flag if you disagree): glow values per variant (the prototype
collapses them all to .3, which would *raise* account/legal); the button
min-height stayed 56px (prototype 54px) to avoid layout churn in this stage;
the licence plate keeps its own corner radius; inputs moved to hairlines like
the prototype (see CONTRAST.md open question).

## Money and units (§5)

- `shekel(v)` → `"777 ₪"`, `shekelSigned(v)` → `"−12 ₪"` / `"+5 ₪"` (rounded zero unsigned), `price(v)` → `"7.35 ₪"`. `vehicleMoney` follows through `shekel`. Exports/CSV/persistence never used these, unchanged.
- `NumRun` (`Fmt.tsx`) parses the new trailing form (digits, optional U+202F/NBSP/space, ₪) without changing a character. Trailing ₪ and its gap are marked `data-unit-position="trailing"`; CSS gives them `order: 2`, so the symbol sits **after** the digits inside the LTR island ("777 ₪"). `%` and legacy authored leading "₪25" keep the v2 left placement. The symbol stays `.8em`, sans.
- `NumericText` recognises `123 ₪` / `123 ₪` inside mixed copy.
- Hand-built strings moved to the formatters: `TcoBlock` per-km (`₪${num(x,2)}` → `price(x)`), `Previews` (`₪655` → `shekel(655)`), fill-up validation messages (`עד ₪100` → `price()`, `עד ₪50,000` → `shekel()`), numeric hint (`נקרא כ־1234 ₪` → U+202F).
- "לכל ק״מ" → "לק״מ" (only occurrence: `TcoBlock` sub-line). No other variants found in `src/` or `e2e/`.
- `AGENTS.md`: added the order rule; examples now `7.35 ₪` / `7 ₪`.
- New helper `src/lib/monthWithData.ts` → `latestMonthWithData(rows, today)` returns `{ key, year, month, label: "אוק׳", longLabel, isCurrent }` or `null`. Counts rows whose `amount` is omitted or finite non-zero; ignores future months; reads civil date strings without UTC shift. Not wired into screens (Stage 2).

## Files touched

- Fonts: `public/fonts/{karantina-hebrew-400,karantina-latin-400,ibm-plex-mono-latin-400,ibm-plex-mono-latin-ext-400}.woff2` (new), `public/fonts/design-v2-fonts.json`, `public/fonts/DESIGN-V2-FONTS.md`, `src/fonts-v2.css`.
- Tokens/tone CSS: `src/index.css`, `design.css`, `design-primitives.css`, `shell-design.css`, `account-design.css`, `admin-design.css`, `admin.css`, `care-entry-design.css`, `entry-design.css`, `fillup-design.css`, `home-design.css`, `insights-design.css`, `journal-design.css`, `journal-entry.css`, `notification-design.css`, `secondary-design.css`, `tank-design.css`, `tco-design.css`, `vehicle-design.css`, `vehicle-page-design.css`, `vehicle-wizard-design.css`.
- TSX class-only changes (radius/weight): `components/{Card,DateTimePicker,Field,FuelDiscountSheet,Landing,Previews,ReceiptImport,StationBrand,TankGauge,TankStateSection,UpdatePrompt}.tsx`, `components/account/AccountMore.tsx`, `components/fillup/StationSheet.tsx`, `components/maintenance/{CareConflictDetails,CareEditor,CareTransfer}.tsx`, `screens/{Admin,FillupForm,Home,ImportData,Profile,Settings,Splash,Statistics,Unsynced}.tsx`.
- Colour tokens: `components/TcoBlock.tsx`, `components/insights/SpendingInsights.tsx`, `admin.css`; accent: `lib/accents.ts`, `index.html`.
- Money: `lib/format.ts`, `components/Fmt.tsx`, `lib/fillupSerializer.ts`, `lib/numeric.ts`, `components/Previews.tsx`, `components/TcoBlock.tsx`, `AGENTS.md`; new `lib/monthWithData.ts`.

## Test changes

Unit (all assert the same behaviour; only the v2 symbol order changed):

- `src/lib/format.test.ts` — expectations → `N ₪`; **new** exact code-point test (`777` → `0037 0037 0037 202F 20AA`, `7.35`, `−12`, `+5`) and a "no ASCII space / NBSP / bidi control" check.
- `src/components/DesignPrimitives.test.ts` — money/price/signed expectations; markup assertion now checks DOM order value → U+202F → `₪` with `data-unit-position="trailing"`; added sign-before-number check; NumRun "preserve any authored string" list extended with `777 ₪`, `−12 ₪`, `7.35 ₪` (kept all v2 originals).
- Rewritten `₪N` → `N ₪` in assertions only: `components/RunningCosts.test.ts`, `lib/home/{paidPriceInsight,presentation,priceSpotlight}.test.ts`, `lib/outboxPresentation.test.ts`, `lib/prices/{prices,stationDisplay}.test.ts`, `lib/vehiclePersistence.test.ts`, `screens/Unsynced.test.ts` (incl. the `not.toContain` "no hidden decimals" checks, kept negative).
- **New** `src/lib/monthWithData.test.ts` (9 cases: current month, fallback, skipped empty months, year boundary Dec→Jan, civil-date month edges, future rows, zero/null/NaN amounts, no data → null, Date/epoch inputs).
- **New** `src/lib/designTokens.test.ts` (reads `src/index.css`: accent/plate, radius scale, §4 table in light + both dark blocks, `--shadow-card: none` in dark, accent text/ink-on-accent ratios, icon-on-fill ≥3:1, and the documented list of sub-3:1 fills).

E2E (edited statically, **not run** — the brief reserves the emulator ports for another agent):

| file | change |
|---|---|
| `e2e/admin-mobile.spec.ts` | `₪8.27` → `8.27 ₪` |
| `e2e/design-completion.spec.ts` | money strings |
| `e2e/design-v2-account-restore.spec.ts` | money string |
| `e2e/design-v2-fillup.spec.ts` | `.fillup-saved-number` font-weight `700` → `400` |
| `e2e/design-v2-foundation.spec.ts` | plate accent light `#ffc915` → `#f3c54b` (palette row, pre-paint `--accent-l`, system-theme accent); `--lp` assertions unchanged (`#ffc915`); font probe `700 Karantina` → `400 Karantina` + `400 IBM Plex Mono`; atmosphere glow table .55/.4/.75/.35 → .3/.22/.4/.2 (.16/.1 unchanged) |
| `e2e/design-v2-home.spec.ts` | money strings; "no zero tiles" regex `/₪0\b/` → `/(?<![\d,.])0\s₪/` |
| `e2e/design-v2-insights.spec.ts` | money strings and table rows; price-axis tick: label regex → `^[\d,]+\.\d{2} ₪$`, geometry `left` → `right` (symbol trails digits); display weight `700` → `400` |
| `e2e/design-v2-journal-writes.spec.ts` | money strings |
| `e2e/design-v2-journal.spec.ts` | money strings; care heading weight `700` → `400` |
| `e2e/design-v2-shell.spec.ts` | FAB `border-radius` `22px` → `20px` |
| `e2e/design-v2-vehicle-writes.spec.ts` | money strings |
| `e2e/design-v2-vehicle.spec.ts` | money string; document field border: was "equals ink text colour", now "equals `--line` and 1px" |
| `e2e/helpers/tco.ts` | money strings (incl. `בד״כ 360 ₪`) |
| `e2e/home-cost-insights.spec.ts` | `שילמת כ-20 ₪ פחות…` |
| `e2e/home-profile-update.spec.ts` | prices |
| `e2e/input-live-update.spec.ts` | TCO values |
| `e2e/mobile-fuel-release.spec.ts` | `getByText`/`hasText` money |
| `e2e/official-price-notices.spec.ts` | prices / deltas |
| `e2e/open-design.spec.ts` | running total |
| `e2e/pricing.spec.ts` | ceiling regexes `עד ₪7\.31` → `עד 7\.31\s₪` (both the positive and the `toHaveCount(0)` check) |
| `e2e/rtl.spec.ts` | money island now `^[\d,]+(\.\d+)? ₪$` and geometry "symbol right of digits"; signed delta `^[+−]\d…₪$`; two test titles reworded |
| `e2e/scan-maintenance.spec.ts` | `0 ₪` |
| `e2e/statistics.spec.ts` | KPI regex `^₪[\d,]+$` → `^[\d,]+\s₪$` |
| `e2e/unified-vehicle.spec.ts` | money strings (refunds `+10 ₪`, totals) |

Playwright normalises whitespace in `toHaveText`/`toContainText`/`getByText`
on both sides, so ` ` in expectations matches the rendered NNBSP. Raw
`innerText` checks (rtl.spec) use ` `/`\s` explicitly.

## Gates

| gate | result |
|---|---|
| `npx tsc -b` | pass (0 errors) |
| `npm run lint` | pass, **0 errors** (18 warnings, all pre-existing in untouched `DataContext.tsx`/`ToastContext.tsx` etc.) |
| `npm test` | **99 files, 1373 passed, 12 skipped, 0 failed** (baseline before Stage 1: 97 files, 1358 passed, 12 skipped) |
| `npx vite build` | pass; PWA precache 77 entries (fonts included via the woff2 glob) |
| Playwright e2e | **not run** (by instruction; ports owned by another agent). E2E edits above are unverified. |
| Visual check vs prototype | **not done** in this stage (no browser run). Needed in the stage smoke cycle. |

Built CSS check: `--shadow-card` resolves to the unlayered `:root` value (the
Tailwind `@layer theme` self-reference is overridden, as in v2); `.rounded-md`
→ `var(--r-md)`.

## Not done / handed on

- Not wired: `latestMonthWithData` into Home's "דלק ב<month>" (Stage 2).
- TCO legend still shows the first four parts in v2 order. §2 "sorted, all parts" is a Home change (Stage 2).
- The font binaries were not glyph-inspected (no fontTools offline). They are unmodified Google Fonts `wOF2` files, their SHA-256 is recorded in the manifest, and their unicode ranges match the 700 faces (U+202F is inside the Latin `U+2000-206F` range).
- PWA `theme_color` (`vite.config.ts`) is still `#FFC915`, the brand plate colour. Left alone.
