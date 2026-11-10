# טנק מלא · Design v3 — delta spec on top of DESIGN-V2.md

`../v2/DESIGN-V2.md` remains the base (identity, typography, number/money/RTL rules, terminology, IA). This document lists only what v3 **changes or adds**. Where the two disagree, v3 wins. The runnable reference is `prototype.html` in this folder; `proto/lite.css` is the exact CSS delta over the v2 prototype and can be read as the token sheet.

## 1. "Airy" tone (applies everywhere)

- Display weight: Karantina **400** everywhere (was 700). Body stays IBM Plex Sans Hebrew 400/500/600; numbers IBM Plex Mono.
- Borders are hairlines: 1px `--line` on cards and rows; the 1.5–2px ink rules of v2 are reserved for pressed/selected states and instruments (pump display, odometer, FAB).
- Radius scale: `--r-lg: 20px` (cards, sheets), `--r-md: 14px` (buttons, inputs, chips), `--r-sm: 10px` (badges). No other radii.
- Shadows: `0 1px 0 rgba(21,19,15,.04), 0 8px 24px -18px rgba(21,19,15,.25)` on cards; none in dark.
- Light accent default `#F3C54B` (softer than the plate's `#FFC915`); the plate itself is unchanged.
- Vertical rhythm on Home: 34px between blocks; a block = label (13px, `--ink-2`) → number → one support line.
- Tab bar: translucent surface, pill tint for the active tab; FAB stays the square "תדלקתי" / "טענתי" block (the only ink block on Home).
- Background atmosphere (`Bgfx`): wash + radial glow + gauge dial at `--do: .04`, dial raised to `top: -170px` so it reads as texture, not an object.

## 2. Home (final order and components)

1. **Header**: car switcher (mini plate + nick), bell, avatar. Avatar = initial on `--surface` with a 2.5px accent ring open at the bottom (SVG circle, dasharray 112/132, rotate 117°).
2. **Status line** (15px, ink): only what the cards below don't say. Low fuel → "הדלק נמוך · כדאי לתדלק היום"; cards present → "תדלוק בעוד N ימים · במיכל כ-X%"; nothing → "הכל תקין · הטסט בתוקף עד <date>".
3. **Spotlight** (unchanged from v2) — titles shortened to one line ("הטסט בעוד 22 ימים"). New items: reminder due by date, "כדאי לתדלק לפני הנסיעה" (planned trip), rejected write.
4. **Facts strip** (replaces the three-column KPI grid, see §3): נוסע ביום · דלק ב<month with data> · בנזין 95 היום. EV: נוסע ביום · חשמל ב<month> · חשמל ל-100 ק״מ.
5. **"הרכב עולה לך"** card — the single hero (64px). Tap on the "בחודש ⇅" chip toggles month/year (number, legend and sub-line flip). Parts sorted by value, **all** parts in the legend, category colours from §4.
6. **Consumption** (56px) + 6-segment line chart: values above every point, dates only at the two ends, no legend; caption split to both ends ("6 תדלוקים אחרונים" / "הרגיל שלך 12.0"). ⓘ next to the label opens the measurement sheet. Comparison is coloured text, no pill background.
7. **"התדלוק הבא"** — a **light card** (no ink slab), 44px headline, no marker highlight under the number. Gauge: filled ticks = fuel now; the ticks between the habit line and the current level are darker ("what you'll burn before you usually refuel"); the habit line carries its own label above it ("כאן בד״כ מתדלקים"). Caption: "במיכל כ-67% · כ-364 ק״מ". Footer: basis + "עדכון ›".
8. **"לאחרונה"**: two rows + "היומן המלא ›".

Size hierarchy is a rule: cost 64 > consumption 56 > next-refuel 44 > everything else.

## 3. Facts strip (new primitive, used app-wide)

Receipt-style list instead of KPI tiles: label (15/500) + one-line sub (12, `--ink-2`) on the right, dotted leader, value on the left in **IBM Plex Mono 22/400** with a 12px unit. Rows separated by 1px dashed `--line`; the strip has 1px top/bottom rules. Rows may be buttons. Used on Home, Insights (best/worst/km/litres; spending averages; community), Vehicle ("כמה עלה"), Account (identity, activity), the year screen, the business statement, measurement details. Markup: `.facts > button|div > .fl(+small) + .ld + .fv(.n + u)`.

## 4. Cost categories — one hue each (light / dark)

| id | light | dark |
|---|---|---|
| fuel / electric | `--accent` | `--accent` |
| service | `#15130F` | `#D9D2C3` |
| ins1 (mandatory) | `#2E5C8A` | `#6E9ED4` |
| ins2 (comprehensive / third party) | `#86ACCF` | `#A9C6E4` |
| test / licence | `#8C6A3F` | `#B99263` |
| other | `#B9B2A4` | `#6F685D` |

Never three greys in one bar. Legend sorted by value, shows every non-zero part.

## 5. Money and units (amends v2 §4)

- `fmt.money`: number then narrow no-break space then ₪ (`777 ₪`), whole shekels. Prices per litre/kWh keep 2 decimals (`7.35 ₪`). The symbol therefore reads after the number in Hebrew order; inside `.n` LTR islands the same string is used.
- "לק״מ", never "לכל ק״מ".
- A month with no purchases yet shows the previous month that has data ("דלק באוק׳"), never `0 ₪`.

## 6. Parity with the live app (everything below already exists in production and must keep working under the new design)

Fill-up: fuel type per vehicle (95 regulated; 98/diesel: manual pump price, last-paid default), tank state before **and after** (partial), capacity check ("נראה שנפח המיכל גדול מההערכה" → confirm sheet), reasons (כרגיל/כמעט נגמר/לפני נסיעה/מחיר טוב/לא בטוח), missed-fills flag, receipt import (PDF/text; credit-note refusal; mandatory checkbox), draft restore ("הטיוטה שלכם שוחזרה"), station sheet (בקרבתי / תחנות שתדלקתי בהן / search, air-line distance, personal last price, locating/denied states), post-save pump-price confirmation with scope (this fill / station adjustment), 5-second undo.
Tank sheet: observation ticks, planned trips (today/tomorrow/3 days/week/date; km; extra vs instead; margin), preferences (reserve 10–25%, target learned vs manual, reset habit profile), "על מה מבוססת ההערכה", capacity confirm. Measurement sheet (fills, full, segments, km, pending litres, open segment, restarts).
Journal: period (all/month/year/3/6/12, year from vehicle screen), filters incl. issues and odo/gauge, search, filtered summary with "על אילו נתונים מבוסס" and unknown-cost count, 25-row pagination, unsynced banner, row states (ממתין לאישור / דורש בדיקה / כדאי לבדוק / אחרי תדלוקים שלא נרשמו / החזר / לא בעלות הרכב).
Insights: period incl. "מהרשומה הראשונה"; consumption table, restarts, open segment, manufacturer reference; price extremes, litres with known cost, non-regulated note; spending averages (monthly/weekly/YTD), three per-km figures, by-month table, refunds net, excluded expenses; community with real grouping (same model+fuel ≥4 else same fuel), distribution, price comparison, min 2 segments, what-is-shared.
Vehicle: "כמה עלה" by period, by-year rows → year screen, reminders (basis completion/fixed/manual, km/months intervals, source, log-service, .ics export, snooze, pause, linked services), paused group, issues (symptoms, discovered day, odo, importance, status open/watching/resolved, history ≤10, linked services), resolved group, declared consumption, tank confirmed/estimate, care backup/export/import, business statement.
Service/expense form: garage, "ריק אם לא ידוע · 0 אם לא שילמתם", refund, odometer validation (lower → error; jump > 1,500 → confirm), "לקבוע גם את הטיפול הבא", log-from-reminder.
Account: identity (provider, since, last login, role), activity across all vehicles, 98/diesel price readings, notification toggles (master + per kind), fuel sharing and **separate** cost sharing (default off) with info sheets, export scope, four exports, full backup, restore preview, unsynced, install PWA, share link, sign-out warning, two-step delete with local-data checkbox, version/build. Notifications (new/read/snoozed/archive; snooze tomorrow/week/month; price explanation; CTA). Unsynced (device → sent → confirmed; error; retry; drop; export; offline demo). Import (fills / tank updates; multi-vehicle source pick; warnings; partial; undo with server confirm). Update banner. Wizard manual path with make/model/year catalogue; EV plate lookup returns battery kWh, WLTP range and motor kW instead of engine cc.

## 7. New features (not in production yet)

1. **"לכלול בעלות הרכב"** on every expense: toggle, default on, ⓘ opens an explainer sheet. Off ⇒ `excluded: true`: the expense stays in the journal and its totals (tagged "לא בעלות הרכב"), but is left out of TCO, per-km, monthly/yearly averages, the spending chart, and any shared summary. CSV column `excluded_from_tco`.
2. **Business monthly statement** (Account → הנתונים שלי; Vehicle → דוח חודשי לעסק): pick a month; rows grouped by category (fuel/electric, service, each expense kind, "לא בעלות הרכב" separate and outside the total); km recorded in the month; total; optional business name, driver, business-use % (stored on the vehicle as `biz`); exports: print-ready HTML → PDF (title, meta tiles, tables, signature lines, disclaimer) and CSV (UTF-8 BOM, Hebrew headers).
3. **Onboarding** reframed as car-cost management: 4 slides (TCO card with categories → one record in 15 s for fill/charge/service/expense → real consumption and per-km → nothing falls through: test, insurance, service, issues, refuel forecast). Sign-in headline: "כל מה שהרכב עולה. במקום אחד."
4. **EV from the plate**: the registry lookup maps `powertrain: ev`, `battery.kwh`, `battery.wltp`, `motorKw`; the confirm step shows them with a one-line explanation; vehicle "refresh" pulls them too; no tank/engine fields for EVs anywhere.

## 8. OCR (pump + odometer scan) — direction, not UI

Keep the two-photo flow. Change the pipeline: viewfinder crop → greyscale, adaptive threshold, deskew → 7-segment-aware recogniser (ML Kit v2 / Vision, or a small 7-seg model) → **candidate selection by constraints** (total ≈ litres × price; odo > last reading and < last + 3,000; price 5–12; litres ≤ tank) over the top-3 per field → verification screen showing the crop beside the digits with the least-confident digit highlighted → keep user corrections on device as a training set → optional cloud fallback (crop only, structured prompt) when confidence is low.
