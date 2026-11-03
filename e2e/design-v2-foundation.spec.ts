import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { ALICE, signIn, signOut, signedInWithData } from "./helpers/app";
import { PROJECT_ID, getDocument, listDocuments, setDocument } from "./helpers/emulator";
import { startCareEditor } from "./helpers/care";

// Historical stage evidence is immutable. Ordinary local runs write only to
// ignored test results; an explicit stage opts into its reviewable captures.
const evidenceStage = process.env.DESIGN_V2_STAGE;
const evidence = resolve(evidenceStage ? `design/v2/evidence/stage-${evidenceStage}` : "test-results/design-v2");
const palette = [
  ["plate", "צהוב לוחית", "#ffc915", "#e6b417"],
  ["mint", "מנטה", "#4fd1a5", "#46bd95"],
  ["sky", "תכלת", "#78c2f3", "#6fb2df"],
  ["peach", "אפרסק", "#ff9f6e", "#e8906a"],
  ["lilac", "לילך", "#c8a8f0", "#b59ad8"],
  ["lime", "ליים", "#cfe24e", "#bacb48"],
] as const;
const dates = ["2026-08-01", "2026-08-15", "2026-08-29", "2026-09-12", "2026-09-26", "2026-10-04", "2026-10-15"];

test.use({ viewport: { width: 390, height: 844 } });

async function fixture(page: Page, count = dates.length) {
  const scope = await signedInWithData(page, {
    vehicle: { make: "מבחן", model: "עיצוב", tankLiters: 50, tankLitersSource: "user", declaredKmPerLiter: 14 },
    regulatedPrice: 7.77,
    fillups: Array.from({ length: count }, (_, index) => ({
      id: `foundation-${index}`, date: count === dates.length ? new Date(`${dates[index]}T09:00:00Z`)
        : new Date(new Date("2026-09-01T09:00:00Z").getTime() + index * 86_400_000),
      odometer: 100000 + index * 450, liters: [40, 34, 45, 39, 35, 38, 41][index % 7],
      pricePerLiter: 7.77, stationName: index === 5 ? "סונול שפיה" : "תחנת בדיקה",
    })),
  });
  const path = `users/${scope.uid}/vehicles/${scope.vehicleId}`;
  await setDocument(path, { ...await getDocument(path), plateNumber: "7248078" });
  return scope;
}

async function appearance(page: Page, uid: string, theme: "light" | "dark", accent: string) {
  await page.goto("/settings");
  await page.getByRole("button", { name: /^מראה/ }).click();
  await page.getByRole("radio", { name: theme === "light" ? "בהיר" : "כהה", exact: true }).click();
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ theme });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^צבע/ }).click();
  await page.getByTestId(`accent-${accent}`).click();
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ accentColor: accent });
  await page.keyboard.press("Escape");
}

async function fonts(page: Page) {
  const result = await page.evaluate(async () => {
    const requests = [
      ['700 64px "Karantina"', "אבג123"],
      ['400 16px "IBM Plex Sans Hebrew"', "אבג123"],
      ['600 30px "IBM Plex Mono"', "123456"],
    ];
    return Promise.all(requests.map(async ([font, text]) => {
      const faces = await document.fonts.load(font, text);
      return { font, faces: faces.length, loaded: faces.every(face => face.status === "loaded") };
    }));
  });
  for (const row of result) {
    expect(row.faces, `${row.font} must load an actual local font face`).toBeGreaterThan(0);
    expect(row.loaded).toBe(true);
  }
  await expect(page.locator('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]')).toHaveCount(0);
  expect(await page.evaluate(() => performance.getEntriesByType("resource")
    .some(entry => /https:\/\/fonts\.(googleapis|gstatic)\.com/.test(entry.name)))).toBe(false);
}

async function tokens(page: Page) {
  return page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return Object.fromEntries(["bg", "surface", "surface-2", "ink", "ink-2", "accent", "accent-contrast", "lp"]
      .map(name => [name, css.getPropertyValue(`--${name}`).trim().toLowerCase()]));
  });
}

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const value = hex.length === 4 ? `#${[...hex.slice(1)].map(char => char + char).join("")}` : hex;
    const rgb = [1, 3, 5].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

async function capture(page: Page, name: string) {
  await fonts(page);
  const appearanceLabel = name.match(/-(light|dark)-(plate|mint|lime)$/);
  if (appearanceLabel) {
    const [, theme, accent] = appearanceLabel;
    const values = await tokens(page);
    expect(values.bg, `${name} theme`).toBe(theme === "light" ? "#f9f7f2" : "#1e1c18");
    expect(values.accent, `${name} accent`).toBe(palette.find(row => row[0] === accent)![theme === "light" ? 2 : 3]);
  }
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, `${name}.png`), animations: "disabled" });
  if (/^(home|history|settings)-/.test(name)) {
    await page.screenshot({ path: resolve(evidence, `${name}-full.png`), fullPage: true, animations: "disabled" });
  }
  const layout = await page.evaluate(() => ({
    width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    overflow: [...document.body.querySelectorAll<HTMLElement>("*")].filter(element => {
      if (element.closest('svg, [data-testid="app-atmosphere"]')) return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1);
    }).map(element => ({ tag: element.tagName, className: element.className,
      text: element.innerText?.slice(0, 120), left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })).slice(0, 30),
  }));
  if (layout.scrollWidth > layout.width) await writeFile(resolve(evidence, `${name}-overflow.json`), JSON.stringify(layout, null, 2));
  expect(layout.scrollWidth <= layout.width, name).toBe(true);
}

async function uncoveredAtmosphere(page: Page) {
  // A correctly mounted SVG is insufficient if a full-screen paper surface
  // paints over it. Check the heading's outer shells and other wide covers.
  const covers = await page.locator("h1").first().evaluate(heading => {
    const ancestors: Element[] = [];
    for (let element: Element | null = heading; element && element !== document.body; element = element.parentElement) {
      ancestors.push(element);
    }
    const widePanels = [...document.querySelectorAll("#root *")].filter(element => {
      if (element.closest('svg, dialog, [data-testid="app-atmosphere"]')) return false;
      const box = element.getBoundingClientRect();
      return box.width >= Math.min(innerWidth, 430) - 1 && box.height >= 180 && box.top < 240 && box.bottom > 0;
    });
    return [...new Set([...ancestors, ...widePanels])].flatMap(element => {
      const style = getComputedStyle(element);
      return style.backgroundColor !== "rgba(0, 0, 0, 0)" || style.backgroundImage !== "none"
        ? [{ tag: element.tagName, className: element.className, background: style.backgroundColor, image: style.backgroundImage }]
        : [];
    });
  });
  expect(covers, "The route's outer surfaces must let the atmosphere show through").toEqual([]);
}

async function atmosphere(page: Page, variant: string, corner: string, glow: string) {
  const layer = page.getByTestId("app-atmosphere");
  await expect(layer).toHaveCount(1);
  await expect(layer).toHaveAttribute("data-variant", variant);
  await expect(layer).toHaveCSS("pointer-events", "none");
  await expect(layer).toHaveCSS("position", "fixed");
  await expect(layer.locator("svg")).toHaveCount(1);
  await expect(layer.locator("circle")).toHaveCount(3);
  await expect(layer.locator("line")).toHaveCount(72);
  await expect(layer.locator(".tm-atmosphere-glow")).toHaveCSS("opacity", glow);
  const position = await layer.locator("svg").boundingBox();
  expect(position).not.toBeNull();
  expect(corner === "right" ? position!.x + position!.width > 390 : position!.x < 0).toBe(true);
  await uncoveredAtmosphere(page);
}

for (const theme of ["light", "dark"] as const) for (const accent of ["plate", "mint"] as const) {
  test(`Plate foundation evidence and readable numeric islands: ${theme}/${accent}`, async ({ page }) => {
    test.setTimeout(180_000);
    const { uid } = await fixture(page);
    await appearance(page, uid, theme, accent);
    const values = await tokens(page);
    expect(values.bg).toBe(theme === "light" ? "#f9f7f2" : "#1e1c18");
    expect(values.accent).toBe(palette.find(row => row[0] === accent)![theme === "light" ? 2 : 3]);
    expect(values.lp).toBe(theme === "light" ? "#ffc915" : "#efbe1a");
    expect(contrast(values["accent-contrast"], values.accent)).toBeGreaterThanOrEqual(7);
    for (const surface of ["bg", "surface", "surface-2"]) {
      for (const ink of ["ink", "ink-2"]) expect(contrast(values[ink], values[surface])).toBeGreaterThanOrEqual(4.5);
    }
    for (const [name, route, variant, corner, glow, heading] of [
      ["home", "/", "home", "right", "0.55", "מצב הרכב"],
      ["history", "/history", "journal", "left", "0.4", "יומן"],
      ["settings", "/settings", "account", "right", "0.16", "חשבון"],
      ["atmosphere-insights", "/stats", "insights", "right", "0.4", "תובנות"],
      ["atmosphere-vehicle", "/settings/vehicles", "vehicle", "left", "0.75", "הרכבים שלי"],
      ["atmosphere-vehicle-tab", "/vehicle", "vehicle", "left", "0.75", "מבחן עיצוב"],
      ["atmosphere-fillup", "/fillup/new", "entry", "left", "0.35", "תדלוק חדש"],
      ["atmosphere-fillup-missing", "/fillup/missing-foundation", "entry", "left", "0.35", "עריכת תדלוק"],
      ["atmosphere-legal", "/legal/terms", "legal", "left", "0.1", "תנאי שימוש"],
      ["atmosphere-import", "/settings/import", "account", "right", "0.16", "ייבוא נתונים"],
      ["atmosphere-unsynced", "/settings/unsynced", "account", "right", "0.16", "לא סונכרן"],
      ["atmosphere-profile", "/settings/profile", "account", "right", "0.16", "חשבון"],
      ["atmosphere-feedback", "/feedback", "account", "right", "0.16", "משוב"],
      ["atmosphere-notifications", "/notifications", "account", "right", "0.16", "התראות"],
      ["atmosphere-wizard", "/vehicles/new", "vehicle", "left", "0.75", "מה מספר הרכב?"],
    ]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
      await atmosphere(page, variant, corner, glow);
      if (name === "home") {
        const hero = page.getByTestId("consumption-summary").locator(".home-consumption-value > bdi").first();
        await expect(hero).toHaveText("11.0");
        await expect(hero).toHaveCSS("direction", "ltr");
        await expect(hero).toHaveCSS("unicode-bidi", "isolate");
        await expect(hero).toHaveCSS("text-align", "right");
        expect(await hero.evaluate(element => getComputedStyle(element).fontFamily)).toContain("Karantina");
        const geometry = await hero.evaluate(element => ({
          right: element.getBoundingClientRect().right,
          parentRight: element.parentElement!.getBoundingClientRect().right,
        }));
        expect(Math.abs(geometry.right - geometry.parentRight)).toBeLessThanOrEqual(1);
        await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toHaveCSS("backdrop-filter", "blur(14px)");
      }
      if (name === "history") await expect(page.getByText("תחנת בדיקה", { exact: true }).first()).toBeVisible();
      if (name === "atmosphere-fillup-missing") await expect(page.locator('[data-edit-state="not-found"]')).toBeVisible();
      if (name === "atmosphere-wizard") {
        const step = page.locator(".wizard-step-count");
        await expect(step).toHaveCSS("color", theme === "light" ? "rgb(75, 70, 60)" : "rgb(169, 162, 146)");
        await expect(step.locator('bdi[dir="ltr"]')).toHaveText(["1", "3"]);
      }
      if (name === "atmosphere-vehicle") {
        const plate = page.locator('[data-managed-vehicle="v1"] .tm-vehicle-card-title p bdi')
          .filter({ hasText: /^72-480-78$/ });
        await expect(plate).toHaveCount(1);
        await expect(plate).toBeVisible();
        await expect(plate).toHaveAttribute("dir", "ltr");
        await expect(plate).toHaveCSS("unicode-bidi", "isolate");
      }
      if (name === "atmosphere-vehicle-tab") {
        const plate = page.locator('.tm-plate-xl');
        await expect(plate).toBeVisible();
        await expect(plate).toHaveCSS("background-color", theme === "light" ? "rgb(255, 201, 21)" : "rgb(239, 190, 26)");
        await expect(plate.locator('bdi')).toHaveAttribute("dir", "ltr");
        await expect(plate.locator('bdi')).toHaveText("72-480-78");
      }
      await capture(page, `${name}-${theme}-${accent}`);
    }

    // Exercise the actual claims-gated admin and the unauthenticated shells,
    // without changing access checks or introducing a production test harness.
    process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${process.env.CARE_AUTH_PORT ?? "9099"}`;
    const admin = initializeApp({ projectId: PROJECT_ID }, `foundation-${theme}-${accent}-${Date.now()}`);
    await getAuth(admin).setCustomUserClaims(uid, { admin: true });
    await deleteApp(admin);
    await signOut(page);
    await signIn(page, ALICE);
    await page.goto("/admin");
    await expect(page.getByRole("region", { name: "סיכום המערכת" })).toBeVisible();
    await atmosphere(page, "account", "right", "0.16");
    await capture(page, `atmosphere-admin-${theme}-${accent}`);
    await signOut(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "התחברות עם Google", exact: true })).toBeVisible();
    await atmosphere(page, "home", "right", "0.55");
    await capture(page, `atmosphere-signin-${theme}-${accent}`);
    await page.evaluate(() => localStorage.removeItem("tm.onboarded"));
    await page.reload();
    for (let slide = 1; slide <= 3; slide++) {
      await expect(page.getByRole("button", { name: "דלג", exact: true })).toBeVisible();
      await expect(page.getByTestId("onboarding-slide")).toHaveAttribute("data-slide", String(slide));
      const counter = page.getByRole("progressbar", { name: "היכרות עם טנק מלא" });
      await expect(counter).toHaveAttribute("aria-valuenow", String(slide));
      await expect(counter).toHaveAttribute("aria-valuemax", "3");
      await expect(page.getByTestId("onboarding-art")).toBeVisible();
      await atmosphere(page, "home", "right", "0.55");
      await capture(page, `atmosphere-onboarding-${slide}-${theme}-${accent}`);
      if (slide < 3) await page.getByRole("button", { name: "הבא", exact: true }).click();
    }
  });
}

test("six accessible swatches persist and the sheet traps focus and closes with Escape", async ({ page }) => {
  test.setTimeout(120_000);
  const { uid } = await fixture(page);
  for (const theme of ["light", "dark"] as const) {
    await appearance(page, uid, theme, "plate");
    const trigger = page.getByRole("button", { name: /^צבע/ });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "צבע", exact: true });
    await expect(dialog.getByTestId(/^accent-/)).toHaveCount(6);
    await expect(dialog.locator('input[type="color"]')).toHaveCount(0);
    await expect(dialog.getByRole("heading", { name: "צבע", exact: true })).toHaveCSS("font-size", "34px");
    for (const [id, label, light, dark] of palette) {
      const button = dialog.getByTestId(`accent-${id}`);
      await expect(button).toHaveAccessibleName(label);
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      const swatch = await button.locator("span").first().boundingBox();
      expect(swatch!.width).toBe(52);
      expect(swatch!.height).toBe(52);
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(dialog.locator('[data-testid^="accent-"][aria-pressed="true"]')).toHaveCount(1);
      await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ accentColor: id, customAccent: null });
      const values = await tokens(page);
      expect(values.accent).toBe(theme === "light" ? light : dark);
      expect(values.lp).toBe(theme === "light" ? "#ffc915" : "#efbe1a");
      expect(values["accent-contrast"]).toBe("#111111");
      expect(contrast(values.accent, values["accent-contrast"])).toBeGreaterThanOrEqual(7);
    }
    await capture(page, `accent-sheet-${theme}-lime`);
    for (let index = 0; index < 10; index++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.reload();
    expect((await tokens(page)).accent).toBe(theme === "light" ? "#cfe24e" : "#bacb48");
  }
});

test("legacy and custom accent data normalize before React and after reload; system follows the OS", async ({ page }) => {
  for (const legacy of ["teal", "custom", "missing-palette-id"]) {
    await page.addInitScript(id => {
      localStorage.setItem("tm.theme", "system");
      localStorage.setItem("tm.accent", JSON.stringify({ id, custom: "#ff0000", light: "#ff0000", dark: "#ff0000" }));
    }, legacy);
    // Pause only the application module so the inline, pre-paint bootstrap is observable.
    await page.route("**/src/main.tsx", route => route.abort());
    await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--accent-l").toLowerCase())).toBe("#ffc915");
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--accent-d").toLowerCase())).toBe("#e6b417");
    await page.unroute("**/src/main.tsx");
    await page.reload();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tm.accent") ?? "{}").id)).toBe("plate");
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).not.toHaveAttribute("data-theme");
      await expect.poll(async () => (await tokens(page)).bg).toBe(colorScheme === "light" ? "#f9f7f2" : "#1e1c18");
      expect((await tokens(page)).accent).toBe(colorScheme === "light" ? "#ffc915" : "#e6b417");
    }
  }
});

test("fuel and shared segmented reminder labels isolate numbers from their Hebrew words", async ({ page }) => {
  await fixture(page);
  await page.goto("/vehicles/new");
  await page.getByRole("button", { name: /הזנה ידנית/ }).click();
  for (const fuel of ["95", "98"]) {
    const radio = page.getByRole("radio", { name: `בנזין ${fuel} אוקטן`, exact: true });
    await expect(radio).toBeVisible();
    const choice = page.locator("label").filter({ has: radio });
    await expect(choice.locator('bdi[dir="ltr"]')).toHaveText(fuel);
    await expect(choice.locator("bdi")).toHaveCSS("unicode-bidi", "isolate");
    expect(await choice.locator("bdi").textContent()).not.toMatch(/[א-ת]/);
  }
  await page.goto("/settings");
  await page.getByRole("button", { name: /העדפות התראות/ }).click();
  const dialog = page.getByRole("dialog", { name: "העדפות התראות", exact: true });
  for (const [label, value] of [["3 ימים", "3"], ["500 ק״מ", "500"], ["1,000 ק״מ", "1,000"], ["2,000 ק״מ", "2,000"]]) {
    const island = dialog.getByRole("radio", { name: label, exact: true }).locator('bdi[dir="ltr"]');
    await expect(island).toHaveText(value);
    await expect(island).toHaveCSS("unicode-bidi", "isolate");
  }
});

test("a short confirmation scrolls and Escape closes only the top modal without losing its draft", async ({ page }) => {
  const { uid, vehicleId } = await fixture(page);
  await page.goto("/vehicle");
  await startCareEditor(page, "service");
  const editor = page.getByRole("dialog");
  await editor.getByLabel("עלות כוללת", { exact: true }).fill("850");
  await editor.getByRole("button", { name: "מחיקת הטיוטה", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "למחוק את הטיוטה?", exact: true });
  await expect(confirmation).toBeVisible();
  await page.setViewportSize({ width: 390, height: 220 });
  const panel = confirmation.locator(".tm-confirm-panel");
  const box = await panel.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(220);
  expect(await panel.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  const discard = confirmation.getByRole("button", { name: "יציאה ללא שמירה", exact: true });
  await discard.scrollIntoViewIfNeeded();
  await expect(discard).toBeInViewport({ ratio: 1 });
  const keep = confirmation.getByRole("button", { name: "המשך עריכה", exact: true });
  await discard.focus();
  await page.keyboard.press("Tab");
  await expect(keep).toBeFocused();
  await expect(keep).toBeInViewport({ ratio: 1 });
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, "confirmation-short-390x220.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(editor).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(editor.getByLabel("עלות כוללת", { exact: true })).toHaveValue("850");
  await expect(editor.getByRole("button", { name: "מחיקת הטיוטה", exact: true })).toBeFocused();
  expect(await listDocuments(`users/${uid}/vehicles/${vehicleId}/serviceEvents`)).toHaveLength(0);
});

test("a visible Undo remains in the active sheet's keyboard trap and restores the server record", async ({ page }) => {
  const { uid, vehicleId } = await fixture(page);
  const path = `users/${uid}/vehicles/${vehicleId}/vehicleExpenses/modal-undo`;
  const record = { schemaVersion: 1, version: 1, day: "2026-10-31", category: "parking", title: "חניה לבדיקת ביטול", costAgorot: 2200, notes: "רשומה שצריכה לחזור לשרת" };
  await setDocument(path, record);
  await page.goto("/history");
  await page.getByRole("button", { name: /חניה לבדיקת ביטול/ }).click();
  await page.getByTestId("journal-entry-delete").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "מחיקת הרשומה", exact: true }).click();
  await expect(page.locator("[data-toast-title]").filter({ hasText: "הרשומה נמחקה" })).toBeVisible();
  expect(await getDocument(path)).toBeNull();
  await page.getByRole("button", { name: "תקופת היומן", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "תקופת היומן", exact: true });
  const undo = sheet.getByRole("button", { name: "ביטול", exact: true });
  await expect(undo).toBeVisible();
  for (let index = 0; index < 10 && !(await undo.evaluate(element => element === document.activeElement)); index++) {
    await page.keyboard.press("Tab");
    expect(await sheet.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await expect(undo).toBeFocused();
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, "modal-undo-light-plate.png"), animations: "disabled" });
  await page.keyboard.press("Enter");
  await expect.poll(() => getDocument(path)).toMatchObject({ title: record.title, costAgorot: 2200, category: "parking", notes: record.notes });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});

test("static atmosphere preserves responsive long-list scrolling under a process-scoped mobile 4x CPU profile", async ({ page, context }) => {
  await fixture(page, 40);
  await page.goto("/history");
  await expect(page.getByText("תחנת בדיקה", { exact: true })).toHaveCount(39);
  await fonts(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const atmosphere = page.getByTestId("app-atmosphere");
  expect(await atmosphere.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  const before = await atmosphere.boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  try {
    const samples = await page.evaluate(async () => {
      const frames: number[] = [], longTasks: number[] = [];
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({ type: "longtask" });
      const distance = document.documentElement.scrollHeight - innerHeight;
      let previous = await new Promise<number>(resolveFrame => requestAnimationFrame(resolveFrame));
      for (let index = 0; index < 150; index++) {
        const time = await new Promise<number>(resolveFrame => requestAnimationFrame(resolveFrame));
        if (index > 5) frames.push(time - previous);
        previous = time;
        scrollTo(0, distance * (index < 75 ? index / 75 : (150 - index) / 75));
      }
      observer.disconnect();
      scrollTo(0, 0);
      const sorted = [...frames].sort((a, b) => a - b);
      return { profile: "390x844 / Chromium renderer CPU 4x", frames, longTasks,
        p95: sorted[Math.floor(sorted.length * 0.95)], max: Math.max(...frames), distance };
    });
    try {
      expect(samples.distance).toBeGreaterThan(2 * 844);
      expect(samples.p95).toBeLessThan(50);
      expect(Math.max(0, ...samples.longTasks)).toBeLessThan(150);
      expect(await atmosphere.boundingBox()).toEqual(before);
      await capture(page, "atmosphere-scroll-4x");
    } finally {
      // Persist after browser assertions: a JSON write in the Vite source tree
      // can trigger the development server's watcher and reload the page.
      await mkdir(evidence, { recursive: true });
      await writeFile(resolve(evidence, "atmosphere-scroll-4x.json"), JSON.stringify(samples, null, 2));
    }
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await cdp.detach();
  }
});
