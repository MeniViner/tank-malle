import { expect, test, type Page } from "@playwright/test";
import { getDocument, listDocuments, resetEmulators } from "./helpers/emulator";
import { ALICE, signIn, uidOf } from "./helpers/app";

/**
 * Design v3 Stage 5 entry: the four car-cost onboarding slides (artwork built
 * from the real components, inert and hidden from assistive technology), the
 * new sign-in headline, and the EV rows on the wizard's confirm step.
 */

test.use({ serviceWorkers: "block" });

const SLIDES = ["כמה הרכב באמת עולה לך", "כל רישום ב־15 שניות", "צריכה אמיתית, לא הבטחות", "שום דבר לא נופל בין הכיסאות"];

test("onboarding: four slides with inert real-component artwork, then the v3 sign-in headline", async ({ page }) => {
  await resetEmulators();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const progress = page.getByRole("progressbar", { name: "היכרות עם טנק מלא" });
  await expect(progress).toHaveAttribute("aria-valuemax", "4");
  const demos = ["[data-testid=tco-card]", ".entry-pump-art", ".entry-consumption-number", "[data-testid=spotlight-card]"];
  for (let slide = 1; slide <= 4; slide++) {
    await expect(page.getByTestId("onboarding-slide")).toHaveAttribute("data-slide", String(slide));
    await expect(progress).toHaveAttribute("aria-valuenow", String(slide));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SLIDES[slide - 1]);
    const demo = page.getByTestId("onboarding-art-demo");
    await expect(demo).toHaveAttribute("aria-hidden", "true");
    await expect(demo).toHaveAttribute("inert", "");
    await expect(page.getByTestId("onboarding-art-text")).toContainText("נתונים לדוגמה");
    await expect(demo.locator(demos[slide - 1]).first()).toBeVisible();
    // Nothing inside the artwork is focusable or exposed to assistive technology.
    expect(await demo.evaluate(node => [...node.querySelectorAll("button, a, input")].every(el => el.closest("[inert]") === node))).toBe(true);
    await expect(page.getByRole("button", { name: "כמה הרכב עולה לך" })).toHaveCount(0);
    expect(await page.evaluate(() => [...document.querySelectorAll(".entry-art *")]
      .every(el => { const style = getComputedStyle(el); return style.animationName === "none" && (style.transitionDuration === "0s" || style.transitionDuration === ""); }))).toBe(true);
    if (slide === 1) {
      await expect(demo.getByTestId("tco-legend")).toContainText("דלק");
      await expect(demo.getByTestId("tco-legend")).toContainText("טסט ואגרת רישוי");
    }
    if (slide === 2) await expect(demo.locator(".entry-pump-art .tm-pump-line")).toHaveCount(2);
    if (slide === 3) await expect(demo.locator(".entry-consumption-number")).toContainText("12.8");
    if (slide === 4) await expect(demo.getByTestId("tank-hero")).toContainText("בעוד");
    await page.getByTestId("onboarding-next").click();
  }
  await expect(page.getByTestId("signin")).toBeVisible();
  await expect(page.getByTestId("signin-title")).toHaveText("כל מה שהרכב עולה. במקום אחד.");
  expect(await page.evaluate(() => localStorage.getItem("tm.onboarded"))).toBe("1");
});

const CKAN = "**/api/3/action/datastore_search**";
const WLTP_RESOURCE = "142afde2-6228-49f9-8a29-9b6c3a0cbe40";
/** Synthetic plate, real BYD Atto 3 model codes (as in EV-AUDIT.md). */
const PLATE = "52839102";
const EV_PLATE_ROW = { mispar_rechev: 52_839_102, tozeret_nm: "BYD", kinuy_mishari: "ATTO 3", shnat_yitzur: 2024, sug_delek_nm: "חשמל", tozeret_cd: 1014, degem_cd: 3 };
const EV_WLTP_ROW = { tozeret_cd: 1014, degem_cd: 3, shnat_yitzur: 2024, delek_nm: "חשמל", technologiat_hanaa_nm: "רכב חשמלי", koah_sus: 204, merkav: "SUV", nefah_manoa: null, kinuy_mishari: "ATTO 3" };

async function stubEvRegistry(page: Page) {
  await page.route("**/data.gov.il/**", route => route.abort());
  await page.route(CKAN, route => {
    const resource = new URL(route.request().url()).searchParams.get("resource_id");
    const records = resource === WLTP_RESOURCE ? [EV_WLTP_ROW] : [EV_PLATE_ROW];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, result: { records } }) });
  });
}

test("EV plate: confirm step shows powertrain, motor kW and optional battery inputs; exact values persist and no tank is asked", async ({ page }) => {
  await resetEmulators();
  await signIn(page, ALICE);
  const uid = await uidOf(ALICE);
  await stubEvRegistry(page);
  await page.goto("/vehicles/new");
  for (const digit of PLATE) await page.getByTestId(`wizard-key-${digit}`).click();
  await page.getByTestId("wizard-lookup").click();

  await expect(page.getByTestId("wizard-make-value")).toHaveText("BYD", { timeout: 25_000 });
  await expect(page.getByTestId("wizard-powertrain-value")).toHaveText("חשמלי");
  await expect(page.getByTestId("wizard-motor-value")).toHaveText("150 kW");
  await expect(page.getByTestId("wizard-ev-note")).toContainText("קיבולת הסוללה וטווח היצרן");
  await expect(page.getByText("סוג דלק")).toHaveCount(0);

  const kwh = page.getByRole("textbox", { name: "קיבולת סוללה" });
  const wltp = page.getByRole("textbox", { name: "טווח יצרן (WLTP)" });
  await expect(kwh).toHaveValue("");
  await kwh.fill("600");
  await page.getByTestId("wizard-confirm-next").click();
  await expect(page.getByRole("alert")).toContainText("קיבולת בין 0.1 ל־500 kWh");
  await expect(kwh).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("vehicle-wizard")).toHaveAttribute("data-step", "confirm");

  await kwh.fill("60.48");
  await wltp.fill("420");
  await page.getByTestId("wizard-confirm-next").click();
  await expect(page.getByRole("heading", { name: "עוד פרט אחד" })).toBeVisible();
  await expect(page.getByTestId("wizard-tank")).toHaveCount(0);
  await expect(page.getByTestId("wizard-declared")).toHaveCount(0);
  await page.getByTestId("wizard-save").click();

  await expect.poll(async () => (await listDocuments(`users/${uid}/vehicles`)).length, { timeout: 15_000 }).toBe(1);
  const [{ id }] = await listDocuments(`users/${uid}/vehicles`);
  await expect.poll(async () => (await getDocument(`users/${uid}/vehicles/${id}`))?.battery, { timeout: 15_000 }).toEqual({ kwh: 60.48, wltp: 420 });
  const stored = await getDocument(`users/${uid}/vehicles/${id}`);
  expect(stored).toMatchObject({ make: "BYD", fuelType: "other", powertrain: "ev", motorKw: 150, tankLiters: null, declaredKmPerLiter: null });
});

test("manual entry offers an electric drivetrain without tank fields; blank battery stays optional", async ({ page }) => {
  await resetEmulators();
  await signIn(page, ALICE);
  const uid = await uidOf(ALICE);
  await page.route("**/data.gov.il/**", route => route.abort());
  await page.goto("/vehicles/new");
  await page.getByTestId("wizard-manual").click();
  await page.getByTestId("wizard-make").fill("טסלה");
  await page.getByTestId("wizard-model").fill("Model 3");
  await expect(page.getByTestId("wizard-ev")).toHaveCount(0);
  await page.getByTestId("wizard-fuel-ev").check({ force: true });
  await expect(page.getByTestId("wizard-ev")).toBeVisible();
  await expect(page.getByTestId("wizard-motor-value")).toHaveText(/לא ידוע|מאתרים/);
  // Correcting the model keeps the electric choice.
  await page.getByTestId("wizard-model").fill("Model Y");
  await expect(page.getByTestId("wizard-fuel-ev")).toBeChecked();
  await page.getByTestId("wizard-confirm-next").click();
  await expect(page.getByRole("heading", { name: "עוד פרט אחד" })).toBeVisible();
  await expect(page.getByTestId("wizard-tank")).toHaveCount(0);
  await page.getByTestId("wizard-skip").click();
  await expect.poll(async () => (await listDocuments(`users/${uid}/vehicles`)).length, { timeout: 15_000 }).toBe(1);
  const [{ data }] = await listDocuments(`users/${uid}/vehicles`);
  expect(data).toMatchObject({ make: "טסלה", model: "Model Y", fuelType: "other", powertrain: "ev", tankLiters: null });
  expect(data.battery).toBeUndefined();
});
