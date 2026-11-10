# Stage 2 · Home — differences from the prototype (390×844, light and dark)

Compared: `after/home-390-{light,dark}.png`, `after/home-viewport-390-*.png` (gallery spec, production
seed) and scrolled captures of the same seed against `stage-0/prototype/home-390-*.png` plus scrolled
captures of `prototype.html` (Home, vehicle v1). The data differ (different seed), so numbers differ;
this list covers layout, type, colour and copy only. Each item is either justified here or was fixed.

## Kept on purpose (production wins, or the spec and prototype disagree)

| # | Area | Prototype | Production (Stage 2) | Why |
|---|---|---|---|---|
| 1 | Block rhythm | `.pad{gap:26px}` (density pass, last rule) | 26px | DESIGN-V3 §1 says 34px but the prototype's final density pass sets 26px; the reference image is 26px. Picked the reference. One value in `home-design.css` if 34px is wanted. |
| 2 | Status line | "תדלוק בעוד 5 ימים · במיכל כ-67%" | same wording from the tank engine's `expectedRefuel` + displayed level; "כ־" with maqaf | Production copy uses the maqaf everywhere (`TankLevel`, captions). No dated forecast (unknown/beyond horizon) → only "במיכל כ־N%". |
| 3 | Gauge caption km | "כ-364 ק״מ" (range to empty) | "כ־N ק״מ עד לרזרבה" | The engine exposes only range-to-reserve (`rangeToReserveKm`). Showing it without "עד לרזרבה" would mislabel the figure; production logic is authoritative. |
| 4 | Habit line label | always "כאן בד״כ מתדלקים" | "כאן בד״כ מתדלקים" (learned) / "כאן לפי ההעדפה שלך" (manual target override) | An override is not a habit; the label must not claim one. |
| 5 | Habit sentence | `.next p` hidden | hidden visually when the labelled habit line is drawn (kept as `sr-only` in the card description); visible when there is no line ("אחרי עוד כמה תדלוקים נלמד…", "הקישו כדי לסמן…") | Checklist item 31 keeps the information; the line label replaces it only when it says the same thing. |
| 6 | "To-habit" ticks | `color-mix(plate 55%, --tx)` | `color-mix(accent 55%, --ink)` | Same rule. In dark mode `--ink` is light, so the ticks read paler rather than darker — this matches the prototype's dark rendering. |
| 7 | Unknown-level headline | 40px | 36px ("small" headline) | Keeps the 64 > 56 > 44 > rest rule strict (the e2e asserts every other text < 44px). |
| 8 | Facts month label | "דלק באוקטובר" (full month) | full month name ("דלק בנובמבר") | §5's example uses the short form; the prototype uses the full name and has room. |
| 9 | Price fact captions | "המחיר המרבי בתחנות" / "…, לפני ההנחה שלך" | same for regulated 95; manual / market / stale / last-saved captions kept from production ("הוזן ידנית", "מחירון הרשת", "מחירון אחרון", "מחיר אחרון", "מחיר שנשמר", "לא ידוע") | Checklist items 50/52; 98/diesel/other must never say "מחיר מרבי" (e2e). |
| 10 | EV "חשמל ל-100 ק״מ" sub-line | "65% מהטעינות בבית" | "לפי העלות והנסיעות שלך" | Production has no charge-location data (no EV charge mode yet, Stage 0 §6 #7). Value = monthly energy part of TCO ÷ monthly km × 100, whole shekels. |
| 11 | TCO card structure | one `<button>` with a nested `role=button` chip | a card container with one stretched "כמה הרכב עולה לך" button and a separate period chip button | No interactive element inside another (a11y). The chip is a 44px target at the far end of the number row (prototype: right after the number) so a tap on the card body — and every existing `tco-card.click()` — opens the sheet, never the toggle. The sheet opens on the period chosen on the card. |
| 12 | TCO sub-line per-km | `t.perKm.toFixed(2)` | `price(perKm)` → "0.95 ₪ לק״מ" | AGENTS.md: shared formatter only. |
| 13 | Consumption chart | home height 118 | 124 (shared model, `HOME_FRAME`) | Leaves room for value labels above the top point with the production label sizes. |
| 14 | Chart caption colour | `--tx3` | `--ink-2` | `--ink-3` is 4.06:1 on the dark surface and ≈4.5:1 on the dark background; ink-2 keeps ≥4.5:1 everywhere. |
| 15 | Recent rows | prototype `EntryRow` | production `JournalEntryRow` (station logo, states, refunds, odometer rows) | Checklist item 54 (row states) and Journal parity. |
| 16 | Avatar | single initial | Google photo when available, else `initials()` (1–2 letters) in Karantina on `--surface` | Checklist shell #20 (photo with fallback). Ring is exactly the prototype's (r=21, 2.5px, 112/132, 117°). |
| 17 | Empty states | prototype copy | production copy | Checklist items 4–7, 39. |
| 18 | Spotlight item set | prototype's synthetic items | production derivations (priority, cap, sticky, dismissal) + the new planned-trip item | Checklist items 9–26. |

## Fixed during the comparison

- Facts label "בנזין 95 היום" broke into three lines (the `.fl` grid made each bidi run a grid item) → label now sits in `.fl-text`.
- Dashed row separators were cancelled by the row reset (`.facts > .fact { border: 0 }`) → explicit `.fact + .fact` rule.
- Status line sat on the header → 4px top margin (prototype gap).
- ⓘ had no circle → 28px hairline circle inside the 44px target.
- "עדכון ›" was bold ink → `--ink-2`, regular, like the prototype footer.
- Spotlight density pass applied on Home (see QA.md).

## Not in production, not added

- Prototype Home trio icons (lite.css "small icon over each label") — superseded by the facts strip in v3.1 of the prototype itself.
