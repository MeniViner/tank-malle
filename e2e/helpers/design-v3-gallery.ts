import { expect, type Page } from "@playwright/test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { signIn, uidOf, ALICE } from "./app";
import {
  BROWSER_TIME_ZONE, FIRESTORE_HOST, PROJECT_ID, getDocument, monthKeyInBrowserTimeZone,
  resetEmulators, setActiveVehicle, setDocument,
} from "./emulator";
import { israelMidnight } from "../../src/lib/prices/publicSource";
import { outboxCount } from "./pwa";

/**
 * Design v3 screenshot gallery — seeding and capture plumbing.
 *
 * Everything is written to the LOCAL emulators through the admin REST path
 * (the same approach as the v2 fixtures) so the gallery shows a realistic,
 * months-long history without driving the forms dozens of times.
 */

export const GALLERY_OUT = resolve(process.cwd(), process.env.V3_GALLERY_OUT ?? "design/v3/evidence/stage-0/before");
export const DAY = 86_400_000;
export const FUEL_VEHICLE = "v3-fuel";

export type Theme = "light" | "dark";

/** A civil day (YYYY-MM-DD) in the browser's zone, offset from today. */
export function day(offset = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: BROWSER_TIME_ZONE }).format(new Date());
  return new Date(new Date(`${today}T12:00:00Z`).getTime() + offset * DAY).toISOString().slice(0, 10);
}

/** Patch only `settings.<field>` on the user doc, leaving every other field (and its types) untouched. */
export async function patchSettings(uid: string, values: Record<string, string | boolean>): Promise<void> {
  const mask = Object.keys(values).map(key => `updateMask.fieldPaths=settings.${key}`).join("&");
  const fields = Object.fromEntries(Object.entries(values).map(([key, value]) =>
    [key, typeof value === "boolean" ? { booleanValue: value } : { stringValue: value }]));
  const url = `${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}?${mask}`;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) throw new Error(`refusing non-local host ${url}`);
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ fields: { settings: { mapValue: { fields } } } }),
  });
  if (!response.ok) throw new Error(`PATCH settings → ${response.status} ${await response.text()}`);
}

interface Fill { id: string; daysAgo: number; odometer: number; liters: number; price: number; station: string; partial?: boolean; reason?: string }

/** ~5 months of history: 10 fill-ups, one partial, realistic 11–14 km/l. */
const FILLS: Fill[] = [
  { id: "g-01", daysAgo: 150, odometer: 168_000, liters: 38, price: 7.12, station: "סונול שפיה" },
  { id: "g-02", daysAgo: 136, odometer: 168_470, liters: 37.4, price: 7.18, station: "דלק תחנה 95" },
  { id: "g-03", daysAgo: 121, odometer: 168_930, liters: 36.2, price: 7.21, station: "פז קרית מלאכי" },
  { id: "g-04", daysAgo: 104, odometer: 169_420, liters: 39.1, price: 7.05, station: "סונול שפיה" },
  { id: "g-05", daysAgo: 90, odometer: 169_700, liters: 18.5, price: 7.09, station: "ten אשדוד", partial: true, reason: "good-price" },
  { id: "g-06", daysAgo: 76, odometer: 170_050, liters: 24.6, price: 7.31, station: "דלק תחנה 95" },
  { id: "g-07", daysAgo: 58, odometer: 170_540, liters: 38.8, price: 7.36, station: "פז קרית מלאכי", reason: "before-trip" },
  { id: "g-08", daysAgo: 41, odometer: 171_010, liters: 36.9, price: 7.29, station: "סונול שפיה" },
  { id: "g-09", daysAgo: 23, odometer: 171_500, liters: 38.4, price: 7.42, station: "דלק תחנה 95" },
  { id: "g-10", daysAgo: 6, odometer: 171_980, liters: 37.2, price: 7.35, station: "סונול שפיה" },
];

export interface GalleryScope { uid: string; vehicleId: string; base: string; now: number; year: number }

async function seedPrices(now: number) {
  const currentKey = monthKeyInBrowserTimeZone(new Date(now));
  const [year, month] = currentKey.split("-").map(Number);
  const history: Record<string, number> = {};
  const series = [7.05, 7.12, 7.21, 7.31, 7.42, 7.35];
  for (let back = 5; back >= 0; back -= 1) {
    history[monthKeyInBrowserTimeZone(new Date(Date.UTC(year, month - 1 - back, 15, 12)))] = series[5 - back];
  }
  const current = { pricePerLiter: 7.35, effectiveFrom: new Date(israelMidnight(year, month, 1)!), updatedAt: new Date(now) };
  await setDocument("appConfig/fuelPrices", {
    byFuelType: { "95": { self: { current, history, scheduledHistory: history, source: "scheduled", retrievedAt: new Date(now) } } },
    current, history, source: "gov.il",
  });
}

/** Seed one realistic fuel vehicle with history, care records, a reminder, an issue and a planned trip. */
export async function seedGallery(uid: string): Promise<GalleryScope> {
  const now = Date.now();
  const vehicleId = FUEL_VEHICLE;
  const base = `users/${uid}/vehicles/${vehicleId}`;
  await seedPrices(now);
  await setDocument(base, {
    make: "יונדאי", model: "i20", year: 2019, fuelType: "95", archived: false,
    nickname: "המשפחתית", plateNumber: "7248078",
    priceAdjustment: 0, manualPricePerLiter: null,
    tankLiters: 45, tankLitersSource: "user", declaredKmPerLiter: 16.4, declaredSource: "user",
    createdAt: new Date(now - 160 * DAY),
    docs: {
      mandatory: { insurer: "הראל", due: day(140), cost: 1180 },
      coverage: { type: "comprehensive", insurer: "מגדל", due: day(140), cost: 2650 },
      test: { due: day(22), cost: 1240 },
    },
  });
  for (const fill of FILLS) {
    const date = new Date(now - fill.daysAgo * DAY - 3 * 60 * 60 * 1000);
    await setDocument(`${base}/fillups/${fill.id}`, {
      date, createdAt: date, odometer: fill.odometer, liters: fill.liters,
      pricePerLiter: fill.price, totalCost: Math.round(fill.liters * fill.price * 100) / 100,
      postedPricePerLiter: fill.price, isFullTank: !fill.partial, continuityBreakBefore: false,
      station: { name: fill.station },
      tankSchemaVersion: 2, fillEndState: fill.partial ? "partial" : "full", fillEndStateSource: "user-confirmed",
      preFillLevel: fill.partial ? 0.35 : 0.18, preFillLevelSource: "direct-gauge",
      refuelReason: fill.reason ?? "routine", capacityLitersAtEntry: 45,
    });
  }
  await setDocument(`${base}/observations/g-level`, {
    observedAt: new Date(now - 2 * DAY), recordedAt: new Date(now - 2 * DAY), kind: "level",
    level: 0.55, levelSource: "direct-gauge", confirmed: true,
  });
  const care = { schemaVersion: 1, version: 1, notes: "" };
  await setDocument(`${base}/serviceEvents/g-periodic`, { ...care, day: day(-120), title: "טיפול 165,000", jobs: ["periodic", "oil"],
    odometer: 168_850, costAgorot: 65_000, garage: "מוסך יוסי, קרית מלאכי", notes: "שמן, מסננים, בדיקת בלמים", completedPlanIds: ["g-oil"] });
  await setDocument(`${base}/serviceEvents/g-tires`, { ...care, day: day(-40), title: "צמיגים קדמיים", jobs: ["tires"],
    odometer: 171_020, costAgorot: 80_000, garage: "פנצ׳ריה אשדוד", completedPlanIds: [] });
  for (const [id, category, title, offset, costAgorot] of [
    ["g-ins", "insurance", "ביטוח מקיף — תשלום", -95, 220_000],
    ["g-test", "registration", "טסט ואגרת רישוי", -300 + 22, 124_000],
    ["g-park", "parking", "חניון אסותא", -18, 1_800],
    ["g-toll", "toll", "כביש 6", -33, 2_340],
    ["g-wash", "wash", "שטיפה", -12, 4_000],
    ["g-refund", "refund", "החזר חניה מהעבודה", -10, 1_800],
  ] as const) {
    await setDocument(`${base}/vehicleExpenses/${id}`, { ...care, day: day(offset), category, title, costAgorot });
  }
  await setDocument(`${base}/maintenancePlans/g-oil`, { ...care, title: "טיפול תקופתי", job: "periodic",
    dueDay: day(-120 + 365), dueOdometer: 168_850 + 15_000, intervalMonths: 12, intervalKm: 15_000,
    basis: "completion", source: "manufacturer", notes: "לפי ספר הרכב", active: true });
  await setDocument(`${base}/maintenancePlans/g-brakes`, { ...care, title: "בדיקת בלמים", job: "brakes",
    dueDay: day(9), dueOdometer: null, intervalMonths: null, intervalKm: null,
    basis: "manual", source: "garage", notes: "", active: true });
  await setDocument(`${base}/vehicleIssues/g-issue`, { ...care, day: day(-8), title: "רעש בבלמים מאחור",
    symptoms: "צליל חריקה בעצירה, בעיקר בירידה", odometer: 171_700, importance: "important", status: "watching",
    notes: "לבדוק בטיפול הבא", serviceEventIds: [], history: [JSON.stringify({ day: day(-8), status: "open", note: "" })] });
  const [ty, tm, td] = day(3).split("-").map(Number);
  const tripDate = new Date(israelMidnight(ty, tm, td)!);
  await setDocument(`${base}/tankPlans/g-trip`, { vehicleId, date: tripDate, distanceKm: 320, mode: "additional",
    bufferKm: 40, note: "צפון", createdAt: new Date(now) });
  return { uid, vehicleId, base, now, year: Number(day().slice(0, 4)) };
}

/** Reset, sign in through the real UI, seed, make the vehicle active and apply the theme preference. */
export async function galleryAccount(page: Page, theme: Theme): Promise<GalleryScope> {
  await resetEmulators();
  await signIn(page, ALICE);
  const uid = await uidOf(ALICE);
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings, { timeout: 15_000 }).toBeTruthy();
  const scope = await seedGallery(uid);
  await setActiveVehicle(uid, scope.vehicleId);
  // The app's own stored preference (DataContext applies settings.theme once the profile arrives).
  await patchSettings(uid, { theme, accentColor: "plate" });
  await page.goto("/");
  await expect(page.getByTestId("open-car-switch")).toContainText("המשפחתית", { timeout: 25_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme, { timeout: 15_000 });
  await expect.poll(() => outboxCount(page, uid), { timeout: 20_000 }).toBe(0);
  return scope;
}

/* ------------------------------------------------------------------ *
 * Console collection
 * ------------------------------------------------------------------ */

export interface ConsoleEntry { route: string; type: string; text: string; keyWarning: boolean }

export function collectConsole(page: Page) {
  const entries: ConsoleEntry[] = [];
  let route = "boot";
  const push = (type: string, text: string) => {
    const keyWarning = /unique "key" prop|Encountered two children with the same key/i.test(text);
    if (type === "error" || keyWarning) entries.push({ route, type, text: text.slice(0, 2000), keyWarning });
  };
  page.on("console", message => push(message.type(), message.text()));
  page.on("pageerror", error => push("pageerror", error.message));
  return { entries, setRoute: (name: string) => { route = name; } };
}

/** Per-test console file, then rebuild the combined console.json from all of them. */
export async function writeConsole(tag: string, entries: ConsoleEntry[], failures: { shot: string; error: string }[], shots: string[]) {
  await mkdir(GALLERY_OUT, { recursive: true });
  await writeFile(resolve(GALLERY_OUT, `console-${tag}.json`), JSON.stringify({ tag, shots, failures, entries }, null, 2));
  const files = (await readdir(GALLERY_OUT)).filter(name => /^console-.+\.json$/.test(name)).sort();
  const runs = await Promise.all(files.map(async name => JSON.parse(await readFile(resolve(GALLERY_OUT, name), "utf8"))));
  const byRoute: Record<string, { errors: number; keyWarnings: number; samples: string[] }> = {};
  for (const run of runs) for (const entry of run.entries as ConsoleEntry[]) {
    const bucket = byRoute[entry.route] ??= { errors: 0, keyWarnings: 0, samples: [] };
    if (entry.keyWarning) bucket.keyWarnings += 1; else bucket.errors += 1;
    if (bucket.samples.length < 5 && !bucket.samples.includes(entry.text)) bucket.samples.push(entry.text);
  }
  await writeFile(resolve(GALLERY_OUT, "console.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    totals: { errors: runs.reduce((n, r) => n + r.entries.filter((e: ConsoleEntry) => !e.keyWarning).length, 0),
      keyWarnings: runs.reduce((n, r) => n + r.entries.filter((e: ConsoleEntry) => e.keyWarning).length, 0),
      screenshots: runs.reduce((n, r) => n + r.shots.length, 0),
      captureFailures: runs.reduce((n, r) => n + r.failures.length, 0) },
    byRoute, runs,
  }, null, 2));
}
