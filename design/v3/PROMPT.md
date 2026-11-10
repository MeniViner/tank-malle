# Tank Malle — Design v3 implementation brief (standalone)

You are implementing **Design v3** of "טנק מלא" (Tank Malle), a Hebrew RTL PWA for tracking everything a car costs (fuel/electricity, service, insurance, test, expenses), built with React + Vite + TypeScript, Firebase (Firestore, Auth), an offline outbox, and a stats engine in `src/lib`. Repository: https://github.com/MeniViner/tank-malle. Work on a branch `feat/design-v3` cut from `main`.

Design v2 ("לוחית") is already implemented and deployed from `design/v2/` (read `design/v2/DESIGN-V2.md`, `HANDOFF.md`, `PROGRESS.md` first — they describe what exists, the accepted stage gates, and the evidence format). **v3 is a refinement and an extension of v2, not a new redesign.** Everything you need is in `design/v3/`:

- `design/v3/DESIGN-V3.md` — the delta spec (tone, Home order, facts strip, category colours, money rule, parity list, four new features, OCR direction). Where it disagrees with v2, v3 wins.
- `design/v3/prototype.html` + `design/v3/proto/*.js` + `design/v3/proto/lite.css` — the clickable reference. Open it at 390×844 with Playwright/Chromium and compare screen by screen. `lite.css` is literally the token/CSS delta over v2. `proto/core.js` shows the derived-data rules (TCO exclusion, trips, reminders' next-due, community grouping); `proto/more.js` shows the sheets and screens that were missing from the earlier prototype. Production logic (`src/lib/stats.ts`, `tank/*`, `prices/*`, outbox, rules) stays authoritative — the prototype shows intent, not code to copy.

## Non-negotiables

1. **Nothing that works today may regress.** Section 6 of DESIGN-V3.md lists every production behaviour the new design must keep (fill-up form details, tank sheet, journal, insights, vehicle, reminders, issues, forms, account, notifications, unsynced, import, wizard). Before touching a screen, enumerate its current behaviours from the source and from `src/**/__tests__`, and keep that list as the acceptance checklist for that screen.
2. **Nothing derived is stored.** Consumption, TCO, forecasts, per-km, community figures are computed from raw records at read time.
3. **Display rules**: whole shekels except per-litre/kWh prices (2 decimals); `fmt.money` = number + narrow NBSP + ₪; numeric LTR islands; Hebrew day-first dates; "לק״מ". Karantina 400 for display text everywhere.
4. Accessibility: 44px targets, visible focus, every control labelled in Hebrew, `prefers-reduced-motion` respected, contrast ≥ 4.5:1 for text in both themes (verify the new category colours and the light accent).
5. Firestore rules, data model and the outbox protocol change only where a new field is introduced (below), with a rules test for each new field.

## Stages (finish each, run the DEV smoke cycle, record evidence under `design/v3/evidence/stage-N/`, then continue)

**Stage 0 — Baseline.** Install, type-check, lint, unit tests, Playwright click-through of DEV in light/dark at 390/430/768 widths. Save screenshots as the "before" set. Write the per-screen behaviour checklists (non-negotiable #1).

**Stage 1 — Tokens and tone.** Implement DESIGN-V3 §1 and §4: weight 400 display, hairlines, radius scale, shadows, light accent `#F3C54B`, category colour tokens with dark variants, `Bgfx` dial opacity/position, translucent tab bar, square FAB kept. Money/unit rule §5 in the shared formatter with tests (including the "previous month with data" rule). No screen logic changes in this stage.

**Stage 2 — Home.** Rebuild Home to DESIGN-V3 §2 exactly: status line rules, spotlight title shortening and new items (reminder by date, trip warning, rejected write), facts strip (§3 primitive — build it once as a shared component), TCO card with month/year toggle and sorted full legend, consumption block with the quieter chart and ⓘ → measurement sheet, light "next refuel" card with labelled habit line and darker "to-habit" ticks, two "recently" rows. Size hierarchy 64/56/44 is a test assertion.

**Stage 3 — Facts strip everywhere + Insights + Vehicle.** Replace KPI grids with the facts strip on Insights (consumption, spending, price, community), Vehicle ("כמה עלה" by period, by-year rows → year screen), Account. Insights parity items from §6 (segments table, restarts, open segment, price extremes, spending averages and per-km trio, by-month table, refunds net, excluded expenses, community grouping and distribution). Vehicle parity (paused reminders, resolved issues, declared consumption, tank confirmed/estimate).

**Stage 4 — Forms and sheets.** Fill-up, tank, station, service/expense, reminder, issue sheets to §6 behaviour under the v3 look (no behaviour removed; the v3 prototype's sheets in `proto/more.js`/`sheets.js` show the layout). Journal: period chip, filtered summary with info sheet, pagination, row states, chip fade mask.

**Stage 5 — New features (§7).**
- 5a `excluded` flag on expenses: form toggle (default on = included), explainer sheet, every aggregate honours it (TCO, per-km, averages, spending chart, shared summary), journal tag, CSV column, Firestore rule + migration note (missing field = included).
- 5b Business monthly statement: month picker, grouping, km in month, totals, `biz` fields on the vehicle (company, driver, usage %), print-ready HTML (→ PDF via the browser) and CSV with BOM; entry points in Account and Vehicle. Unit-test the grouping and totals against fixtures with refunds, unknown costs and excluded expenses.
- 5c Onboarding: four slides and the sign-in headline per §7.3; artwork built from the real components (TCO card, pump display, consumption number, spotlight + next card).
- 5d EV from plate: registry mapping → `powertrain`, `battery.kwh`, `battery.wltp`, `motorKw`; confirm step rows and note; vehicle refresh; make sure no tank/engine field is rendered for EVs (fill form, vehicle edit, insights copy).

**Stage 6 — OCR pipeline (behind a flag).** Follow DESIGN-V3 §8: viewfinder crop, preprocessing, a 7-segment-aware recogniser, constraint-based candidate selection over top-3 per field, verification screen with the crop and the least-confident digit highlighted, on-device correction log. Ship behind `scanV2` with an A/B switch in Account → "כפתור תדלקתי פותח מצלמה". Measure on the existing sample photos (and the correction log) and report the digit-level accuracy before/after. Cloud fallback is optional and off by default.

**Stage 7 — Acceptance.** Full DEV smoke cycle (below), the "after" screenshot set beside "before", diff review against the prototype for every screen, PROGRESS/HANDOFF updated, PR opened against `main` with the evidence folder linked.

## Sub-agents

Use one sub-agent per main task and have each one own its acceptance checklist: (a) tokens/tone + formatter, (b) Home, (c) Insights/Vehicle/Account strips, (d) forms and sheets, (e) new features 5a–5d, (f) OCR, (g) QA — the QA agent never edits product code; it runs the smoke cycle, compares against the prototype and files concrete defects back to the owning agent. Agents work on the same branch in separate, small commits with the Stage number in the message.

## DEV smoke cycle (mandatory after every stage, and loop until green)

1. `npm run typecheck && npm run lint && npm run test` — zero errors; new behaviour has new tests.
2. Build and run DEV. Playwright, Chromium, 390×844 and 430×932, light **and** dark, RTL: Home → fill-up (full, partial with after-level, capacity warning, receipt import sample, draft restore) → saved (price answer "no", both scopes) → journal (period, filter, search, pagination, row states) → insights (all tabs) → vehicle (reminder log-service, .ics, snooze; issue status change; year screen; business statement export) → account (toggles, exports, restore preview, delete two-step cancel) → notifications → unsynced (offline toggle) → import sample → wizard (manual catalogue; EV plate `52839102`-style lookup). Switch to an EV vehicle and repeat Home, fill(charge), insights, vehicle.
3. Console: zero errors and zero React key warnings on every route.
4. Offline: enable the offline mode, add a fill and an expense, go online, watch both reach "confirmed"; the journal rows show the pending/confirmed states meanwhile.
5. Visual diff vs. `design/v3/prototype.html` for each screen (same viewport). Differences are either justified in `evidence/stage-N/DIFF.md` or fixed.
6. If anything fails: fix, re-run the whole cycle. Do not mark a stage accepted with a known red item. If a check cannot run in your environment (no browser, no credentials), say so explicitly in the evidence and try another way before stopping — never label it as passed.

## Deliverables

`feat/design-v3` branch with staged commits; `design/v3/evidence/stage-*/` (checklists, screenshots before/after, QA.md, DIFF.md); updated `design/v3/PROGRESS.md` and `HANDOFF.md`; a PR to `main` whose description lists, per screen, what changed and what was verified, and the OCR accuracy numbers.
