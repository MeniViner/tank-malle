# Integration map — supplied design → canonical application

Baseline: main `4b40ce1`, scan/care `c3db734`, backup `623a722`, refreshed before edits. Worktree: `codex/unified-vehicle-design`. No whole-backup merge. The canonical checkout's dirty work is untouched.

The actual ZIP was extracted to a temporary reference directory; its `DESIGN.md`, `IA.md`, HTML/CSS, manifest and JS were inspected. The nested older ZIP, prototype `data.js` records, permissive admin flags, simulated camera, toast-only mutations and phone shell are excluded. User instructions take priority over handoff boilerplate, especially Home preservation.

| Design surface | Application route / implementation | Real action / source |
|---|---|---|
| Home | `/`, existing Home/MyTankCard/HeroSpark | Preserved consumption + graph, inline average/basis, learned usage, trip plan, unknown tank, recent fuel; shared overview + urgent notifications |
| Ledger | `/history` | Filter kind, month/year, query, related plan; source-specific edit/delete; acknowledged care deletion Undo |
| Insights | `/stats` | Shared running costs plus existing fuel purchases, measured consumption, price/peer engines |
| Vehicle | `/vehicle` | Shared latest mileage; reminder/issue/cost/details tabs; event history links to ledger |
| Year | `/vehicle/years/:year` | Same cost aggregation; correctly filtered ledger link |
| Reminder | `/vehicle/reminders/:planId` | Edit rule, create real linked service, derive next cycle, export ICS snapshot, delete/Undo |
| Issue | `/vehicle/issues/:issueId` | Symptoms/date/km/importance/status/notes, status history, linked actual repairs; no duplicate expense |
| Notifications | `/notifications` | Read/archive/snooze per occurrence, preferences; sync remains independent of archive |
| Fillup | `/fillup/new`, `/fillup/:id` | Existing validated form/outbox/station search/conflicts; manual default; explicit quick-entry preference |
| Capture / receipt | Existing ScanWizard, LiveCamera, PhotoReader, ReceiptImport | Local classical display reading; scoped reviewed drafts; text/PDF parser and exact identity dedupe; no model/assets/uploads |
| Profile / data | `/settings/profile` | Account summary, legacy exports, unified version-2 backup/import preview, local drafts/pending distinction, account deletion |
| Settings / garage | `/settings`, `/settings/vehicles` | Account sheet access; preferences separate from event journal; vehicle/archive and switching retained |
| Import / unsynced | `/settings/import`, `/settings/unsynced` | Existing CSV/XLSX preview/import rollback and actual durable outbox/retry/conflict tools |
| Entry / legal / admin | Existing React routes | Auth/vehicle wizard/legal/admin boundaries remain; local font/token integration, no prototype auth shortcuts |

## Visual tokens

Neutral background `#f4f5f5`, ink `#14171a`, surfaces `#fff/#ebedee`, dark equivalents remain. Assistant UI, Frank Ruhl Libre display headings, supplied Rubik numbers. 18px groups, 14px controls, 26px sheets; hairline separators and grouped rows. Single responsive app surface, no prototype phone bezel. Home layout takes priority over the prototype's alternate tank/graph design.

## Before / After

| Before | After |
|---|---|
| Separate fuel and care history | Unified typed ledger; one period and financial summary |
| Settings in bottom navigation | Vehicle tab; account sheet gives profile/settings/admin access |
| Isolated mileage consumers | Owner/active-vehicle scoped shared evidence from four canonical sources; day precision retained |
| Fuel-only “total expense” | Shared known running costs; refunds once, unknown costs disclosed, compatible covered ratios |
| Care entry tiles and nested histories | Compact add bar, grouped reminder/issue rows and dedicated detail routes |
| Display font used for numeric headlines | Local Rubik numeric font, lighter weights and tabular digits |
| No issue entity / notification persistence | Versioned owner-only issues and per-occurrence notification state |
| Fragmented account export | Versioned full-account JSON with separate cloud/pending/drafts and explicit attachment limit |

| Before | After |
|---|---|
| Mixed care/PWA/HTTPS test collection | Dedicated built-PWA and HTTPS projects, disposable emulator ports, no broad care skips |
| Version string only | Build version, commit SHA, dirty flag and build mode in the UI / build-info.json |
| Eager capture/PDF execution | Lazy modules, with PWA offline assets retained |
| Rounded journal amounts and missing interval markers | Exact agorot display, explicit LTR numeric islands, fuel quantities/consumption and continuity marker |
| Local preview using existing emulator state | Additive isolated demo seed, local HTTPS gateway and public certificate guide |
| Ambiguous comparison label | Same existing fuel-per-km formula, explicitly labeled more/less fuel per km |
| Proxy reusing an expired upstream socket | Fresh upstream connections for reliable local HTTPS profile/bootstrap writes |
| Account summary loaded once and then stale | Live active-vehicle overlay, scoped server snapshot for other vehicles, explicit refresh/time, and refresh after full-account import |
| Period ratio despite an intermediate odometer decrease | Coverage marked inconsistent and distance/ratios withheld |
| Subscription error before the new vehicle's first snapshot | Previous owner/vehicle issue and notification data are discarded before applying the error |
| Cost-summary link falling back to all dates | Explicit validated from/to range in the ledger; changing its period clears those bounds |
| Production build replacing the legacy PWA test bundle | Separate PWA output directory with a served-build mode assertion |
