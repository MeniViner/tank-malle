# Fill-up entry and exports — 1.7.3

## Export filenames

Every download uses `exportFilename`: fill-ups for one vehicle or all vehicles,
tank observations, account backups, care backups, care costs, reminder calendars,
and unsynced operations. The filename includes the device's local date and time,
seconds, milliseconds, and a filename-safe UTC offset. For example:

`tank-maleh-backup-2026-11-06_08-30-15-042_UTC+0200.json`

Where a format already has `exportedAt` or `DTSTAMP`, its metadata and filename
use the same instant. Export schemas, monetary precision, and import compatibility
remain unchanged; no extra CSV header rows are introduced.

## Photo entry and optional details

The two manual-entry footer links are removed. Closing the camera sheet returns
any accepted reading to the existing fill-up form. Reading a pump and closing
before the odometer step therefore preserves the pump data without saving a
record. Callbacks arriving after the sheet closes cannot change that draft.

The scan records which fields were accepted, including a scanned value equal to
an automatic prefill. Accepted measurements become authored receipt fields;
later price suggestions cannot change them. Previously entered totals, litres,
and odometer values are protected. An explicitly entered price remains protected
by the receipt model, with inconsistent measurements surfaced for correction.

The date remains in the main form. Optional details no longer repeat it or ask
why the user refuelled. Existing reasons are still preserved in records, draft
editing, imports, and exports, including when old gauge readings are reset.

## Explicit nearby ordering

The underlined `בקרבתי` action asks for a fresh location (`maximumAge: 0`) and
orders every matching station by straight-line distance before pagination.
Results are shown 30 at a time, with `עוד תחנות` revealing the rest. There is no
400-metre filter on this explicit order; unknown locations remain selectable at
the end, and equal distances retain stable order.

The ordinary search and automatic station suggestion retain their existing
behaviour. Automatic suggestion still uses 400 metres (and prefers a historical
station within 300 metres). Explicit ordering never chooses a station. It
invalidates older automatic requests, and a late result cannot overwrite a
manual selection. Permission denial preserves the prior list and permits retry.

Sorting uses the loaded local catalogue and history, without a network request
per station. Historical station identities and selection payloads remain intact.

## Date-aware price suggestions

The selected transaction date resolves the stored official price timeline.
Dated changes within one month are respected. A newer current price cannot fill
an earlier gap in the evidence. The existing price updater continues to retain
historical monthly values and dated notices when storing a new price.

Current vehicle discounts or applicable private station rules adjust the
suggestion once, using the existing precedence. The caption identifies the
effective date and states that the personal adjustment uses the current setting.
This release does not reconstruct historical personal discount settings. A
private rule's explicit expiry is evaluated at the transaction date.

Manual, scanned, imported, and existing receipt amounts remain authoritative.
If backdating removes the available price evidence, only the automatic price and
amounts derived from it are cleared. Authored measurements are retained. The
existing labelled last-paid fallback and unsupported-fuel protections remain.

## Release sequence

The preceding alert release (PRs #25 and #26, main commit `4d0f054`) was deployed
and verified on production before implementation of these changes began.
This release is reviewed in its own PR and qualified before Hosting deployment.
