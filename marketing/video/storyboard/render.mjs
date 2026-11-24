// Renders each storyboard frame to a 1080x1920 PNG. Run from the repo root:
// node marketing/video/storyboard/render.mjs
import { chromium } from "playwright";
import path from "node:path";
const dir = path.resolve("marketing/video/storyboard");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto("file://" + path.join(dir, "storyboard.html"));
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
for (let i = 1; i <= 8; i++) await page.locator(`#s${i}`).screenshot({ path: path.join(dir, `frames/s${i}.png`) });
await browser.close();
