# Stage 1 · Token-level differences vs the prototype

The reference is `design/v3/proto/lite.css` (the final cascade, so later rules win) plus `prototype.html` and DESIGN-V3 §1/§4/§5. The production values were read from `src/*.css` and from the computed styles in `qa/computed-*.json`.

Verdicts: **=** matches · **J** different but justified · **D** defect · **S2/S3** belongs to a later stage (not Stage 1 scope).

## Tone (§1)

| token | prototype | production (Stage 1) | verdict |
|---|---|---|---|
| Display weight | Karantina 400 | Karantina 400, a real bundled face (both 400 faces `loaded`, 700 never requested) | = |
| Body / numbers | Plex Sans Hebrew; Plex Mono 500/600 (the prototype only loads 500/600, so mono 400 falls back to 500 there) | Plex Mono 400 also bundled for facts values | J (production is closer to §3 "Mono 22/400") |
| `--r-lg/md/sm` | 20/14/10 | 20/14/10 | = |
| Card/sheet radius | `--r-lg` | `--r-lg` | = |
| Button/input/chip/segment radius | `--r-md` | `--r-md` | = |
| Badge / row icon radius | `--r-sm` | `--r-sm` | = |
| Tab icon pill radius | `--r-sm` (10px) | `--r-md` (14px) | D (minor). `shell-design.css .tm-tab-icon-pill` should be `--r-sm` per lite.css `.tab .ico`. Owner: Stage 1. |
| Licence plate radius | 12px/4px (unchanged) | 12px (`.tm-plate-xl`) | J (drawing of a physical object) |
| Micro radii (ticks, bars, focus) | 3–6px | ≤6px kept | J (lite.css keeps `ticks i` at 3px) |
| Card border | 1px `--ln` | 1px `--line` | = |
| Card shadow light | `0 1px 0 rgba(21,19,15,.04), 0 8px 24px -18px rgba(21,19,15,.25)` | identical (`--shadow-card`) | = |
| Card shadow dark | none | none | = |
| Inputs border | 1px `--ln` (`.inp`) | 1px `--line` | = to prototype, but **D against WCAG 1.4.11**: 1.24–1.48:1 vs page, 1.33:1 vs fill (see QA.md). Inputs need a ≥3:1 boundary such as `--ink-3`. Owner: Stage 1 + design. |
| Primary button | 1.5px ink, `0 2px 0 rgba(17,17,17,.55)`, 600, min-height 54 | same, min-height 56 | J (avoids layout churn; 56 ≥ 44 target) |
| `.btn.line` | `--ln` border on `--sf` | `.tm-button-line` `--line` | = |
| FAB | square, 2px ink, `0 3px 0 #111`, press 3px | same, radius `--r-lg` | = |
| Tab bar surface | `color-mix(--bg 88%)`, blur 14px | same (computed `/ .88`, `blur(14px)`) | = |
| Tab bar top rule | 1px `--ln` | 1px `--line` | = |
| Active tab | pill `color-mix(plate 38%)`, ink icon, no ring | `color-mix(accent 38%)`, ink, no ring | = (uses the user's accent, not the plate: J, the accent is user-selectable) |
| Light accent | `#F3C54B` (core.js default) | `#F3C54B` (`--accent`, pre-paint, `accents.ts`) | = |
| Plate colour | `#FFC915` / `#E6B417` | `--lp` `#FFC915` / `#EFBE1A` (v2) | J (spec: "the plate itself is unchanged") |
| PWA `theme_color` | — | `#FFC915` | J (brand plate colour; noted by the implementer) |
| Dial opacity | `--do .04`, `top:-170px` (final rule) | light .04, **dark .06**, `top:-170px` | J (dark ×1.5, as the prototype's own `.ph.dark` dial rule does; documented) |
| Glow `--go` | .3 everywhere | .30 home; journal/insights .22, vehicle .40, entry .20, account .16, legal .10 | J (per-variant scaling keeps the v2 relative mood; the prototype's single .3 would *raise* account/legal) |
| Wash height | 200px | 200px | = |
| Ink kept | primary, FAB, plate, odometer, pump readout, selected segment | same plus admin pressed tabs, switch track, consent checkbox, editable gauge ticks, wizard fuel `:checked`, tank habit marker | J (pressed/selected states and instruments, per §1) |

## Category colours (§4)

| id | prototype light / dark | production light / dark | verdict |
|---|---|---|---|
| fuel | plate / plate | `--accent` / `--accent` | J (§4 says `--accent`; the prototype's accent equals the plate) |
| service | `#15130F` / `#D9D2C3` | same | = |
| ins1 | `#2E5C8A` / `#6E9ED4` | same | = |
| ins2 | `#86ACCF` / `#A9C6E4` | same | = |
| test | `#8C6A3F` / `#B99263` | same | = |
| other | `#B9B2A4` / `#6F685D` | same | = |
| Icon-on-tile colours | not specified | `--cat-*-on`, all ≥4.9:1 | J (addition, improves contrast) |
| Sub-3:1 fills / adjacent pairs | same palette | same; 3px gaps, 1px inset ring, labels always printed | J (spec palette; documented in CONTRAST.md, flagged for design) |
| Legend sorted by value, all parts | yes | v2 order, first 4 | S2 (Home §2) |

## Money and units (§5)

| rule | prototype | production | verdict |
|---|---|---|---|
| `fmt.money` | `777 ₪` (U+202F) | `shekel()` → `777 ₪` (U+202F); exact code points unit-tested | = |
| Per-litre price | `7.35 ₪` | `price()` → `7.35 ₪` | = |
| Signed | `−12 ₪` | `shekelSigned()` → `−12 ₪` / `+5 ₪` | = |
| Visual order inside LTR island | symbol right of digits | symbol right of digits (`order: 2`), `.8em`, same line (measured) | = |
| `innerText` of an island | n/a (prototype uses plain text) | contains line breaks between the inline-flex items (`175 \n₪`); `textContent` is exact | J (inherited from the v2 inline-flex markup; copy/paste of a single figure includes breaks. Low priority; consider `display:inline` + `unicode-bidi` instead of flex `order`) |
| "לק״מ" | yes | yes (TcoBlock) | = |
| Previous month with data | "דלק באוק׳" | helper `latestMonthWithData` exists, not wired | S2 |

## Not in Stage 1 scope (visible in the "after" set, expected later)

- Home: the "next refuel" ink slab (prototype has a light card), the 64/56/44 hierarchy, the facts strip instead of the KPI tiles, the status line, the accent avatar ring, the quieter chart and the "recently" rows. These are **S2**.
- Facts strip on Insights/Vehicle/Account (the prototype account shows the identity/activity strips). **S3**.
- Journal summary header, chip fade mask and period chip. **S4**.
