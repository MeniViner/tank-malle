import { test, expect, type Page } from "@playwright/test";
import {
  getDocument,
  resetEmulators,
  seedFillups,
  seedVehicle,
  setActiveVehicle,
} from "./helpers/emulator";
import {
  ALICE,
  BOB,
  createVehicle,
  firstVehicleId,
  signIn,
  signOut,
  uidOf,
} from "./helpers/app";

/**
 * Account isolation.
 *
 * The reported bug was that switching Google accounts left the app showing the
 * previous account's data until browser cookies and site data were cleared by
 * hand. These tests hold the app to the stronger promise: no frame may ever
 * display data belonging to the account that just signed out.
 */

test.describe.configure({ mode: "serial" });

/**
 * Watch every animation frame for a forbidden string.
 *
 * Asserting on the settled state would miss the actual failure mode, which is
 * a flash of the previous account's data during the handover. This polls the
 * DOM continuously and records anything it sees.
 */
async function watchForLeak(page: Page, forbidden: string[]): Promise<void> {
  await page.evaluate((needles) => {
    const seen = new Set<string>();
    (window as unknown as { __leaks: string[] }).__leaks = [];
    const check = () => {
      const text = document.body?.innerText ?? "";
      for (const needle of needles) {
        if (text.includes(needle) && !seen.has(needle)) {
          seen.add(needle);
          (window as unknown as { __leaks: string[] }).__leaks.push(needle);
        }
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, forbidden);
}

async function leaks(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __leaks?: string[] }).__leaks ?? [],
  );
}

test("A → B → A never shows the other account's data", async ({ page }) => {
  await resetEmulators();

  // Alice signs in and gets a distinctive vehicle.
  await signIn(page, ALICE);
  await createVehicle(page, { make: "מאזדה", model: "3" });
  const aliceUid = await uidOf(ALICE);
  await seedFillups(aliceUid, await firstVehicleId(aliceUid), [
    { id: "a1", date: new Date(2026, 0, 5), odometer: 111111, liters: 40 },
  ]);
  await page.goto("/");
  await expect(page.getByText("מאזדה 3", { exact: false }).first()).toBeVisible();

  // Sign out, then watch every frame while Bob signs in.
  await signOut(page);
  await watchForLeak(page, ["מאזדה", "111,111"]);

  await signIn(page, BOB);
  await createVehicle(page, { make: "יונדאי", model: "i20" });
  await page.goto("/");
  await expect(page.getByText("יונדאי i20", { exact: false }).first()).toBeVisible();

  // Bob must never have seen Alice's vehicle or odometer, at any frame.
  expect(await leaks(page)).toEqual([]);
  await expect(page.getByText("מאזדה")).toHaveCount(0);

  // Back to Alice: her data returns, Bob's is gone.
  await signOut(page);
  await watchForLeak(page, ["יונדאי", "i20"]);
  await signIn(page, ALICE);
  await page.goto("/");
  await expect(page.getByText("מאזדה 3", { exact: false }).first()).toBeVisible();
  expect(await leaks(page)).toEqual([]);
});

test("an account with vehicles → an account with none shows the empty state", async ({
  page,
}) => {
  await resetEmulators();

  await signIn(page, ALICE);
  await createVehicle(page, { make: "מאזדה", model: "3" });
  await signOut(page);

  await signIn(page, BOB);
  // No vehicle at all: the app must ask for one, not inherit Alice's.
  await expect(page.getByText("מאזדה")).toHaveCount(0);
  await expect(
    page.getByText(/מה מספר הרכב|הוספת רכב|רכב/).first(),
  ).toBeVisible({ timeout: 20_000 });
});

test("an account with no vehicles → an account with vehicles loads them", async ({
  page,
}) => {
  await resetEmulators();

  await signIn(page, BOB);
  await signOut(page);

  await signIn(page, ALICE);
  await createVehicle(page, { make: "מאזדה", model: "3" });
  await page.goto("/");
  await expect(page.getByText("מאזדה 3", { exact: false }).first()).toBeVisible();
});

test("rapid switching settles on the account that signed in last", async ({ page }) => {
  await resetEmulators();

  await signIn(page, ALICE);
  await createVehicle(page, { make: "מאזדה", model: "3" });

  for (let round = 0; round < 2; round += 1) {
    await signOut(page);
    await signIn(page, BOB);
    await signOut(page);
    await signIn(page, ALICE);
  }

  await page.goto("/");
  await expect(page.getByText("מאזדה 3", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("יונדאי")).toHaveCount(0);
});

test("a second tab does not keep the previous account's listeners alive", async ({
  browser,
}) => {
  await resetEmulators();

  const context = await browser.newContext({ locale: "he-IL" });
  const first = await context.newPage();

  await signIn(first, ALICE);
  await createVehicle(first, { make: "מאזדה", model: "3" });

  // A second tab in the SAME context shares auth and the Firestore cache.
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.getByText("מאזדה 3", { exact: false }).first()).toBeVisible({
    timeout: 25_000,
  });

  // Sign out in tab one, sign in as Bob, and give tab two a fresh load.
  await signOut(first);
  await signIn(first, BOB);
  await createVehicle(first, { make: "יונדאי", model: "i20" });

  await second.reload();
  await expect(second.getByText("יונדאי i20", { exact: false }).first()).toBeVisible({
    timeout: 25_000,
  });
  // The listener from the first account must not still be feeding this tab.
  await expect(second.getByText("מאזדה")).toHaveCount(0);

  await context.close();
});

/* ------------------------------------------------------------------ *
 * Previous login
 * ------------------------------------------------------------------ */

test("a refresh does not invent a new previous login", async ({ page }) => {
  await resetEmulators();

  await signIn(page, ALICE);
  // Without a vehicle the app holds the user in the first-run wizard, so the
  // profile screen is not reachable.
  await createVehicle(page, { make: "מאזדה", model: "3" });
  const uid = await uidOf(ALICE);

  await page.goto("/settings/profile");
  // The very first sign-in has no predecessor, and says so rather than
  // showing the current session. (The profile was rebuilt in 7a72538; this
  // is its wording.)
  await expect(page.getByText("זו ההתחברות הראשונה")).toBeVisible({ timeout: 20_000 });

  const afterSignIn = await getDocument(`users/${uid}`);
  const firstAuthTime = afterSignIn?.lastProcessedAuthTime;
  expect(typeof firstAuthTime).toBe("number");

  // Three reloads within the same authentication event.
  for (let i = 0; i < 3; i += 1) {
    await page.reload();
    await page.waitForTimeout(600);
  }

  const afterReloads = await getDocument(`users/${uid}`);
  expect(afterReloads?.lastProcessedAuthTime).toBe(firstAuthTime);
  expect(afterReloads?.previousLoginAt ?? null).toBeNull();

  await page.goto("/settings/profile");
  await expect(page.getByText("זו ההתחברות הראשונה")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("עכשיו")).toHaveCount(0);
});

test("previous login advances only after a genuine new authentication", async ({
  page,
}) => {
  await resetEmulators();

  await signIn(page, ALICE);
  await createVehicle(page, { make: "מאזדה", model: "3" });
  const uid = await uidOf(ALICE);
  const first = await getDocument(`users/${uid}`);
  const firstLogin = first?.currentLoginAt as number;
  expect(typeof firstLogin).toBe("number");

  // A real sign-out and sign-in is a new authentication event.
  await signOut(page);
  await page.waitForTimeout(1200);
  await signIn(page, ALICE);
  await page.waitForTimeout(1500);

  const second = await getDocument(`users/${uid}`);
  expect(second?.previousLoginAt).toBe(firstLogin);
  expect(second?.currentLoginAt).not.toBe(firstLogin);

  await page.goto("/settings/profile");
  // The rebuilt profile (7a72538) words the previous login as "נכנס לאחרונה …".
  const row = page.getByText(/נכנס לאחרונה/);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(/היום|אתמול|\d/);
  await expect(page.getByText("זו ההתחברות הראשונה")).toHaveCount(0);
});

// Keep the seeding helpers referenced so the import is not stripped.
void seedVehicle;
void setActiveVehicle;
