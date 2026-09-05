import { expect, type Page } from "@playwright/test";
import {
  resetEmulators,
  seedFillups,
  seedRegulatedPrice,
  seedVehicle,
  setActiveVehicle,
  uidForEmail,
  type SeedFillup,
  type SeedVehicle,
} from "./emulator";

/**
 * Driving the app itself.
 *
 * Sign-in goes through the REAL flow — the Google button and `signInWithPopup`
 * — landing on the Auth emulator's own account chooser.
 * There is no test-only back door in the application code, so what these tests
 * exercise is what a user exercises.
 */

export interface TestAccount {
  email: string;
  displayName: string;
}

export const ALICE: TestAccount = { email: "alice@example.com", displayName: "אליס" };
export const BOB: TestAccount = { email: "bob@example.com", displayName: "בוב" };

/**
 * Get to the sign-in screen.
 *
 * A first visit lands on the marketing carousel; a later one goes straight to
 * sign-in. Waiting for EITHER, rather than assuming one, is what keeps this
 * from racing the first render.
 */
async function reachSignIn(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: "דלג" });
  const google = page.getByRole("button", { name: /Google/ });

  await expect(async () => {
    expect((await skip.count()) + (await google.count())).toBeGreaterThan(0);
  }).toPass({ timeout: 20_000 });

  if (await skip.count()) {
    await skip.first().click();
    await expect(google).toBeVisible({ timeout: 20_000 });
  }
}

/** Sign in as `account`, creating it in the Auth emulator on first use. */
export async function signIn(page: Page, account: TestAccount): Promise<void> {
  await page.goto("/");
  await reachSignIn(page);

  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: /Google/ }).click(),
  ]);
  await popup.waitForLoadState("domcontentloaded");

  // An account the emulator already holds is listed and can be picked; a new
  // one goes through the add form.
  const existing = popup.getByText(account.email, { exact: false }).first();
  if (await existing.count()) {
    await existing.click();
  } else {
    await popup.getByRole("button", { name: /Add new account/ }).click();
    await popup.locator("#email-input").fill(account.email);
    await popup.locator("#display-name-input").fill(account.displayName);
    await popup.getByRole("button", { name: /Sign in with Google\.com/ }).click();
  }

  await popup.waitForEvent("close", { timeout: 20_000 }).catch(() => undefined);
  await expect(page.getByRole("button", { name: /Google/ })).toHaveCount(0, {
    timeout: 20_000,
  });
}

/** Sign out through the UI, the way a user does. */
export async function signOut(page: Page): Promise<void> {
  await page.goto("/settings/profile");
  await page.getByRole("button", { name: "התנתקות" }).first().click();
  // The confirmation dialog repeats the label on its confirm button.
  await page.getByRole("button", { name: "התנתקות" }).last().click();
  await expect(page.getByRole("button", { name: /Google/ })).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * The id of a user's first vehicle.
 *
 * Polled: `createVehicle` returns when the UI shows the vehicle, which means
 * the local cache has it — the server may not yet, and a REST read straight
 * after can legitimately miss it. That is the same
 * accepted-locally-vs-acknowledged distinction the app itself is careful about,
 * so the test has to be careful about it too.
 */
export async function firstVehicleId(uid: string, timeoutMs = 15_000): Promise<string> {
  const { listDocuments } = await import("./emulator");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const vehicles = await listDocuments(`users/${uid}/vehicles`);
    if (vehicles.length > 0) return vehicles[0].id;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`no vehicle appeared for ${uid} within ${timeoutMs}ms`);
}

export async function uidOf(account: TestAccount): Promise<string> {
  const uid = await uidForEmail(account.email);
  if (!uid) throw new Error(`no emulator account for ${account.email}`);
  return uid;
}

/* ------------------------------------------------------------------ *
 * Vehicles and fill-ups, through the UI
 * ------------------------------------------------------------------ */

/** Create a vehicle by the manual path — no registry call, so no network. */
/** The wizard shows the long labels; tests name the fuel type by its key. */
const FUEL_LABEL = {
  "95": "בנזין 95 אוקטן",
  "98": "בנזין 98 אוקטן",
  diesel: "סולר",
  other: "אחר",
} as const;

export type TestFuelType = keyof typeof FUEL_LABEL;

export async function createVehicle(
  page: Page,
  {
    make,
    model,
    fuelType = "95",
  }: { make: string; model: string; fuelType?: TestFuelType },
): Promise<void> {
  await page.goto("/vehicles/new");
  await page.getByRole("button", { name: /הזנה ידנית/ }).click();

  await page.getByLabel("יצרן", { exact: true }).fill(make);
  await page.getByLabel("דגם", { exact: true }).fill(model);
  await page.getByRole("button", { name: FUEL_LABEL[fuelType], exact: true }).click();

  await page.getByRole("button", { name: "המשך", exact: true }).click();
  await page.getByRole("button", { name: "שמירת הרכב" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(\?.*)?$/, { timeout: 25_000 });

  // Landing on Home is not the same as the vehicle being active. Wait for the
  // header to name it, which is the signal the rest of the app also waits for
  // — otherwise the fill-up form renders its "no vehicle" state.
  await expect(page.getByText(`${make} ${model}`, { exact: false }).first()).toBeVisible({
    timeout: 25_000,
  });
}

export interface FillupInput {
  odometer: number;
  liters: number;
  pricePerLiter?: number;
  /** Declare undocumented fill-ups before this record. */
  continuityBreak?: boolean;
  /** "YYYY-MM-DD", typed into the date field. */
  date?: string;
  /** "HH:MM", typed into the time field. */
  time?: string;
}

/** Add a fill-up through the real form. Returns the toast title it produced. */
export async function addFillup(page: Page, input: FillupInput): Promise<string> {
  await page.goto("/fillup/new");

  if (input.date || input.time) {
    await page.getByRole("button", { name: /תאריך ושעה/ }).first().click();
    if (input.date) {
      const field = page.getByLabel("תאריך — הקלדה ידנית");
      await field.fill(input.date);
      await field.press("Enter");
    }
    if (input.time) {
      const field = page.getByLabel("שעה — הקלדה ידנית");
      await field.fill(input.time);
      await field.press("Enter");
    }
    // "אישור" exactly — the sheet's backdrop is also a button, labelled
    // "סגירה", and it sits over everything.
    await page.getByRole("button", { name: "אישור", exact: true }).click();
  }

  // The odometer label changes to "קילומטראז׳ בתאריך זה" for a backdated record.
  await page.getByLabel(/^קילומטראז׳/).fill(String(input.odometer));
  await page.getByLabel("ליטרים", { exact: true }).fill(String(input.liters));

  if (input.pricePerLiter !== undefined) {
    await page.getByLabel("מחיר לליטר").fill(String(input.pricePerLiter));
  }

  // No full-tank toggle any more: a manual entry IS a full tank. A partial
  // record can only arrive by import, so tests that need one seed it.

  if (input.continuityBreak) {
    await page
      .getByRole("switch", { name: "היו תדלוקים שלא תיעדתי מאז הרשומה הקודמת" })
      .click();
  }

  await page.getByRole("button", { name: "שמירת תדלוק" }).click();

  const toast = page.locator("[data-toast-title]").first();
  await expect(toast).toBeVisible({ timeout: 20_000 });
  const title = (await toast.innerText()).trim();

  // The form navigates home on save, but the record is only in the app's list
  // once the Firestore listener has delivered it. Adding another fill-up
  // before that happens makes the engine evaluate the new draft against a
  // history that is missing the previous one — a test artefact, not a bug,
  // but one that produces a confusingly wrong message.
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(\?.*)?$/, { timeout: 20_000 });
  await expect(
    page.getByText(new RegExp(`${input.liters.toFixed(1).replace(".", "\\.")}\\s*ל׳`)).first(),
  ).toBeVisible({ timeout: 20_000 });

  return title;
}

/* ------------------------------------------------------------------ *
 * A signed-in account with data, in one step
 * ------------------------------------------------------------------ */

export interface ReadyAccount {
  uid: string;
  vehicleId: string;
}

/**
 * Reset, sign in, and put a vehicle and its fill-ups in place.
 *
 * Sign-in goes through the real UI because that is what account handling
 * tests are about. The vehicle and the records are written straight to
 * Firestore: re-driving the fill-up form a dozen times per spec would test the
 * form over and over instead of the thing under test, and would make the suite
 * several minutes slower.
 *
 * Each test that uses this stands entirely on its own — no spec depends on
 * data another spec happened to leave behind.
 */
export async function signedInWithData(
  page: Page,
  options: {
    account?: TestAccount;
    vehicle?: SeedVehicle;
    fillups?: SeedFillup[];
    vehicleId?: string;
    /** The regulated maximum, seeded AFTER the reset so it survives. */
    regulatedPrice?: number;
  } = {},
): Promise<ReadyAccount> {
  const account = options.account ?? ALICE;
  const vehicleId = options.vehicleId ?? "v1";

  await resetEmulators();
  await signIn(page, account);
  const uid = await uidOf(account);

  if (options.regulatedPrice !== undefined) {
    await seedRegulatedPrice(options.regulatedPrice);
  }

  await seedVehicle(uid, vehicleId, options.vehicle ?? { make: "מאזדה", model: "3" });
  if (options.fillups?.length) await seedFillups(uid, vehicleId, options.fillups);
  await setActiveVehicle(uid, vehicleId);

  await page.goto("/");
  await expect(
    page.getByText(
      `${(options.vehicle ?? { make: "מאזדה" }).make}`,
      { exact: false },
    ).first(),
  ).toBeVisible({ timeout: 25_000 });

  return { uid, vehicleId };
}
