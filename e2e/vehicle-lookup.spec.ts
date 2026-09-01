import { test, expect, type Page } from "@playwright/test";
import { resetEmulators } from "./helpers/emulator";
import { ALICE, signIn } from "./helpers/app";

/**
 * Vehicle lookup, with the government registry intercepted.
 *
 * The whole point of this workstream is that an external-service failure is
 * NEVER reported as "this vehicle does not exist". Each test replaces the
 * data.gov.il response with one specific kind of failure and checks which of
 * the three outcomes the UI reports.
 */

test.describe.configure({ mode: "serial" });

const PLATE = "12345678";
const CKAN = "**/api/3/action/datastore_search**";

const RECORD = {
  mispar_rechev: 12_345_678,
  tozeret_nm: "מאזדה יפן",
  kinuy_mishari: "3",
  shnat_yitzur: 2018,
  sug_delek_nm: "בנזין",
  tozeret_cd: 123,
  degem_cd: 456,
};

/** Type the plate on the wizard's keypad and search. */
async function lookUp(page: Page): Promise<void> {
  await page.goto("/vehicles/new");
  for (const digit of PLATE) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "אתר רכב" }).click();
}

test.beforeEach(async ({ page }) => {
  await resetEmulators();
  await signIn(page, ALICE);
  // Nothing here should ever reach the real registry.
  await page.route("**/data.gov.il/**", (route) => route.abort());
});

test("a match fills the vehicle in", async ({ page }) => {
  await page.route(CKAN, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, result: { records: [RECORD] } }),
    }),
  );

  await lookUp(page);
  await expect(page.getByLabel("יצרן", { exact: true })).toHaveValue("מאזדה", {
    timeout: 25_000,
  });
  await expect(page.getByLabel("דגם", { exact: true })).toHaveValue("3");
});

test("a confirmed empty result says the vehicle was not found", async ({ page }) => {
  await page.route(CKAN, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, result: { records: [] } }),
    }),
  );

  await lookUp(page);
  await expect(page.getByText("הרכב לא נמצא במאגרים שנבדקו", { exact: false })).toBeVisible({
    timeout: 25_000,
  });
  // A confirmed miss is not retryable — there is nothing to retry.
  await expect(page.getByRole("button", { name: "נסו שוב" })).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * Each of these used to surface as "the vehicle does not exist".
 * ------------------------------------------------------------------ */

const OUTAGES: { name: string; fulfil: Parameters<Page["route"]>[1] }[] = [
  {
    name: "an HTTP 503",
    fulfil: (route) => route.fulfill({ status: 503, body: "" }),
  },
  {
    name: "a malformed payload",
    fulfil: (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{ this is not json",
      }),
  },
  {
    name: "success: false",
    fulfil: (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: { message: "nope" } }),
      }),
  },
  {
    name: "a missing result structure",
    fulfil: (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      }),
  },
  {
    name: "an HTML page served with a JSON content type",
    fulfil: (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "<!doctype html><html><body>app shell</body></html>",
      }),
  },
  {
    name: "a row for a different plate than the one requested",
    fulfil: (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          result: { records: [{ ...RECORD, mispar_rechev: 99_999_999 }] },
        }),
      }),
  },
  {
    name: "a network failure",
    fulfil: (route) => route.abort("failed"),
  },
];

for (const outage of OUTAGES) {
  test(`${outage.name} is reported as temporarily unavailable, not as not-found`, async ({
    page,
  }) => {
    await page.route(CKAN, outage.fulfil);
    await lookUp(page);

    await expect(page.getByText("מאגר משרד התחבורה אינו זמין כרגע", { exact: false })).toBeVisible({
      timeout: 30_000,
    });
    // The distinction that matters.
    await expect(page.getByText("הרכב לא נמצא במאגרים שנבדקו")).toHaveCount(0);
    // A temporary failure IS retryable, and says so.
    await expect(page.getByRole("button", { name: "נסו שוב" })).toBeVisible();
  });
}

test("a partial sweep — one dataset fails, the rest are empty — is not 'not found'", async ({
  page,
}) => {
  let call = 0;
  await page.route(CKAN, (route) => {
    call += 1;
    // The private-vehicle dataset, which holds most cars, is the one failing.
    if (call <= 2) return route.fulfill({ status: 503, body: "" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, result: { records: [] } }),
    });
  });

  await lookUp(page);
  await expect(page.getByText("מאגר משרד התחבורה אינו זמין כרגע", { exact: false })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("הרכב לא נמצא במאגרים שנבדקו")).toHaveCount(0);
});

test("a previously found vehicle is offered from cache when the registry is down", async ({
  page,
}) => {
  // First, a successful lookup that populates the last-known-good cache.
  await page.route(CKAN, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, result: { records: [RECORD] } }),
    }),
  );
  await lookUp(page);
  await expect(page.getByLabel("יצרן", { exact: true })).toHaveValue("מאזדה", {
    timeout: 25_000,
  });

  // Now the registry goes down for the SAME plate.
  await page.unroute(CKAN);
  await page.route(CKAN, (route) => route.abort("failed"));

  await lookUp(page);
  await expect(
    page.getByText("מוצגים הפרטים שנמצאו בבדיקה הקודמת", { exact: false }),
  ).toBeVisible({ timeout: 30_000 });
  // And the cached details are actually offered, not merely mentioned.
  await expect(page.getByLabel("יצרן", { exact: true })).toHaveValue("מאזדה");
});

test("manual entry is always available, whatever the registry does", async ({ page }) => {
  await page.route(CKAN, (route) => route.abort("failed"));
  await page.goto("/vehicles/new");
  await page.getByRole("button", { name: /הזנה ידנית/ }).click();
  await expect(page.getByLabel("יצרן", { exact: true })).toBeVisible();
});
