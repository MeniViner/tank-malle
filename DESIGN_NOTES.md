# Design Notes — טנק מלא · Plate v2

## Authority and scope

The implementation follows `design/v2/DESIGN-V2.md` and the supplied clickable
`design/v2/prototype.html`. The prototype is a visual reference. Private stored
records, pure calculation modules, price precedence, receipt ownership,
continuity and the durable outbox remain authoritative.

The release includes the app shell, Account, Home, fill-up and confirmation,
Journal, Insights, vehicle care, entry and vehicle management, notifications,
Admin, import, Unsynced, feedback and legal pages. The previous profile and
settings routes redirect to Account; data-tool deep links remain compatible.

## Identity and typography

| Token | Light | Dark |
| --- | --- | --- |
| Background | `#F9F7F2` | `#1E1C18` |
| Solid surface | `#FFFFFF` | `#282520` |
| Inset surface | `#F0ECE3` | `#33302A` |
| Main ink | `#15130F` | `#DDD6C7` |
| Secondary ink | `#4B463C` | `#A9A292` |
| Hairline | `#E4DFD4` | `#3D3932` |
| Default accent | `#FFC915` | `#E6B417` |
| Licence plate | `#FFC915` | `#EFBE1A` |

Six curated accent pairs are available: plate, mint, sky, peach, lilac and lime.
Legacy/custom colours fall back to plate. Plate yellow is independent of the
chosen UI accent. Accent surfaces use `#111` text; favourable/adverse fuel
comparisons use semantic blue/orange, independent of the accent.

- **Karantina 700** supplies display titles and hero numbers: 62px screen
  titles, 34px card headlines, 128px Home consumption and 196px post-save.
- **IBM Plex Sans Hebrew** supplies body and controls; body is 16px, with
  secondary text at least 12px.
- **IBM Plex Mono** supplies plate numbers, odometer and pump readouts.

Fonts and their OFL licences are bundled in `public/fonts/` and precached.

## Shell, shapes and motion

The app is RTL and fluid to 320px, centered on wider viewports. Page padding
is generally 20px. A fixed, non-interactive wash, corner glow and SVG gauge
arc give route-specific atmosphere; reading surfaces remain solid.

Groups use 1.5px ink rules and quiet hairlines. Primary buttons are 56px high,
with a 2px ink border and a hard 4px shadow. Other interactive targets are at
least 44px. The tab bar contains בית, יומן, the 72px תדלקתי action, תובנות and
רכב. Account opens from the avatar. Selected tabs use an accent pill.

Sheets use a native dialog, focus management, keyboard dismissal and 26px
upper corners. Reduced-motion preferences remove movement rather than hiding
state. Toasts separate pending writes from server confirmation and expose a
bounded Undo only when the action supports it.

## Numbers and editing

Read-only money uses the shared whole-shekel formatters. Per-litre fuel prices
always retain two decimals. Editable amounts, imports, exports and persisted
values retain their original precision. Numeric runs are isolated LTR islands;
Hebrew unit labels stay in RTL flow. Standalone display numbers start at the
right edge, while trailing row values remain at the row end.

Visible civil-date fields use day-first text and preserve invalid drafts for
correction. Their native calendar picker is supplemental; valid stored dates
remain ISO `YYYY-MM-DD`. Time input is a 24-hour value. A display conversion
must not rewrite a record that the user did not change.

## Screens and preserved behavior

| Surface | Presentation and behavior |
| --- | --- |
| Home | Large consumption value, measured-history sparkline, spotlight, three KPI cells and contextual tank sheets. Unknown data remains unknown. |
| Fill-up | Pump-style controlled inputs, exact field ownership, continuity choice and post-save confirmation. Pending and server-rejected writes remain distinct. |
| Journal / Insights | Month headings, grouped records, isolated numeric columns and shared period/consumption calculations. |
| Vehicle | Overview, care, issues, reminders, documents and edit sheets. Optional document data is additive; unavailable server data is not empty data. |
| Account | Appearance, units, pricing, data tools and sign-out. Six accents and system/light/dark modes remain separate settings. |
| Notifications | New/read/deferred/archive groups, state-ready controls, explicit snooze date and server-confirmed five-second Undo. Undo restores deletion tombstones explicitly and cannot cross an account/vehicle lifetime. |
| Admin | Claim-gated four-tab layout, published bounded summaries, fuel-price receipts and local per-admin feedback handling. `טופל אצלי` describes a local marker; it does not mutate feedback remotely. |
| Import | File/read/preview/result stages, duplicate/rejected-row detail, exact batch identity, truthful pending/failure states, history retry and acknowledged-import Undo. |
| Unsynced | Actual queued/failed/conflict state, exact retained input, retry/edit/export/discard. Unknown storage is never reported as an empty queue. |
| Feedback | Idea/bug/compliment choices and one message field. Confirmation follows the append-only write acknowledgement. |
| Legal | Preserved policy sections, narrow readable measure, bundled-font and Account-navigation facts. |

## Async and persistence boundaries

An account or vehicle switch invalidates callbacks from its prior lifetime,
including switching away and back to the same ID. Provider-bound action guards
survive navigation within the same active vehicle so an available Undo still
works after leaving a page. UI completions do not update unmounted pages.

Import writes and rollbacks retain their original IDs, journal payloads and
per-write receipts. The tracker is captured before asynchronous preparation;
a late result cannot enter another account's write-status view. Already issued
SDK writes keep their actual acknowledgement or rejection. Auth token/profile
results are similarly scoped to an authentication epoch.

The recovered vehicle-document/profile changes require the accompanying
additive Firestore rules. Deploy rules before Hosting. No new runtime dependency,
Functions deployment, private admin ledger read or automatic feedback mutation
is introduced by the finishing pass.

## Verification and release evidence

Historical accepted runs and recovery integrity checks are in
`design/v2/evidence/stage-5/`. Current finishing checks are recorded separately
under `design/v2/evidence/stage-6/`; historical results do not certify modified
source. Browser startup failures caused by the execution environment are kept
as blocked verification, not application failures or passing tests.

Release only a clean committed build. `dist/build-info.json` and the deployed
`/build-info.json` must agree on version, commit and `dirty: false`. Successful
builds, local commits and remote deployment are reported as separate outcomes.
