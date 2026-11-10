# Stage 2 · Home — QA

Scope: DESIGN-V3 §2 (Home), §3 (facts strip primitive), §4 (category colours on the TCO card),
§5 (previous month with data, shared money formatter). Branch: worktree branch on top of
`feat/design-v3` @ `ee15a14`. Prototype differences: `DIFF.md`. Screenshots: `after/`.

## What changed

| Area | Change | Files |
|---|---|---|
| Facts strip (§3) | New shared primitive `FactsStrip` + `Fact` (typed API below), CSS in the shared `design-primitives.css` (`.facts`), unit-tested | `src/components/FactsStrip.tsx`, `FactsStrip.test.ts`, `src/design-primitives.css` |
| Header (§2.1) | Avatar = Google photo or initial (Karantina) on `--surface`, 2.5px accent ring open at the bottom: SVG circle r=21, `stroke-dasharray="112 132"`, `rotate(117deg)` | `AppHeader.tsx`, `Avatar.tsx` (`surface` prop), `shell-design.css` |
| Status line (§2.2) | `homeStatus()` → low ("הדלק נמוך · כדאי לתדלק היום") / cards present ("תדלוק בעוד N ימים · במיכל כ־X%") / nothing ("הכל תקין · הטסט בתוקף עד <date>") | `src/lib/home/facts.ts`, `Home.tsx` |
| Spotlight (§2.3) | One-line titles (CSS clamp + shorter copy for documents "הטסט בעוד 22 ימים" and date reminders "<plan> בעוד N ימים" / "<plan>: המועד עבר"); new planned-trip item "כדאי לתדלק לפני הנסיעה" from the existing `tripPullsForward` + next upcoming plan, opens the tank sheet; density pass on Home | `spotlight.ts`, `groupedReminders.ts`, `documentNotifications.ts`, `useSpotlight.ts`, `home-design.css` |
| Facts (§2.4) | Replaces the trio: נוסע ביום · דלק ב<month with data> · בנזין 95 היום; EV: נוסע ביום · חשמל ב<month> · חשמל ל-100 ק״מ (`isEv`) | `Home.tsx`, `HomeFuelPrice.tsx`, `lib/home/facts.ts` (`fuelMonthFact` uses `latestMonthWithData`, `energyPer100Km`) |
| TCO card (§2.5, §4) | 64px; "בחודש ⇅" chip toggles number, legend and sub-line; all non-zero parts sorted by value (`tcoLegendParts`); `--cat-*`; card is a container with a stretched sheet button + separate chip; sheet opens on the card's period | `TcoBlock.tsx`, `lib/tco.ts`, `tco-design.css`, `icons.tsx` (`SwapIcon`) |
| Consumption (§2.6) | 56px; ⓘ beside the label; comparison as coloured text (no `Pill`); Home chart variant: shorter, values above every point, dates only at both ends, no legend, caption "6 תדלוקים אחרונים" / "הרגיל שלך 12.4" | `Home.tsx`, `ConsumptionComparison.tsx`, `ConsumptionSparkline.tsx` (`variant="home"`), `consumptionSparklineModel.ts` (`HOME_FRAME`), CSS |
| Next refuel (§2.7) | Light card (no ink slab), 44px headline, no accent highlight on the number; gauge: filled = fuel now, darker "to-habit" ticks, labelled habit line, caption between E/F "במיכל כ־N% · כ־N ק״מ עד לרזרבה"; footer basis + "עדכון ›" | `TankHero.tsx`, `DesignPrimitives.tsx` (`Gauge` `habitLabel`/`showUse`/`caption`, defaults unchanged for the sheet gauges), `tank-design.css` |
| Recent (§2.8) | Two rows + "היומן המלא ›" | `Home.tsx` |
| Order (§2) | status → spotlight → facts → TCO → consumption → next refuel → recent | `Home.tsx` |
| AGENTS.md | No local currency formatting left on Home: per-km uses `price()`, facts values `shekel()`/`price()`/`int()`; the old `₪${num(…,2)}` (checklist note) had been replaced in Stage 1 and the new TCO sub-line keeps `price()` | — |

### FactsStrip API

```ts
interface FactProps {
  label: ReactNode;            // 15/500
  sub?: ReactNode;             // 12, --ink-2
  value: string | null;        // pre-formatted by lib/format (shekel/price/int); null → "—", never 0
  unit?: ReactNode;            // 12px, hidden when value is null
  onClick?: () => void;        // makes the row a <button> (≥44px, focus ring)
  ariaLabel?: string;          // Hebrew name for a button row (default: visible text)
  hasPopup?: "dialog";
  testId?: string;
  muted?: boolean;
}
<FactsStrip rows={[{ id, ...FactProps }]} label="…" testId="…">{/* extra <Fact/> rows */}</FactsStrip>
```

Markup: `.facts > (button|div).fact > .fl(.fl-text + small) + i.ld + .fv(.n + u)`. Value font
IBM Plex Mono 22/400, unit 12px, rows 58px min, dashed separators, 1px top/bottom rules.

## Checklist (`stage-0/checklists/home.md`, 54 items)

K = kept, C = changed intentionally (v3), with how it was verified. "e2e v3" = `e2e/design-v3-home.spec.ts`.

| # | Behaviour | Status | Verified by |
|---|---|---|---|
| 1 | hidden h1 "מצב הרכב", `home-page` | K | unchanged markup; all Home e2e locate `home-page` |
| 2 | body keyed by uid/vehicle | K | design-v2-home "journal delete confirmation closes on external vehicle switch" |
| 3 | screen order | C → §2 order | e2e v3 (DOM order assertion) |
| 4 | no active vehicle section | K | unchanged code path |
| 5 | loading skeleton | K | unchanged; status line hidden while loading |
| 6 | history-incomplete status, no false empty state | K | design-v2-home "malformed-only and denied history…" |
| 7 | first-fill-up block + gauge action | K | design-v2-home "new and partial-only…", tank.spec |
| 8 | empty vehicle never shows 0 ₪; km/day and month show "—" | K | design-v2-home, tank.spec, unified-vehicle (not run, see below); facts `value=null` → "—" (FactsStrip unit test) |
| 9 | carousel region / slide semantics | K | design-v2-home spotlight tests |
| 10 | 7 s auto-advance, reduced motion, interaction stop | K | design-v2-home "spotlight auto-advances…" |
| 11 | dots only with >1 item | K | same |
| 12 | dismiss label + focus after dismiss | K | design-v2-home "spotlight priority…"; trip item dismiss in e2e v3 |
| 13 | dismissal storage per account/vehicle, cross-tab | K | design-v2-home (survives reload), presentation.test; e2e v3 trip dismissal survives reload |
| 14 | ≤4 items, sticky kept | K | presentation.test |
| 15 | priority order | C: planned-trip item inserted after reminders, before paid-price | presentation.test "places the v3 planned-trip card…" |
| 16 | rejected write item | K | design-v2-home "server-rejected write…" |
| 17 | mileage reminder | K | presentation.test |
| 18 | date reminders | C: title "<plan> בעוד N ימים" / "<plan>: המועד עבר" (was "<plan> · …"); body, tone, sticky unchanged | groupedReminders.test, presentation.test "…titles read on one line", home-cost-insights |
| 19 | grouped calendar card | K | groupedReminders.test, home-cost-insights |
| 20 | document titles | C: spotlight title "הטסט בעוד 22 ימים" (notification list keeps "טסט שנתי · …") | presentation.test, documentNotifications.test |
| 21 | paid-price insight | K (title clamped to one line visually; accessible name full) | paidPriceInsight.test, home-cost-insights |
| 22 | sustained consumption | K | sustainedConsumption.test, home-cost-insights |
| 23 | personal best | K | presentation.test |
| 24 | official 95 price items | K | priceSpotlight.test, official-price-notices |
| 25 | previous-month summary (days 1–7) | K | presentation.test, design-v2-home "monthly spotlight…" |
| 26 | target dispatch segment/price/route | K + new `tank` target (trip item → tank sheet) | home-cost-insights; e2e v3 trip test opens `tank-sheet` |
| 27 | TankHero shown when estimate available | K | tank.spec |
| 28 | label "התדלוק הבא" / "הדלק עומד להיגמר" | K | design-v2-home gallery states ("low") |
| 29 | headline from passage, unknown → "כמה דלק יש עכשיו?" | K (44px; small/uncertain 36px) | design-v2-home ("unknown" state), e2e v3 (44px) |
| 30 | 20-tick gauge, habit marker, low style, caption | C: light card, labelled habit line, darker to-habit ticks, caption "במיכל כ־N% · כ־N ק״מ עד לרזרבה" between E/F; `current-tank-level` keeps exactly "כ־N%" | tank-pricing-followup (exact level text), e2e v3 (caption, ticks, light background) |
| 31 | habit note | C: visually replaced by the habit-line label when drawn; stays in the accessible description; visible otherwise | design-v2-home `toHaveAccessibleDescription` checks; DIFF #5 |
| 32 | footer basis + "עדכון ›" | K | design-v2-home ("הערכה מהטנק המלא האחרון" description), e2e v3 |
| 33 | tap opens tank sheet summary/gauge | K | design-v2-home gallery test, tank.spec |
| 34 | consumption shown with ≥1 fill-up; label | K | design-v2-home, mobile-regressions |
| 35 | ⓘ "פרטי מדידת הצריכה" → measurement sheet | K (now beside the label, 28px circle in a 44px target) | e2e v3 (position, size, opens `consumption-details-sheet`) |
| 36 | reading button → SegmentSheet | K (56px) | design-v2-home sparkline test |
| 37 | comparison wording and tone | C: coloured text, no Pill | design-v2-home ("18%", "יותר דלק לק״מ"), e2e v3 (no `.tm-pill`, transparent background) |
| 38 | sparkline | C: Home variant — values on every point, dates only at both ends, no legend, split caption; last-6 rule, band, island path, point buttons and `<title>` unchanged | design-v2-home sparkline test (caption text updated), ConsumptionSparkline.test (new Home-variant case), e2e v3 |
| 39 | open-segment empty states | K | design-v2-home, consumption.spec |
| 40 | unknown partial cost never completes a total | K | design-v2-home "a missing partial cost…", facts.test (unknown cost in the shown month → no sum) |
| 41 | TCO hidden without vehicle / fill-ups | K | tco.spec |
| 42 | TCO labels and missing badge | K | tco.spec "a missing insurance cost…" |
| 43 | number + sub-line | C: "בחודש ⇅" chip flips month/year (number, legend, sub-line "כ־X בשנה/בחודש · Y ₪ לק״מ") | e2e v3 (flip values, accessible names, 44px chip) |
| 44 | stacked bar | C: §4 colours (Stage 1), sorted by value | tco.spec (6 parts, theme colours), e2e v3 |
| 45 | legend first 4 in engine order | C: every non-zero part, sorted by value | tco.test "v3 TCO legend order", e2e v3 (legend count = bar count, sorted) |
| 46 | card → TCO sheet and its rows | K (stretched button; sheet opens on the card's period; focus returns to the card button) | tco.spec (all flows), cost-community, input-live-update, e2e v3 |
| 47 | dedup fixed invoices, Home = Insights | K | tco.spec, tco.test |
| 48 | "נוסע ביום" | K (facts row; sub "כ־N ק״מ בחודש") | tank.spec/ui-review "—", mobile-fuel-release (not run), e2e v3 |
| 49 | "דלק <month>" | C: previous month with data (§5), full month name; "—" when unknown/incomplete; tap → spend | facts.test, e2e v3 "a month without fill-ups…", design-v2-home "missing partial cost" (unchanged expectations) |
| 50 | fuel price cell | C: facts row, "בנזין 95 היום", regulated captions per prototype; manual/market captions unchanged, 2 decimals | design-v2-home "price sheets stay fuel-specific…", home-profile-update, official-price-notices, e2e v3 |
| 51 | price sheet | K | design-v2-home, official-price-notices, tank-pricing-followup |
| 52 | 98/diesel market price | K | design-v2-home price test |
| 53 | "לאחרונה" rows | C: 2 rows, "היומן המלא ›" → /history | design-v2-home recent test (updated), e2e v3 |
| 54 | row states and deep link | K | design-v2-home recent tests (refund, unknown cost, odometer, delete confirmation) |

## Accessibility

- 44px: facts rows (58px), TCO chip (44px hit area around the pill), ⓘ, account button, sparkline points, spotlight open/dismiss — asserted in e2e v3 / existing specs.
- Focus: facts rows, TCO card button and chip, ⓘ, avatar have `:focus-visible` outlines.
- Hebrew labels: "כמה הרכב עולה לך", chip "בחודש, החלפה לתצוגה בשנה", "פרטי מדידת הצריכה", "חשבון", facts group "הרכב במספרים".
- Reduced motion: no new animation; facts row `:active` opacity disabled under reduced motion; spotlight unchanged.
- Contrast: e2e v3 walks every visible text node on Home and requires ≥ 4.5:1 against its opaque background, light and dark — passes. Tokens used: `--ink`, `--ink-2` (≥ 6:1 on bg/surface both themes), `--worse`/`--better` text (≥ 5.3:1).

## Test changes

| File | Change | Behaviour kept |
|---|---|---|
| `e2e/design-v2-home.spec.ts` | recent rows 3 → 2; the unknown-cost service row is brought into Home's two rows by moving the two newest records back, then the seed is restored | every row assertion (refund +11 ₪, "—", odometer without ₪, 44px, Home = Journal text, deep link) |
| `e2e/design-v2-home.spec.ts` | figcaption "הטווח הרגיל שלך, סביב 12.4/8.1" → "הרגיל שלך 12.4/8.1" | the average in both units |
| `e2e/design-v2-home.spec.ts` (v2 gallery states) | recent-mixed state: Home has 2 rows; the service row is still checked in the Journal right after | Journal "—" for the unknown service cost |
| `e2e/consumption.spec.ts` (4), `e2e/mobile-regressions.spec.ts`, `e2e/rtl.spec.ts` | caption "הטווח הרגיל שלך, סביב X" → "הרגיל שלך X" | the average value shown |
| `e2e/unified-vehicle.spec.ts` | refund row "+10 ₪"/"+20 ₪" asserted in the Journal instead of Home (it is the 3rd-newest row) | refund sign and amount |
| `e2e/helpers/tco.ts` | focus return: the card container → its "כמה הרכב עולה לך" button | focus returns to the trigger |
| `e2e/design-v3-gallery.spec.ts` | optional `V3_GALLERY_SCREENS` filter | — |
| new `e2e/design-v3-home.spec.ts` | order, size hierarchy (computed 64/56/44, everything else < 44), facts, avatar ring, TCO toggle/legend, chart, light card, recent, contrast light+dark, previous month, planned trip, EV facts | — |
| new/extended unit | `FactsStrip.test.ts`, `lib/home/facts.test.ts`, `presentation.test.ts` (+2), `tco.test.ts` (+1), `ConsumptionSparkline.test.ts` (+1) | — |

## Gates and runs

| Gate | Result |
|---|---|
| `npx tsc -b` | pass |
| `npm run lint` | 0 errors (20 warnings, all in files this stage did not touch) |
| `npm test` | 110 files, 1493 passed, 12 skipped (baseline after Stage 1: 99 files / 1373) |

Playwright, private rig (emulators 8090/9100, hub 4410, logging 4510, ws 9160, vite 5290; untracked
`playwright.stage2-private.config.ts` + `firebase.stage2-private.json`, chromium only):

| Run | Result |
|---|---|
| `design-v3-home`, `design-v2-home`, `home-cost-insights`, `tco`, `consumption`, `mobile-regressions` (final run after fixes) | **40 / 40 passed** |
| `cost-community`, `official-price-notices`, `tank`, `input-live-update`, `tank-pricing-followup`, `home-profile-update` (first batch) | all passed |
| `design-v2-shell` (header: 3 buttons, account route, FAB) | passed |
| `unified-vehicle` "known monthly running costs…" (after moving its refund-row checks to the Journal) | passed |
| `rtl` "signed numbers, money and units read correctly" | **fails, not caused by Stage 2's logic**: its `islandText` reads `innerText` of the first `₪` island; Stage 1's trailing-symbol markup (`.tm-symbol-number` inline-flex, items ordered by CSS) makes Chromium's `innerText` return `"7.77\n \n₪"`. The trio's money island had the same markup, and Stage 1 did not run e2e. Reported to QA/Stage 1 owner; the test's caption expectation was updated for v3. |
| Gallery `V3_GALLERY=1 V3_GALLERY_OUT=design/v3/evidence/stage-2/after V3_GALLERY_WIDTHS=390 V3_GALLERY_SCREENS=home,home-viewport,sheet-tank,sheet-measurement,sheet-tco,sheet-car-switch` | light + dark passed; `after/console*.json` |

Not run: the remaining suite (QA agent's rig), the PWA project, 430/768 widths.
