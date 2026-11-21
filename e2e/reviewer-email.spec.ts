import { test, expect, type Page } from "@playwright/test";
import { AUTH_HOST, PROJECT_ID, resetEmulators, getDocument } from "./helpers/emulator";
import { createVehicle, signOut } from "./helpers/app";

const email = "reviewer@example.test";
const password = "Local-Review-Password-123!";

async function seedPasswordAccount(address = email) {
  if (!AUTH_HOST.startsWith("http://127.0.0.1:")) throw new Error("local-only test");
  const response = await fetch(`${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-test`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: address, password, returnSecureToken: true }),
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<{ localId: string; idToken: string }>;
}

async function openEmail(page: Page) {
  await page.goto("/");
  const skip = page.getByRole("button", { name: "דלג", exact: true });
  await expect(async () => expect((await skip.count()) + (await page.getByTestId("signin").count())).toBeGreaterThan(0)).toPass();
  if (await skip.count()) await skip.click();
  await page.getByTestId("signin-email-toggle").click();
}

async function login(page: Page, address = email) {
  await openEmail(page);
  await page.getByTestId("signin-consent").check();
  await page.getByRole("textbox", { name: "אימייל", exact: true }).fill(address);
  await page.getByLabel("סיסמה", { exact: true }).fill(password);
  await page.getByTestId("signin-email-submit").click();
  await expect(page.getByTestId("signin")).toHaveCount(0);
}

test("email login requires consent, rejects wrong credentials, and persists the actual account", async ({ page }) => {
  await resetEmulators();
  await seedPasswordAccount();
  await openEmail(page);
  await page.getByRole("textbox", { name: "אימייל", exact: true }).fill(email);
  await page.getByLabel("סיסמה", { exact: true }).fill("wrong-password");
  await page.getByTestId("signin-email-submit").click();
  await expect(page.getByTestId("signin-consent-error")).toBeVisible();
  await page.getByTestId("signin-consent").check();
  await page.getByTestId("signin-email-submit").click();
  await expect(page.getByTestId("signin-auth-error")).toContainText("האימייל או הסיסמה אינם נכונים");
  await expect(page.getByLabel("סיסמה", { exact: true })).toHaveValue("");
  await page.getByLabel("סיסמה", { exact: true }).fill(password);
  await page.getByTestId("signin-email-submit").click();
  await expect(page.getByTestId("signin")).toHaveCount(0);
  await createVehicle(page, { account: { email, displayName: "Reviewer" }, make: "בדיקת כניסה", model: "מקומית" });
  await page.reload();
  await expect(page.getByTestId("signin")).toHaveCount(0);
  await page.goto("/account");
  await expect(page.getByTestId("account-page")).toBeVisible();
});

test("switching password accounts does not reveal the previous vehicle", async ({ page }) => {
  await resetEmulators();
  await seedPasswordAccount();
  await seedPasswordAccount("second@example.test");
  await login(page);
  await createVehicle(page, { account: { email, displayName: "Reviewer" }, make: "רכב סודי", model: "של ראשון" });
  await signOut(page);
  await login(page, "second@example.test");
  await page.goto("/account");
  await expect(page.getByTestId("account-page")).toBeVisible();
  await expect(page.getByText("רכב סודי", { exact: false })).toHaveCount(0);
});

test("password account deletion authenticates before deleting any user data", async ({ page }) => {
  await resetEmulators();
  const account = await seedPasswordAccount();
  await login(page);
  await page.goto("/account?delete=1");
  await page.getByRole("alertdialog").getByRole("button", { name: "המשך למחיקה", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "כן, מחקו הכול", exact: true }).click();
  await expect(page.getByText("יש להזין את הסיסמה לאישור המחיקה", { exact: true })).toBeVisible();
  await page.getByLabel("סיסמה לאישור המחיקה", { exact: true }).fill("wrong-password");
  await page.getByRole("alertdialog").getByRole("button", { name: "כן, מחקו הכול", exact: true }).click();
  await expect(page.getByText("נדרשת התחברות מחדש לפני המחיקה", { exact: true })).toBeVisible();
  expect(await getDocument(`users/${account.localId}`)).not.toBeNull();
  await page.getByTestId("account-delete").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "המשך למחיקה", exact: true }).click();
  await page.getByLabel("סיסמה לאישור המחיקה", { exact: true }).fill(password);
  await page.getByRole("alertdialog").getByRole("button", { name: "כן, מחקו הכול", exact: true }).click();
  await expect(page.getByTestId("signin")).toBeVisible();
  expect(await getDocument(`users/${account.localId}`)).toBeNull();
  const rejected = await fetch(`${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-test`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  expect(rejected.ok).toBe(false);
  expect(PROJECT_ID).toBe("demo-tankmaleh");
});
