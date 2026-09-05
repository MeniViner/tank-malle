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
 * If both fail, nothing is written and the previous value stays — a stale but
 * correct price beats a confidently wrong one.
 */

import { readFile } from "node:fs/promises";

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

async function main() {
  const result = await readCurrentPrice();
  const effectiveFrom = new Date(
    Number(result.month.slice(0, 4)),
    Number(result.month.slice(5, 7)) - 1,
    1,
  );

  console.log(`read ${result.url} via ${result.via}`);
  console.log(`  95 self-service : ₪${result.selfService} (${result.month})`);
  console.log(
    `  95 full service : ${result.fullService ? `₪${result.fullService}` : "not stated"}`,
  );

  if (DRY_RUN) {
    console.log("dry run — nothing written");
    return;
  }

  const account = await credentials();
  const { cert, initializeApp } = await import("firebase-admin/app");
  const { FieldValue, getFirestore } = await import("firebase-admin/firestore");

  initializeApp({ credential: cert(account), projectId: account.project_id });
  const db = getFirestore();

  /** One fuel-type/service-mode series, in the shape the app reads. */
  const series = (price) => ({
    current: {
      pricePerLiter: price,
      effectiveFrom,
      updatedAt: FieldValue.serverTimestamp(),
    },
    history: { [result.month]: price },
    source: "scheduled",
    retrievedAt: FieldValue.serverTimestamp(),
  });

  const payload = {
    byFuelType: {
      95: {
        self: series(result.selfService),
        ...(result.fullService ? { full: series(result.fullService) } : {}),
      },
    },
    // The legacy top-level fields, still read by the adapter for older
    // clients. Same figure, same month — never a different one.
    current: {
      pricePerLiter: result.selfService,
      effectiveFrom,
      updatedAt: FieldValue.serverTimestamp(),
    },
    history: { [result.month]: result.selfService },
    source: "gov.il",
  };

  await db.doc("appConfig/fuelPrices").set(payload, { merge: true });
  console.log(`wrote appConfig/fuelPrices for ${account.project_id}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
