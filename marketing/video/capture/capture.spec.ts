import { expect, test, type Page } from "@playwright/test";
import { resetEmulators } from "../../../e2e/helpers/emulator";

const OUT = "marketing/video/assets/screens";

// The demo banner explains sample data inside the app; it is hidden only in these captures.
const EMAIL = "demo@example.com", PASSWORD = "demo-pass-123";

// Google sign-in needs an external host that this environment blocks, so the emulator
// account signs in with email and password instead.
async function signIn(page: Page) {
  await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, displayName: "דמו", returnSecureToken: true }),
  });
  await page.goto("/");
  const skip = page.getByRole("button", { name: "דלג" });
  await page.getByTestId("signin-google").or(skip.first()).waitFor();
  if (await skip.count()) await skip.first().click();
  await page.getByTestId("signin-consent").check();
  await page.getByTestId("signin-email-toggle").click();
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByTestId("signin-email-submit").click();
  await expect(page.getByTestId("signin")).toHaveCount(0);
}

async function clean(page: Page) {
  await page.addStyleTag({ content: '[data-testid="demo-banner"]{display:none!important}' });
  await page.waitForTimeout(600);
}

test("capture demo screens", async ({ page }) => {
  await resetEmulators();
  await signIn(page);
  await page.getByTestId("demo-start").click();
  await page.getByTestId("demo-start-fuel").click();
  await expect(page.getByTestId("home-facts")).toBeVisible();

  // Fill the yearly documents the way a user would, so the cost covers insurance and the test.
  // The demo's own insurance and licence expenses (4,600 + 1,450) are split the same way.
  await page.getByTestId("tco-card").first().click();
  for (const [part, due, cost] of [["mandatory", "15/06/2027", "1500"], ["coverage", "15/06/2027", "3100"], ["test", "20/09/2027", "1450"]] as const) {
    await page.getByTestId(`tco-part-${part}`).click();
    const form = page.getByTestId("vehicle-doc-form");
    await expect(form).toBeVisible();
    if (part === "coverage") await form.getByRole("radio", { name: "מקיף" }).or(form.getByRole("button", { name: "מקיף" })).first().click();
    await form.locator("#vehicle-doc-due").fill(due);
    await page.getByTestId("vehicle-doc-cost").fill(cost);
    await page.getByTestId("vehicle-doc-save").click();
    await expect(form).toHaveCount(0);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  await clean(page);
  await page.screenshot({ path: `${OUT}/home.png` });
  const card = page.getByTestId("tco-card").first();
  await card.scrollIntoViewIfNeeded();
  await clean(page);
  await page.screenshot({ path: `${OUT}/home-tco.png` });
  await card.screenshot({ path: `${OUT}/tco-card.png` });
  console.log("TCO card:", (await card.innerText()).replace(/\s+/g, " "));

  await card.click();
  const sheet = page.getByTestId("tco-sheet");
  if (await sheet.count() === 0) await page.getByTestId("tco-details").click().catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/tco-sheet.png` });
  if (await sheet.count()) console.log("TCO sheet:", (await sheet.innerText()).replace(/\s+/g, " "));
  await page.keyboard.press("Escape");

  await page.goto("/vehicle");
  await clean(page);
  await page.screenshot({ path: `${OUT}/vehicle.png` });
  await page.getByTestId("vehicle-business-statement").click();
  const statement = page.getByTestId("business-statement");
  await expect(statement).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/business-statement.png` });
  console.log("Statement:", (await statement.innerText()).replace(/\s+/g, " ").slice(0, 600));
  await page.keyboard.press("Escape");

  await page.goto("/fillup/new");
  await clean(page);
  await page.screenshot({ path: `${OUT}/fillup.png` });
});
