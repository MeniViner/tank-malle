# Native launcher icons — 21 November 2026

Tank Malle **1.11.6 / code 17** integrates the owner-approved transparent PNG
into the installed launcher. The application source is frozen at
[`44941104bac497dc0c9bf7bc4bbee4a5cdb90c36`](https://github.com/MeniViner/tank-malle/commit/44941104bac497dc0c9bf7bc4bbee4a5cdb90c36)
on `codex/launcher-icons-20261120`, based on native release `faf8c0b`.
Later documentation commits do not change or rebuild that application source.

## Origin publication and next-release gate

The original branch was initially pushed only to the private `handoff` remote,
not to `origin` (`MeniViner/tank-malle`). The follow-up publishes this same branch
and its original ancestry to `origin` for a PR targeting `main`; it does not
rewrite the submitted application commit or publish another Play build.

The submitted AAB's embedded build-info names clean commit `4494110` and version
`1.11.6`; its Android manifest has code `17`. That build supplied
`TANK_MALLE_BUILD_NUMBER=17`. The follow-up changes the tracked Gradle fallback
from `1` to `17` in `android/app/build.gradle`, so a missing environment override
also uses the submitted release code. This explicit configuration correction is
separate from the already submitted binary and does not claim a new artifact hash.

`origin/main` at `e086620` lacks the native shell used in the submitted build.
The PR therefore includes that existing native baseline as well as the icon and
version changes; dropping those files would not preserve the application source
that was submitted.

Do not modify or merge scanner branch `ccr-1a6af9b1-z4jo8s` / `c5d56a6` here.
Its owner will update it separately to `1.11.7` / code `18` above this PR.
**Do not submit another Google Play version until both PRs are merged to main.**

## Scope and artifacts

`resources/app-icon/foreground.png` replaces the old SVG through the existing
generator. Only mechanical trimming, scaling and alpha-based monochrome exports
were used. Legacy, adaptive, round, night and themed Android icons and the iOS
asset exports retain the existing pipeline. PWA, in-app UI, splash and store
artwork are unchanged; no iOS runtime acceptance is claimed.

| Item | SHA-256 |
| --- | --- |
| Approved transparent PNG | `81c5fcbd6eda1822e4975db7dfefa10c4a9fd734378063dfa8c478b37e19cb27` |
| `Tank-Malle-1.11.6-build17.aab` | `3477fd9d832255196a3247317a9a29be11b49a0c2aa617c1f0793605e91617fc` |
| `Tank-Malle-1.11.6-build17-qa.apk` | `b9f0fd4e1add5002818956310793f02b32a58a37ab9f1626b1994b07156b9984` |
| Existing signing certificate | `dd54df95b14f9b4ba005906576dd51126b0c013f85d983a1d729720cc4bc9357` |

The AAB retains `com.meniviner.tankmalle`, min SDK 24, target SDK 36 and the
base-16 permission set. The nondebuggable QA APK uses
`com.meniviner.tankmalle.qa` with the same clean personal web payload, solely for
offline launcher checks. Both artifacts embed the application commit above and
reuse the existing external signing key; no credentials are included.

## Verification and release-owner readback

- `npm ci`, TypeScript and build checks passed. Host tests: **1,534 passed,
  7 existing skips, 120 files**. Lint: **0 errors, 25 existing warnings**.
- Bundle validation, signatures, ZIP alignment and `verifyPlayBundle` passed.
  R8 DEX: 2,832,032 bytes; obfuscation 61.63%, optimization 60.45%, shrinking
  61.41%. No new CI result is claimed.
- Independent source review was clear. All 22 packaged Android PNGs match the
  generated assets; eight day/night adaptive XML references resolve. The
  significant foreground radius is 32.902 dp within the 33 dp safe circle;
  color and monochrome alpha planes match. Three opaque 1024px iOS exports
  were statically checked.
- The release owner verified the actual API 36 launcher offline after fresh
  installation/reinstallation of QA 17: the new icon appears in day and night
  modes, and the resolved Activity cold-launches. No sign-in, account or data
  actions were performed. QA removal and absence were verified, controls were
  restored, and the owned emulator was stopped. Physical launcher, actual
  16 KiB execution and actual Play installation remain **UNVERIFIED**.
- Play internal track `4701635743178258439`, release `5`, shows the exact code-17
  AAB available on **21 November, 00:22 Asia/Jerusalem**. The same artifact was
  promoted to Alpha track `4700518119588886058` at 100% with Hebrew notes. Both
  review confirmations completed; the final status was **Changes in review**.
  Approval and closed-test availability are not claimed. The existing
  nonblocking native-debug-symbol recommendation remains open.

The existing authenticated owner Chrome tab resolved the earlier login issue.
No tester, country, invitation, store-artwork or production settings were changed;
no merge or recurring review monitoring was performed.

The release-owner's local
[shared verification report](</Users/meni/dev/personal projects/chatStamp/dist/play/native-launcher-icons-20261120/README.md>)
contains the fresh launcher, cleanup and Console receipts. The signed artifacts
remain together in the
[shared product folder](</Users/meni/dev/personal projects/chatStamp/dist/play/native-launcher-release-20261120/>)
with its [README](</Users/meni/dev/personal projects/chatStamp/dist/play/native-launcher-release-20261120/README.md>).
