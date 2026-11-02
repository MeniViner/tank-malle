# Home, profile, currency display and update delivery — 1.6.1

Base: `main@4035965f8399037a82eb0c1ea53a021ab37ea87b`.
Branch: `codex/home-profile-release-update`.
The scanner experiment in draft PR #19 is a separate workstream and is not included.

## User-visible changes

- Home always shows learned usage first. The complete tank estimate and its
  existing actions follow in a native disclosure, closed by default.
- Full-account and legacy maintenance backups live in Profile's My Data section.
- Read-only shekel amounts use one whole-shekel formatter, including unit prices,
  history, charts, differences and admin views. `AGENTS.md` records this product
  rule. Stored values, calculations, editable values and exports retain their
  original precision. No data migration or price rounding on save occurs.
- Settings names the installed Git build and compares it with uncached
  same-origin `build-info.json`. Equal semantic versions with different commits
  are different builds. Failed checks do not report that the app is current.
  Activation and reload still respect the existing durable-draft guard.
- 98 and diesel vehicles automatically load an independently cached Delek
  **network list price**. The UI labels the provider, full service, mainland
  scope and publication date. It is not a national regulated price or evidence
  of the price paid at an arbitrary station; it does not prefill receipts.

## Fuel-source boundary

Source: <https://delek.co.il/מחירון/>. The parser identifies the full-service
column by its heading and excludes Eilat. Ambiguous rows, missing dates and
future publications are rejected. A failed refresh keeps the previous reading
with a failure/staleness message. Direct browser fetch falls back to the public
reader for the same public URL, omitting credentials and referrer information.

The existing 95 fetcher, government parser, scheduled job, pricing configuration,
personal discounts and receipt suggestion logic are unchanged.

Live verification on 2 November 2026 used Chrome 156 with the environment's
configured CA trusted, without disabling TLS verification. The direct request
was unavailable to the browser; the public reader returned and parsed the real
dated source. This demonstrates current reachability, not a future availability
guarantee. A 160px content-width check retained all provenance text without overflow.

## Validation and release

Automated coverage includes exact precision preservation, parser ambiguity and
cache failures, 95 isolation, mobile layout, backup placement, same-version Git
updates, unavailable release metadata, uncontrolled first tabs, and preservation
of drafts/outbox data through activation.

Local results: 54 unit suites, 734 passed and 12 pre-existing private-fixture
skips; typecheck passed; lint 0 errors and 20 existing warnings (within budget);
37 targeted Chromium UI/source/95-price tests passed (33 main cases and 4
additional collapsed-tank regression cases); 5 fresh built-PWA upgrade tests
passed. The production-mode build passed. The test browser was official Chrome
156.0.8078.80 because the
lockfile's 156.0.8078.4 browser download was unavailable. Java 21 and isolated
demo Firebase emulators were used. No checks ran against customer records.

The development environment has no authenticated Firebase deployment identity.
The connected GitHub integration rejected creation of the Git tree with HTTP
403 `Resource not accessible by integration`; no branch or PR was created.
The complete tested change is supplied as a Git bundle and a patch for an
authorized checkout. Remote CI has not run for this change yet.
No production deployment, Firestore rules change, Functions change or user-data
write was performed here. The publicly served identity at the start of this
work was version `1.6.0`, commit `4035965f8399037a82eb0c1ea53a021ab37ea87b`.

From an already authorized release environment:

1. Import the supplied branch, fetch current main, review the diff, push the
   branch and open its PR. Verify CI on the actual final head.
2. Merge that PR through the normal release process; do not include scanner PR #19.
3. Build from the clean merge commit with the existing production configuration.
   Confirm `build-info.json` names version `1.6.1`, that merge commit, `dirty:false`
   and `mode:production`.
4. Deploy **Hosting only** to the existing `tank-malle` project. Do not deploy
   rules or Functions for this change.
5. Read back the live build metadata and asset hashes. Verify an existing
   installed client detects the release and, after a permitted refresh, shows
   the same build identity. Check Home, Profile and the independent fuel references.
6. Record remaining device-only checks honestly. Missing access to the user's
   Galaxy S25 does not block these development or release checks.
