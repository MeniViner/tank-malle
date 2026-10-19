# Cycle 5 — validation ledger

Final commit and test results are recorded in the portable review package's RECEIPT.md after verification. This file defines the evidence categories and hardware acceptance matrix; it does not imply unperformed checks passed.

| Evidence | Scope | Status before final run |
|---|---|---|
| Unit / security rules | parser, identity, drafts, costs, deadlines, private durable writes | Final run required |
| Chromium / WebKit | browser workflows with synthetic pixels and text/PDF fixtures | Final run required |
| Installed service worker | offline restart and exact-once delivery in browser | Final run required |
| HTTPS local gateway | TLS trust verification, same-origin Auth/Firestore routes and demo guards | Final run required |
| Real display images | independent sessions/displays, verified ground truth | Pending — no samples supplied |
| Provider adapter | actual issuer exports and labels | Pending — no exports supplied |
| Physical Android/iPhone | real sensors, platform UI and installed app lifecycle | Pending — no devices connected |

## Physical matrix — record device, OS, browser, timestamp and outcome for each

- Camera permission: allow, deny, delayed answer, close before answer; confirm no active camera after close.
- Portrait/landscape and EXIF orientation; JPEG/PNG/HEIC from library; unsupported decoding must preserve manual entry.
- Pump image then typed ODO; typed pump then ODO image; both images; authored values survive rescan.
- App background/foreground, screen lock, interrupted file picker, memory pressure and installed PWA relaunch.
- Offline form draft; offline Outbox creation; close/reopen; reconnect exactly once.
- Multi-device deletion during an offline write; failed record remains recoverable without recreating deleted vehicle.
- Accessibility: RTL, focus order, zoom, screen reader and keyboard, no horizontal overflow.
- Record local extraction latency separately from time to finish the full reviewed entry. Do not count typed correction as a correct automatic read.

No physical-device or real-image pass is claimed by a browser engine test. Respect station-specific phone-use instructions.
