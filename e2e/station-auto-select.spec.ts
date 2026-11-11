import { expect, test, type Page } from "@playwright/test";
import { chooseNamedStation, fillupFixture, newServerFillup, typeFillup } from "./helpers/design-v2-fillup";
import { finishFillupSave } from "./helpers/fillup";

// The person is standing at a pump (32.0000, 34.8000). Stations around them:
// Sorted by latitude, as the real catalog is (scripts/buildStationCatalog.mjs).
const CATALOG = { count: 3, companies: ["פז", "דלק"], stations: [
  { i: "near", n: "תחנה צמודה", c: "פז", a: "בדיקה", lat: 32.0004, lng: 34.8 },     // ~45 m away
  { i: "across", n: "תחנה ממול", c: "דלק", a: "בדיקה", lat: 32.0015, lng: 34.8 },   // ~170 m away
  { i: "far", n: "תחנה רחוקה", c: "דלק", a: "בדיקה", lat: 32.009, lng: 34.8 },      // ~1 km away
] };

async function standAt(page: Page, lat: number, lng: number) {
  await page.addInitScript(([la, ln]) => {
    Object.defineProperty(navigator.geolocation, "getCurrentPosition", { configurable: true, value: (ok: PositionCallback) =>
      setTimeout(() => ok({ coords: { latitude: la, longitude: ln, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition), 50) });
  }, [lat, lng]);
  await page.route("**/fuel-stations.json", route => route.fulfill({ json: CATALOG }));
}

test("a new fill-up selects the station right next to you, marked as chosen by location", async ({ page }) => {
  const scope = await fillupFixture(page, { history: "none" });
  await standAt(page, 32, 34.8);
  await page.goto("/fillup/new");
  const trigger = page.getByTestId("fillup-station");
  await expect(trigger).toContainText("תחנה צמודה");
  await expect(trigger).toContainText("לפי מיקום");
  await typeFillup(page, { odometer: 100000 });
  await page.getByTestId("fillup-save").click();
  await finishFillupSave(page);
  expect((await newServerFillup(scope, 100000)).data.station).toMatchObject({ name: "תחנה צמודה", stationId: "near" });
});

test("the automatic station can be replaced, and the replacement is what is saved", async ({ page }) => {
  const scope = await fillupFixture(page, { history: "none" });
  await standAt(page, 32, 34.8);
  await page.goto("/fillup/new");
  await expect(page.getByTestId("fillup-station")).toContainText("תחנה צמודה");
  await chooseNamedStation(page, "תחנה שבחרתי בעצמי");
  await expect(page.getByTestId("fillup-station")).toContainText("תחנה שבחרתי בעצמי");
  await expect(page.getByTestId("fillup-station")).not.toContainText("לפי מיקום");
  await typeFillup(page, { odometer: 100000 });
  await page.getByTestId("fillup-save").click();
  await finishFillupSave(page);
  expect((await newServerFillup(scope, 100000)).data.station).toEqual({ name: "תחנה שבחרתי בעצמי" });
});

test("nothing is pre-selected when no station is close (over 400 m)", async ({ page }) => {
  await fillupFixture(page, { history: "none" });
  await standAt(page, 31.99, 34.8); // ~1.1 km from the nearest
  await page.goto("/fillup/new");
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("fillup-station")).toContainText("בחירת תחנה");
});
