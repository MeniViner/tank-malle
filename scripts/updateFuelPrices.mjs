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
 * WHAT IT READS. The Ministry of Energy publishes one page per month at
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
 *   • If an admin has set `byFuelType.95.self.manualOverride` for the SAME
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

/** Israeli pump prices have lived in this band for over a decade. */
const MIN_PLAUSIBLE = 4;
const MAX_PLAUSIBLE = 12;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/**
 * Two identities on purpose. gov.il's edge wants something browser-shaped;
 * the proxy's edge serves a Cloudflare challenge to a browser UA that arrives
 * without any of the other browser headers, and answers a plain bot UA fine.
 */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const BOT_UA = "TankMaleBot/1.0 (+https://tank-malle.web.app)";

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function pageUrl(date) {
  return `https://www.gov.il/he/pages/fuel-${MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

/** Markup or markdown in, plain text out. */
function toText(raw) {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

/**
 * The two numbers the announcement states, in the order it states them.
 *
 * Mainland comes before Eilat on every edition of this page, and the Eilat
 * figure is quoted WITHOUT VAT — so it is matched explicitly and skipped
 * rather than left to be picked up by a looser pattern.
 */
export function parseAnnouncement(raw) {
  const text = toText(raw);

  const sentences = text.split(/(?<=\.)\s+/);
  const mainland = sentences.find(
    (sentence) =>
      sentence.includes("שירות עצמי") &&
      sentence.includes("לא יעלה על") &&
      !sentence.includes("אילת"),
  );
  if (!mainland) return null;

  const price = mainland.match(/לא יעלה על\s+([\d]+[.,][\d]+)\s*ש/);
  if (!price) return null;

  const selfService = Number.parseFloat(price[1].replace(",", "."));
  if (!Number.isFinite(selfService)) return null;
  if (selfService < MIN_PLAUSIBLE || selfService > MAX_PLAUSIBLE) return null;

  // "תוספת בעד שירות מלא תעמוד על 26 אגורות" — the mainland one comes first.
  const surcharge = text.match(/תוספת בעד שירות מלא תעמוד על\s+(\d+)\s*אגורות/);
  const fullService = surcharge
    ? Math.round((selfService + Number(surcharge[1]) / 100) * 100) / 100
    : null;

  return { selfService, fullService };
}

async function fetchText(url) {
  const attempts = [
    { label: "direct", target: url, ua: BROWSER_UA },
    // Free, no key, and it renders the page server-side — the fallback for
    // the runs where Cloudflare refuses the runner's IP.
    { label: "proxy", target: `https://r.jina.ai/${url}`, ua: BOT_UA },
  ];

  const failures = [];
  for (const { label, target, ua } of attempts) {
    try {
      const response = await fetch(target, {
        headers: { "User-Agent": ua, "Accept-Language": "he-IL,he;q=0.9" },
        signal: AbortSignal.timeout(45_000),
      });
      const body = await response.text();
      if (!response.ok) {
        failures.push(`${label}: HTTP ${response.status}`);
        continue;
      }
      if (/Target URL returned error 404|לא נמצא/.test(body.slice(0, 400))) {
        failures.push(`${label}: page not published`);
        continue;
      }
      return { body, via: label };
    } catch (error) {
      failures.push(`${label}: ${error.message}`);
    }
  }
  throw new Error(failures.join(" · "));
}

/**
 * The announcement in force right now.
 *
 * The page for a month is published in the middle of the month before it, so
 * the current month is tried first and the previous one is the fallback for a
 * run on the first days of a month whose page has not been indexed yet.
 */
async function readCurrentPrice(now = new Date()) {
  const candidates = [
    now,
    new Date(now.getFullYear(), now.getMonth() - 1, 1),
  ];

  const failures = [];
  for (const date of candidates) {
    const url = pageUrl(date);
    try {
      const { body, via } = await fetchText(url);
      const parsed = parseAnnouncement(body);
      if (!parsed) {
        failures.push(`${url}: no price in page`);
        continue;
      }
      return { ...parsed, url, via, month: monthKey(date) };
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`no price could be read.\n  ${failures.join("\n  ")}`);
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
  const effectiveFrom = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);

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
  });

  const override = existing?.byFuelType?.["95"]?.self?.manualOverride;
  const overrideMonth =
    override && typeof override.month === "string"
      ? override.month
      : override?.setAt != null
        ? monthKey(new Date(toMillis(override.setAt)))
        : null;

  if (override && overrideMonth === month) {
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
          self: scheduledSeries(selfService),
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
