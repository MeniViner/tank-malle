# Design v3 — handoff

Branch `feat/design-v3`, cut from `main` at `05548ba`. Brief: `design/v3/PROMPT.md`. Spec: `design/v3/DESIGN-V3.md` (delta over `design/v2/DESIGN-V2.md`). Reference: `design/v3/prototype.html` (+ `proto/*.js`, `proto/lite.css`). Progress log: `design/v3/PROGRESS.md`.

## Rules every agent follows

- Repo root (a git worktree): `/Users/meni/dev/personal projects/tank-malle/.claude/worktrees/design-v3-review-97d63e`. Run everything from there. Never `cd` to the main checkout.
- `AGENTS.md` display rules are binding: whole shekels for totals; per-litre/kWh prices two decimals; use `src/lib/format.ts` / `src/components/Fmt.tsx`; never round stored values.
- Production logic (`src/lib/stats.ts`, `src/lib/tank/*`, `src/lib/prices/*`, outbox, rules) is authoritative. The prototype shows intent, not code to copy.
- Nothing derived is stored. Firestore rules/data model change only for new fields (`excluded` on expenses, `biz` on vehicles, EV battery/motor fields), each with a rules test.
- No behaviour regressions (DESIGN-V3 §6). Per-screen checklists live in `design/v3/evidence/stage-0/checklists/`.
- Existing tests that assert v2 visuals may be updated only where v3 intentionally changes that visual; never delete a behavioural assertion to make a test pass. Note every test change in the stage's `QA.md`.
- Do not commit; the coordinator commits per stage. Do not push. Do not run `git stash`.
- **§6 vs production policy** (Stage 0 found §6 doesn't match production everywhere; see `evidence/stage-0/checklists/README.md`):
  - Where production differs from §6 (journal pages are 50 rows, odometer jump confirm at more than 3,000 km, reserve range, pump-price scope picked automatically, care backup lives in Account, and so on), **production wins**. Keep its values and logic, and record each one in that stage's `DIFF.md`.
  - Where a §6 item is missing in production, don't invent it, with two exceptions: v3 features (§7), and small presentational additions the prototype shows and existing data supports (measurement sheet "full"/"restarts" counts, insights cheapest/dearest price, snooze presets tomorrow/week/month that map to the existing snooze date). Implement those; list everything else as "not in production, not added" in `DIFF.md`.
  - Dead code (`Profile.tsx`, `Settings.tsx`, `Landing.tsx`, `Previews.tsx`, `TankStateSection.tsx`) stays untouched.
- Gates: `npx tsc -b`, `npm run lint` (0 errors), `npm test`.
- E2E: Java must be on PATH: `PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`. Use `E2E_ISOLATED=1` (emulators 8087/9097, vite 5273, pwa 5274). Never touch emulators on 8080/8086/8088/9098/9150 (other sessions). Only one e2e rig at a time; the coordinator schedules them.
- Evidence goes under `design/v3/evidence/stage-N/`. If a check cannot run, say so; never call it passed.
