/**
 * Nightly refresh of the regulated fuel price, without a Cloud Function.
 *
 * The scheduled function in `functions/` needs Blaze. This does the same job
 * from anywhere that can run Node once a day — GitHub Actions, in our case —
 * which is free and stays free. See .github/workflows/fuel-prices.yml.
 *
 *   # print what it would write, no credentials needed
 *   node scripts/updateFuelPrices.mjs --dry-run
 *
 *   # write it (a service-account key, by path or inline JSON)
 *   GOOGLE_APPLICATION_CREDENTIALS=key.json node scripts/updateFuelPrices.mjs
 *   FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",…}' node scripts/…
 *
 * WHAT IT READS. The Ministry of Energy publishes monthly and mid-month announcements at
 * gov.il/he/pages/fuel-<month>-<year>, and that page states the maximum
 * consumer price for 95-octane self-service including VAT, plus the
 * full-service surcharge in agorot. That is the only figure Israel regulates:
 * 98 and diesel are not, and this script never invents one for them.
 *
 * The page is behind Cloudflare, which refuses some datacentre IPs outright,
 * so a direct read is tried first and a public text-extraction proxy second.
 *
 * MANUAL VS SCHEDULED — THE POLICY (docs/PRICE-SOURCE-AND-CONFIDENCE-MODEL.md §9)
 *
 *   • The job always records what it read in
 *     `byFuelType.95.self.scheduledHistory[<month>]`, and always reports the
 *     run in `automation` (attempt / success / failure / error / month / price
 *     / route / project). Every run leaves a trace, including a failed one.
 *   • If an admin has set `byFuelType.95.self.manualOverride` AFTER the latest publication in the SAME
 *     month the job read, the job does NOT touch `current`, `history[month]`
 *     or `source`: the admin's figure keeps winning for that month. The run
 *     logs "manual override for <month> kept".
 *   • An override for an OLDER month is left in place — the app only applies
 *     it inside its own month — and the job writes the new month normally.
 *   • Otherwise the job writes `current`, `history[month]`, `source:
 *     "scheduled"` and the legacy top-level `current`/`history`, as before.
 *   • An admin restores the automatic value from the admin console
 *     ("החזרת הערך האוטומטי"), which clears the override and copies
 *     `scheduledHistory[month]` back into `history[month]` and `current`.
 *
 * FAILURE IS VISIBLE. When no price can be read, the job writes only the
 * `automation` block (attempt, failure time, error text) and exits 1, so the
 * workflow shows red AND the admin console shows why. The previous price stays
 * — a stale but correct price beats a confidently wrong one.
 *
 * `--dry-run` never writes anything, in either branch, and prints the same
 * plan it would have written.
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DRY_RUN = process.argv.includes("--dry-run");

import { readPublicPrice, parsePublicAnnouncement, priceTimeline } from '../src/lib/prices/publicSource.ts';
function monthKey(date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(date).slice(0, 7); }
export function parseAnnouncement(raw) {
  const p = parsePublicAnnouncement(raw);
  return p ? { selfService: p.price, fullService: p.fullService } : null;
}
export async function readCurrentPrice(now = new Date()) {
  const p = await readPublicPrice(now.getTime());
  return { ...p, selfService: p.price };
}

async function credentials() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline) return JSON.parse(inline);

  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) return JSON.parse(await readFile(path, "utf8"));

  throw new Error(
    "set FIREBASE_SERVICE_ACCOUNT (inline JSON) or GOOGLE_APPLICATION_CREDENTIALS (path)",
  );
}

/** `Timestamp`, `Date` or a number → epoch ms, so the policy can compare months. */
function toMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return null;
}

/**
 * The write, decided from the existing document and the reading. Pure, so the
 * policy above is unit-tested without Firestore.
 *
 * @param existing  the current `appConfig/fuelPrices` data, or undefined
 * @param reading   `{ ok: true, selfService, fullService, month, url, via }`
 *                  or `{ ok: false, error }`
 * @param now       the run's timestamp (a Date)
 * @param projectId the Firestore project the write targets
 * @returns `{ payload, keptOverride, summary }` — `payload` is merged into the
 *          document (`set(..., { merge: true })`), `keptOverride` says whether
 *          a same-month admin figure was left in force
 */
export function planWrite(existing, reading, now, projectId = null) {
  const attemptAt = now;

  if (!reading.ok) {
    return {
      keptOverride: false,
      summary: `failure recorded: ${reading.error}`,
      payload: {
        automation: {
          lastAttemptAt: attemptAt,
          lastFailureAt: attemptAt,
          lastError: String(reading.error).slice(0, 1000),
          targetProjectId: projectId,
        },
      },
    };
  }

  const { selfService, fullService, month, via } = reading;
  const effectiveFrom = reading.effectiveFrom != null ? new Date(reading.effectiveFrom) : new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);

  const previousAt = toMillis(existing?.byFuelType?.['95']?.self?.current?.effectiveFrom);
  if (previousAt && previousAt > effectiveFrom.getTime()) {
    return planWrite(existing, { ok: false, error: 'Source returned an older publication; previous price retained' }, now, projectId);
  }

  const automation = {
    lastAttemptAt: attemptAt,
    lastSuccessAt: attemptAt,
    lastError: null,
    lastReadMonth: month,
    lastReadPrice: selfService,
    lastVia: via ?? null,
    targetProjectId: projectId,
  };

  /** One fuel-type/service-mode series, in the shape the app reads. */
  const scheduledSeries = (price) => ({
    current: { pricePerLiter: price, effectiveFrom, updatedAt: attemptAt },
    history: { [month]: price },
    scheduledHistory: { [month]: price },
    source: "scheduled",
    retrievedAt: attemptAt,
    sourceUrl: reading.url ?? null,
    timeline: priceTimeline(
      { ...existing?.byFuelType?.['95']?.[price === selfService ? 'self' : 'full'], current: { effectiveFrom: price === selfService ? previousAt : toMillis(existing?.byFuelType?.['95']?.full?.current?.effectiveFrom) } },
      { month, effectiveFrom: effectiveFrom.getTime(), price }),
  });

  const override = existing?.byFuelType?.["95"]?.self?.manualOverride;
  const overrideMonth =
    override && typeof override.month === "string"
      ? override.month
      : override?.setAt != null
        ? monthKey(new Date(toMillis(override.setAt)))
        : null;

  if (override && overrideMonth === month && (!reading.effectiveFrom || toMillis(override.setAt) >= reading.effectiveFrom)) {
    // The admin's figure keeps winning for this month. Record what the
    // ministry says, so it can be restored and compared, but do not replace
    // the effective price or the source tag.
    return {
      keptOverride: true,
      summary: `manual override for ${month} kept (admin ₪${override.pricePerLiter}, ministry ₪${selfService})`,
      payload: {
        byFuelType: {
          95: {
            self: { scheduledHistory: { [month]: selfService }, retrievedAt: attemptAt },
            ...(fullService ? { full: scheduledSeries(fullService) } : {}),
          },
        },
        automation,
      },
    };
  }

  return {
    keptOverride: false,
    summary: `wrote ₪${selfService} for ${month}`,
    payload: {
      byFuelType: {
        95: {
          self: { ...scheduledSeries(selfService), ...(overrideMonth === month ? { manualOverride: null } : {}) },
          ...(fullService ? { full: scheduledSeries(fullService) } : {}),
        },
      },
      // The legacy top-level fields, still read by the adapter for older
      // clients. Same figure, same month — never a different one.
      current: { pricePerLiter: selfService, effectiveFrom, updatedAt: attemptAt },
      history: { [month]: selfService },
      source: "gov.il",
      automation,
    },
  };
}

async function main() {
  const now = new Date();

  // Credentials FIRST, so a failed read can still be reported to the document
  // the admin console watches. In a dry run they are optional.
  let account = null;
  if (DRY_RUN) {
    account = await credentials().catch(() => null);
  } else {
    account = await credentials();
  }
  const projectId = account?.project_id ?? null;
  console.log(`target project: ${projectId ?? "(none — dry run without credentials)"}`);

  let reading;
  try {
    reading = { ok: true, ...(await readCurrentPrice(now)) };
    console.log(`read ${reading.url} via ${reading.via}`);
    console.log(`  95 self-service : ₪${reading.selfService} (${reading.month})`);
    console.log(
      `  95 full service : ${reading.fullService ? `₪${reading.fullService}` : "not stated"}`,
    );
  } catch (error) {
    reading = { ok: false, error: error.message };
    console.error(error.message);
  }

  if (DRY_RUN) {
    // Nothing is written in a dry run — not even the failure record — but the
    // plan is printed in full so a local run shows exactly what would happen.
    const plan = planWrite(undefined, reading, now, projectId);
    console.log(`dry run — would ${plan.summary}`);
    console.log(JSON.stringify(plan.payload, null, 2));
    console.log("dry run — nothing written");
    if (!reading.ok) process.exitCode = 1;
    return;
  }

  const { cert, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  initializeApp({ credential: cert(account), projectId });
  const db = getFirestore();
  const ref = db.doc("appConfig/fuelPrices");

  const snapshot = await ref.get();
  const existing = snapshot.exists ? snapshot.data() : undefined;

  const plan = planWrite(existing, reading, now, projectId);
  await ref.set(plan.payload, { merge: true });
  console.log(`${plan.summary} → appConfig/fuelPrices in ${projectId}`);

  if (!reading.ok) {
    // The failure is now on record for the admin console; the workflow still
    // goes red on purpose so it is noticed in GitHub as well.
    process.exitCode = 1;
  }
}

// Only run when executed directly, so the parser and the policy can be
// imported by the unit tests without the script trying to reach gov.il.
const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
