import { expect, type Page } from "@playwright/test";
import { finishFillupSave, openFillupMore, setFillupEndState } from "./fillup";
import { outboxCount } from "./pwa";
import {
  getDocument,
  listDocuments,
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
  // Exercise the real unchecked legal-consent gate before the real popup.
  // Negative-consent coverage deliberately does not use this helper.
  await page.getByTestId("signin-consent").check();

  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByTestId("signin-google").click(),
  ]);
  await completeGooglePopup(popup, account);
  await expect(page.getByRole("button", { name: /Google/ })).toHaveCount(0, {
    timeout: 20_000,
  });
}

/** Complete the Auth emulator's real Google popup, including consent-flow tests. */
export async function completeGooglePopup(popup: Page, account: TestAccount): Promise<void> {
  await popup.waitForLoadState("domcontentloaded");
  // Register before submitting: the emulator can close immediately on success.
  const popupClosed = popup.waitForEvent("close", { timeout: 20_000 }).catch(() => undefined);

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

  await popupClosed;
}

/** Sign out through the UI, the way a user does. */
export async function signOut(page: Page): Promise<void> {
  await page.goto("/account");
  await page.getByTestId("account-signout").click();
  // Stay scoped to the confirmation. A detached/reopened dialog must never
  // let the locator silently retarget the Account row with the same label.
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: /^התנתקות(?: בכל זאת)?$/ }).click();
  await expect(page.getByRole("button", { name: /Google/ })).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * The id of a user's first vehicle.
 *
 * A local or intentionally pending creation can precede server presence, so
 * this helper polls. It proves only that some first server vehicle exists;
 * it does not identify a newly added vehicle or prove active selection.
 * The online `createVehicle` fixture establishes those facts separately.
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

/** The wizard shows the long labels; tests name the fuel type by its key. */
const FUEL_LABEL = {
  "95": "בנזין 95 אוקטן",
  "98": "בנזין 98 אוקטן",
  diesel: "סולר",
  other: "אחר",
} as const;

export type TestFuelType = keyof typeof FUEL_LABEL;

/**
 * Online manual-creation fixture: no registry lookup, but real Firestore ACKs.
 * Identify this creation against the expected account's pre-existing IDs,
 * then require its exact server selection and an empty setup journal.
 * Intentionally pending creation tests drive the wizard directly.
 */
export async function createVehicle(
  page: Page,
  {
    account,
    make,
    model,
    fuelType = "95",
  }: { account: TestAccount; make: string; model: string; fuelType?: TestFuelType },
): Promise<ReadyAccount> {
  const uid = await uidOf(account);
  const previousIds = new Set((await listDocuments(`users/${uid}/vehicles`)).map(vehicle => vehicle.id));
  await page.goto("/vehicles/new");
  await page.getByTestId("wizard-manual").click();

  await page.getByTestId("wizard-make").fill(make);
  await page.getByTestId("wizard-model").fill(model);
  await page.getByTestId(`wizard-fuel-${fuelType}`).check();

  await page.getByTestId("wizard-confirm-next").click();
  await page.getByTestId("wizard-save").click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(\?.*)?$/, { timeout: 25_000 });

  // Landing on Home is not the same as the vehicle being active. Wait for the
  // header to name it, which is the signal the rest of the app also waits for
  // — otherwise the fill-up form renders its "no vehicle" state.
  await expect(page.getByText(`${make} ${model}`, { exact: false }).first()).toBeVisible({
    timeout: 25_000,
  });

  let additions: Awaited<ReturnType<typeof listDocuments>> = [];
  await expect.poll(async () => {
    additions = (await listDocuments(`users/${uid}/vehicles`)).filter(vehicle => !previousIds.has(vehicle.id));
    return additions.length;
  }, { timeout: 20_000 }).toBe(1);
  const [created] = additions;
  expect(created.data).toMatchObject({ make, model, fuelType });
  const scope = { uid, vehicleId: created.id };
  await waitForVehicleSelection(scope);
  await expect.poll(() => outboxCount(page, uid), { timeout: 20_000 }).toBe(0);
  return scope;
}

/** A momentary empty journal cannot prove the later selection was acknowledged. */
export async function waitForVehicleSelection({ uid, vehicleId }: ReadyAccount): Promise<void> {
  await expect.poll(async () => {
    const profile = await getDocument(`users/${uid}`);
    return (profile?.settings as Record<string, unknown> | undefined)?.activeVehicleId;
  }, { timeout: 20_000 }).toBe(vehicleId);
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
  /**
   * Whether to confirm "מילאתי עד הסוף".
   *
   * Defaults to true because most of the suite is about the consumption
   * engine, which needs a confirmed full endpoint. The default is deliberately
   * NOT the app's: a record nobody says anything about is `unknown`, and that
   * is exactly what `"unknown"` here exercises.
   */
  fillEndState?: "full" | "unknown";
}

/** Add through the real form and Saved screen. Returns its canonical summary. */
export async function addFillup(page: Page, input: FillupInput, scope: ReadyAccount): Promise<string> {
  const collectionPath = `users/${scope.uid}/vehicles/${scope.vehicleId}/fillups`;
  const existingIds = new Set((await listDocuments(collectionPath)).map((record) => record.id));
  await page.goto("/fillup/new");

  if (input.date || input.time) {
    await page.getByTestId("fillup-date").click();
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

  await page.getByTestId("fillup-odometer").fill(String(input.odometer));
  await page.getByTestId("fillup-liters").fill(String(input.liters));

  if (input.pricePerLiter !== undefined) {
    await page.getByTestId("fillup-price").fill(String(input.pricePerLiter));
  }

  // A full tank remains an explicit statement. Visible primary choices do
  // not select anything until the driver answers.
  if ((input.fillEndState ?? "full") === "full") {
    await setFillupEndState(page, "full");
  }

  if (input.continuityBreak) {
    await openFillupMore(page);
    await page
      .getByRole("switch", { name: "פספסתי תדלוקים לפני זה" })
      .click();
  }

  // This online helper checks the canonical saved calculation. Its immutable
  // snapshot needs the loaded history; offline/rejected-write cases use their
  // own helpers and must remain able to save while history is unavailable.
  const preview = page.getByTestId("fillup-live-preview");
  await expect(preview).toBeVisible();
  await expect(preview).not.toContainText("ההיסטוריה לא זמינה במלואה לחישוב");
  await page.getByTestId("fillup-save").click();
  const summary = await finishFillupSave(page);

  // The Saved screen acknowledges the local journal. Neither an old row with the
  // same liters nor a temporarily absent pending badge proves this new write
  // reached the server. Before a caller's goto() tears down the page, require
  // the new document in a server read AND its exact row in the live list.
  // Offline/rejected-write tests use their own helpers.
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(\?.*)?$/, { timeout: 20_000 });
  let saved: { id: string; data: Record<string, unknown> } | undefined;
  await expect(async () => {
    saved = (await listDocuments(collectionPath)).find((record) =>
      !existingIds.has(record.id) && record.data.odometer === input.odometer);
    expect(saved?.data).toMatchObject({
      odometer: input.odometer,
      liters: input.liters,
      continuityBreakBefore: input.continuityBreak ?? false,
    });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId(`journal-entry-fillups/${saved!.id}`)).toBeVisible({ timeout: 20_000 });

  return summary;
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

  // Auth completion precedes the first profile write. Seed preferences only
  // after that write reaches the server, or its defaults can overwrite them.
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings,
    { timeout: 15_000 }).toBeTruthy();

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
