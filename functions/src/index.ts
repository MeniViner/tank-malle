import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

initializeApp();
const db = getFirestore();

const REGION = "europe-west1";

/* ------------------------------------------------------------------ *
 * Fuel price
 * ------------------------------------------------------------------ */

/**
 * The official maximum consumer price for 95-octane is published monthly by
 * the Ministry of Energy. There is no first-party JSON feed, so this tries a
 * small chain of sources and gives up quietly rather than writing garbage:
 * a stale-but-correct price beats a confidently wrong one.
 *
 * NOTE: this function needs Blaze and is not deployed. The job that actually
 * runs is scripts/updateFuelPrices.mjs, on a free GitHub Actions schedule —
 * see .github/workflows/fuel-prices.yml. It reads the monthly announcement
 * page, which is where the figure now lives; the collection URLs below have
 * been 404 for a while, which is part of why nothing was being written.
 */
const PRICE_SOURCES = [
  // fuel-<month>-<year>, e.g. .../fuel-september-2026
  `https://www.gov.il/he/pages/fuel-${new Date()
    .toLocaleString("en-US", { month: "long", timeZone: "Asia/Jerusalem" })
    .toLowerCase()}-${new Date().getFullYear()}`,
];

/** Israeli pump prices have lived in this band for over a decade. */
const MIN_PLAUSIBLE = 4;
const MAX_PLAUSIBLE = 12;

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Pull the first plausible price out of a page. Deliberately loose about
 * markup (which changes often) and strict about the number itself.
 */
export function parsePrice(html: string): number | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");

  const candidates: number[] = [];

  // Prefer numbers that sit next to 95-octane wording.
  const contextual =
    /(?:95|בנזין|אוקטן)[^\d]{0,80}?(\d(?:[.,]\d{1,4}))|(\d(?:[.,]\d{1,4}))[^\d]{0,80}?(?:95|בנזין|אוקטן)/g;
  for (const match of text.matchAll(contextual)) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const value = Number.parseFloat(raw.replace(",", "."));
    if (value >= MIN_PLAUSIBLE && value <= MAX_PLAUSIBLE) candidates.push(value);
  }

  if (candidates.length === 0) return null;

  // The same figure usually appears several times; take the most frequent.
  const counts = new Map<number, number>();
  for (const value of candidates) counts.set(value, (counts.get(value) ?? 0) + 1);

  let best = candidates[0];
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return Math.round(best * 100) / 100;
}

async function fetchOfficialPrice(): Promise<number | null> {
  for (const url of PRICE_SOURCES) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; TankMaleBot/1.0; +https://tank-malle.web.app)",
          "Accept-Language": "he-IL,he;q=0.9",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        logger.warn(`price source ${url} returned ${response.status}`);
        continue;
      }
      const price = parsePrice(await response.text());
      if (price !== null) {
        logger.info(`parsed price ${price} from ${url}`);
        return price;
      }
      logger.warn(`no plausible price found at ${url}`);
    } catch (error) {
      logger.warn(`price source ${url} failed`, error);
    }
  }
  return null;
}

/**
 * Daily refresh of appConfig/fuelPrices.
 *
 * Writes both `current` and a month-keyed `history` entry, so a backdated
 * fill-up can auto-fill the price that actually applied in its own month.
 */
export const updateFuelPrice = onSchedule(
  {
    schedule: "15 4 * * *",
    timeZone: "Asia/Jerusalem",
    region: REGION,
    retryCount: 2,
  },
  async () => {
    const price = await fetchOfficialPrice();
    if (price === null) {
      // Leave the last known good value in place.
      logger.error("no price could be parsed from any source; keeping previous value");
      return;
    }

    const now = new Date();
    const key = monthKey(now);
    const ref = db.doc("appConfig/fuelPrices");
    const snapshot = await ref.get();
    const existing = snapshot.exists ? snapshot.data() : undefined;

    if (existing?.current?.pricePerLiter === price && existing?.history?.[key] === price) {
      logger.info(`price unchanged at ${price}; nothing to write`);
      return;
    }

    await ref.set(
      {
        current: {
          pricePerLiter: price,
          effectiveFrom: new Date(now.getFullYear(), now.getMonth(), 1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        history: { [key]: price },
        source: "gov.il",
      },
      { merge: true },
    );

    logger.info(`fuel price updated to ${price} for ${key}`);
  },
);

/* ------------------------------------------------------------------ *
 * Vehicle lookup proxy
 * ------------------------------------------------------------------ */

interface Dataset {
  id: string;
  source: string;
  label: string;
}

const DATASETS: Dataset[] = [
  { id: "053cea08-09bc-40ec-8f7a-156f0677aff3", source: "private", label: "רכב פרטי" },
  { id: "bf9df4e2-d90d-4c0a-a400-19e15af8e95f", source: "motorcycle", label: "דו־גלגלי" },
  { id: "cd3acc5c-03c3-4c89-9c54-d40f93c0d790", source: "heavy", label: "רכב כבד" },
  { id: "03adc637-b6fe-402b-9937-7c3d3afc9140", source: "offroad", label: "רכב שטח" },
  { id: "851ecab1-0622-4dbe-a6c7-f950cf82abf9", source: "deregistered", label: "ירד מהכביש" },
];

const COUNTRY_SUFFIX =
  /\s+(יפן|קוריאה|גרמניה|גרמנ|צרפת|איטליה|ספרד|בריטניה|שבדיה|רומניה|טורקיה|סין|הודו|סלובקיה|הונגריה|פולין|בלגיה|מקסיקו|מכסי|ברזיל|תאילנד|קנדה|הולנד|אוסטריה|צ'כיה|פולי)\s*$/u;

function mapFuelType(raw?: string): string {
  if (!raw) return "95";
  if (/סולר|דיזל/.test(raw)) return "diesel";
  if (/98/.test(raw)) return "98";
  if (/חשמל|היבריד|גז/.test(raw)) return "other";
  return "95";
}

/**
 * CORS fallback for the browser-side plate lookup. data.gov.il currently
 * sends `Access-Control-Allow-Origin: *`, so this is only a safety net for if
 * that ever changes.
 */
export const vehicleLookup = onRequest(
  { region: REGION, cors: true, memory: "256MiB", maxInstances: 3 },
  async (request, response) => {
    const plate = String(request.query.plate ?? "").replace(/\D/g, "");

    if (plate.length < 5 || plate.length > 8) {
      response.status(400).json({ found: false, source: null, plateNumber: plate });
      return;
    }

    try {
      for (const dataset of DATASETS) {
        const url = new URL("https://data.gov.il/api/3/action/datastore_search");
        url.searchParams.set("resource_id", dataset.id);
        url.searchParams.set("limit", "1");
        url.searchParams.set("filters", JSON.stringify({ mispar_rechev: plate }));

        const upstream = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!upstream.ok) continue;

        const payload = (await upstream.json()) as {
          result?: { records?: Record<string, unknown>[] };
        };
        const row = payload.result?.records?.[0];
        if (!row) continue;

        const text = (key: string): string | undefined => {
          const value = row[key];
          if (value === null || value === undefined) return undefined;
          const asText = String(value).trim();
          return asText && asText !== "0" ? asText : undefined;
        };

        const fuelLabel = text("sug_delek_nm");
        const year = Number.parseInt(String(row.shnat_yitzur ?? ""), 10);

        response.set("Cache-Control", "public, max-age=86400");
        response.json({
          found: true,
          source: dataset.source,
          plateNumber: plate,
          make: text("tozeret_nm")?.replace(COUNTRY_SUFFIX, "").trim(),
          model: [text("kinuy_mishari"), text("ramat_gimur")].filter(Boolean).join(" ") || undefined,
          year: Number.isFinite(year) ? year : null,
          fuelType: mapFuelType(fuelLabel),
          category: [dataset.label, fuelLabel].filter(Boolean).join(" · "),
        });
        return;
      }

      response.json({ found: false, source: null, plateNumber: plate });
    } catch (error) {
      logger.error("vehicle lookup failed", error);
      response.status(502).json({ found: false, source: null, plateNumber: plate });
    }
  },
);
