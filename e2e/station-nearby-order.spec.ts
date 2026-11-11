import { expect, test } from "@playwright/test";
import { chooseNamedStation, fillupFixture } from "./helpers/design-v2-fillup";

interface StationLocationFixture {
  latitude: number;
  longitude: number;
  failure: "denied" | "timeout" | null;
  requests: PositionOptions[];
}

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });

test("nearby orders every matching station beyond 400 m, preserves selection and survives location failures", async ({ page }) => {
  await fillupFixture(page, { history: "none" });
  await page.addInitScript(() => {
    const state: StationLocationFixture = { latitude: 32, longitude: 34.8, failure: null, requests: [] };
    (window as Window & { stationLocation?: StationLocationFixture }).stationLocation = state;
    Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
      configurable: true,
      value: (success: PositionCallback, error?: PositionErrorCallback, options?: PositionOptions) => {
        state.requests.push(options ?? {});
        if (state.failure) {
          error?.({ code: state.failure === "denied" ? 1 : 3, message: state.failure,
            PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
          return;
        }
        success({ coords: { latitude: state.latitude, longitude: state.longitude, accuracy: 1,
          altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition);
      },
    });
  });
  // The nearest match comes AFTER the ordinary first 30 results. All are
  // outside the automatic-selection radius at the starting position.
  const stations = Array.from({ length: 40 }, (_, index) => ({
    i: `far-${index}`, n: `פז בדיקה ${index}`, c: "פז", a: "כביש הבדיקה", lat: 31 + index * .02, lng: 34.8,
  }));
  stations.push({ i: "closest", n: "פז בדיקה הקרובה", c: "פז", a: "כביש הבדיקה", lat: 31.99, lng: 34.8 });
  await page.route("**/fuel-stations.json", route => route.fulfill({ json: {
    count: stations.length, registryCount: stations.length + 1, companies: ["פז"], stations,
    registryOnly: [{ i: "unknown", n: "פז בדיקה ללא מיקום", c: "פז", a: "כתובת ללא מיקום", lat: null, lng: null }],
  } }));
  await page.goto("/fillup/new");
  const chosen = "תחנה שבחרתי בעצמי";
  await chooseNamedStation(page, chosen);
  const trigger = page.getByTestId("fillup-station");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "תחנת דלק", exact: true });
  const search = dialog.getByRole("textbox", { name: "חיפוש תחנה", exact: true });
  const rows = dialog.locator("button[aria-pressed]");
  const order = dialog.getByRole("button", { name: "בקרבתי", exact: true });
  await search.fill("בדיקה");
  await expect(rows).toHaveCount(30);
  await expect(dialog.getByRole("button", { name: /פז בדיקה הקרובה/ })).toHaveCount(0);
  await expect(order).toHaveCSS("text-decoration-line", "underline");
  await order.click();
  await expect(rows.first()).toContainText("פז בדיקה הקרובה");
  await expect(rows.first()).toContainText("1.1 ק״מ");
  await expect(search).toHaveValue("בדיקה");
  await expect(trigger).toContainText(chosen);
  await expect(trigger).not.toContainText("לפי מיקום");
  await dialog.getByRole("button", { name: "עוד תחנות", exact: true }).click();
  await expect(rows).toHaveCount(42);
  await expect(rows.last()).toContainText("מרחק לא ידוע");

  for (const failure of ["denied", "timeout"] as const) {
    await page.evaluate(failure => { (window as Window & { stationLocation?: StationLocationFixture }).stationLocation!.failure = failure; }, failure);
    await order.click();
    await expect(dialog.getByRole("status")).toContainText(failure === "denied" ? "הרשאת המיקום נדחתה" : "לא הצלחנו לקבל מיקום");
    await expect(rows.first()).toContainText("פז בדיקה הקרובה");
    await expect(rows).toHaveCount(42);
    await expect(search).toHaveValue("בדיקה");
    await expect(trigger).toContainText(chosen);
  }

  await page.evaluate(() => {
    const state = (window as Window & { stationLocation?: StationLocationFixture }).stationLocation!;
    state.failure = null; state.latitude = 31.045;
  });
  await order.click();
  await expect(rows.first().getByText("פז בדיקה 2", { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(30);
  const requests = await page.evaluate(() => (window as Window & { stationLocation?: StationLocationFixture }).stationLocation!.requests);
  // The automatic look-up may ask twice when the form opens before the vehicle has loaded
  // (the first answer is discarded as stale); every "בקרבתי" asks once, for a fresh fix.
  const automatic = requests.filter(options => options.maximumAge === 60_000), manual = requests.filter(options => options.maximumAge === 0);
  expect(automatic.length).toBeGreaterThanOrEqual(1);
  expect(automatic.length).toBeLessThanOrEqual(2);
  expect(manual).toHaveLength(4);
  expect(requests.slice(automatic.length).every(options => options.maximumAge === 0)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(trigger).toContainText(chosen);
  await expect(trigger).toBeFocused();
});
