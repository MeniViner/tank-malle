#!/usr/bin/env node
/**
 * Design v3 — prototype screenshot capture.
 *
 * Opens design/v3/prototype.html (React/htm from unpkg, fonts from Google) in
 * Playwright Chromium at 390×844 and screenshots every screen and sheet the
 * prototype exposes, in light and dark, for the fuel car (v1) and the EV (v3).
 *
 * Navigation goes through the prototype's own action object, `window.__TM_A`
 * (app.js), so the capture never depends on the desktop-only map panel.
 * Sheets that need a record id get one read from the live React state.
 *
 *   node scripts/v3-proto-capture.mjs                  # default output dir
 *   V3_PROTO_OUT=some/dir V3_PROTO_WIDTH=430 node scripts/v3-proto-capture.mjs
 *
 * Output: <out>/<name>-<width>-<theme>.png plus <out>/capture.json (what was
 * captured, what failed, console errors, failed network requests).
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(root, process.env.V3_PROTO_OUT ?? "design/v3/evidence/stage-0/prototype");
const WIDTH = Number(process.env.V3_PROTO_WIDTH ?? 390);
const HEIGHT = Number(process.env.V3_PROTO_HEIGHT ?? 844);
const URL = pathToFileURL(resolve(root, "design/v3/prototype.html")).href;

/** Read App's first useState (the demo db) out of the React fiber tree. */
const READ_DB = () => {
  const container = document.getElementById("root");
  const key = Object.keys(container).find(k => k.startsWith("__reactContainer$"));
  let fiber = container[key];
  while (fiber && !(typeof fiber.type === "function" && fiber.type.name === "App")) fiber = fiber.child;
  return fiber?.memoizedState?.memoizedState ?? null;
};

// [name, action] — action runs in the page with A = window.__TM_A and ids.
const SCREENS = [
  ["home", "A.tab('home')"],
  ["journal", "A.tab('journal')"],
  ["insights-cons", "A.tab('insights',{tab:'cons'})"],
  ["insights-price", "A.tab('insights',{tab:'price'})"],
  ["insights-spend", "A.tab('insights',{tab:'spend'})"],
  ["insights-community", "A.tab('insights',{tab:'community'})"],
  ["vehicle", "A.tab('vehicle')"],
  ["fill", "A.go('fill')"],
  ["fill-scan", "A.go('fill',{scan:true})"],
  ["fill-receipt", "A.go('fill',{receipt:true})"],
  ["saved", "ids.lastFill && A.go('saved',{id:ids.lastFill})"],
  ["service", "A.go('service')"],
  ["expense", "A.go('expense')"],
  ["vehicle-edit", "A.go('vehicleEdit')"],
  ["vehicles", "A.go('vehicles')"],
  ["year", "A.go('vehicleYear',{year:2026})"],
  ["account", "A.go('account')"],
  ["notifications", "A.go('notifications')"],
  ["import", "A.go('import')"],
  ["unsynced", "A.go('unsynced')"],
  ["feedback", "A.go('feedback')"],
  ["legal", "A.go('legal')"],
  ["admin", "A.go('admin')"],
  ["wizard", "A.go('wizard',{add:true})"],
  ["onboarding", "A.reset([{s:'onboard'}])"],
  ["signin", "A.reset([{s:'signin'}])"],
];
const SHEETS = [
  ["sheet-tco", "A.tab('home'); A.sheet('tco')"],
  ["sheet-tank", "A.tab('home'); A.sheet('tank')"],
  ["sheet-measure", "A.tab('home'); A.sheet('measure')"],
  ["sheet-trip", "A.tab('home'); A.sheet('trip')"],
  ["sheet-tank-pref", "A.tab('home'); A.sheet('tankPref')"],
  ["sheet-capacity", "A.go('fill'); A.sheet('capacity',{liters:52,pre:0.1,suggest:55})"],
  ["sheet-price", "A.tab('home'); A.sheet('price')"],
  ["sheet-discount", "A.tab('home'); A.sheet('discount')"],
  ["sheet-segment", "ids.seg && (A.tab('home'), A.sheet('segment',{id:ids.seg}))"],
  ["sheet-entry", "ids.lastFill && (A.tab('journal'), A.sheet('entry',{id:ids.lastFill}))"],
  ["sheet-journal-info", "A.tab('journal'); A.sheet('journalInfo',{pending:0,unknown:1})"],
  ["sheet-odo", "A.tab('home'); A.sheet('odo')"],
  ["sheet-station", "A.go('fill'); A.sheet('station',{onPick(){}})"],
  ["sheet-add-menu", "A.tab('home'); A.sheet('addMenu')"],
  ["sheet-car-switch", "A.tab('home'); A.sheet('carSwitch')"],
  ["sheet-accent", "A.tab('home'); A.sheet('accent')"],
  ["sheet-doc-test", "A.tab('vehicle'); A.sheet('doc',{key:'test'})"],
  ["sheet-doc-mandatory", "A.tab('vehicle'); A.sheet('doc',{key:'mandatory'})"],
  ["sheet-reminder-view", "ids.reminder && (A.tab('vehicle'), A.sheet('reminderView',{id:ids.reminder}))"],
  ["sheet-reminder-edit", "A.tab('vehicle'); A.sheet('reminder',{})"],
  ["sheet-snooze", "A.tab('vehicle'); A.sheet('snooze',{onPick(){}})"],
  ["sheet-issue-view", "ids.issue && (A.tab('vehicle'), A.sheet('issue',{id:ids.issue}))"],
  ["sheet-care-transfer", "A.tab('vehicle'); A.sheet('careTransfer')"],
  ["sheet-exclude-info", "A.go('expense'); A.sheet('excludeInfo',{})"],
  ["sheet-biz-export", "A.go('account'); A.sheet('bizExport')"],
  ["sheet-install", "A.go('account'); A.sheet('install',{})"],
  ["sheet-share-info", "A.go('account'); A.sheet('shareInfo',{kind:'fuel'})"],
  ["sheet-delete-account", "A.go('account'); A.sheet('deleteAccount')"],
  ["sheet-restore", "A.go('account'); A.sheet('restore')"],
  ["sheet-receipt", "A.go('fill'); A.sheet('receipt',{onResult(){}})"],
  ["sheet-scan", "A.go('fill'); A.sheet('scan',{onResult(){}})"],
];
const EV_SCREENS = [
  ["ev-home", "A.tab('home')"],
  ["ev-journal", "A.tab('journal')"],
  ["ev-insights-cons", "A.tab('insights',{tab:'cons'})"],
  ["ev-insights-spend", "A.tab('insights',{tab:'spend'})"],
  ["ev-vehicle", "A.tab('vehicle')"],
  ["ev-charge", "A.fab()"],
  ["ev-sheet-battery", "A.tab('home'); A.sheet('battery')"],
  ["ev-sheet-tco", "A.tab('home'); A.sheet('tco')"],
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const report = { url: URL, width: WIDTH, height: HEIGHT, startedAt: new Date().toISOString(), captured: [], failed: [], consoleErrors: [], requestFailures: [] };

async function session(theme) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1,
    colorScheme: theme, reducedMotion: "reduce", locale: "he-IL", timezoneId: "Asia/Jerusalem" });
  const page = await context.newPage();
  let current = "load";
  page.on("console", m => { if (m.type() === "error") report.consoleErrors.push({ theme, shot: current, text: m.text() }); });
  page.on("pageerror", e => report.consoleErrors.push({ theme, shot: current, text: `pageerror: ${e.message}` }));
  page.on("requestfailed", r => report.requestFailures.push({ theme, url: r.url(), error: r.failure()?.errorText }));
  return { context, page, setCurrent: n => { current = n; } };
}

async function boot(page, theme, vehicle) {
  await page.goto(URL, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(() => !!window.__TM_A, null, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(([t, v]) => { window.__TM_A.setSetting("theme", t); window.__TM_A.setActive(v); window.__TM_A.tab("home"); }, [theme, vehicle]);
  await page.waitForTimeout(300);
}

async function ids(page, vehicle) {
  return page.evaluate(([readDb, v]) => {
    const db = (0, eval)(`(${readDb})`)();
    if (!db) return {};
    const fills = db.records.filter(r => r.v === v && (r.type === "fill" || r.type === "charge"))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    let seg = null;
    try { seg = window.TM.compute(db, v).segs.at(-1)?.id ?? null; } catch { /* prototype shape changed */ }
    return { lastFill: fills[0]?.id ?? null, seg,
      reminder: (db.reminders ?? []).find(r => !r.v || r.v === v)?.id ?? null,
      issue: (db.issues ?? []).find(r => !r.v || r.v === v)?.id ?? null };
  }, [READ_DB.toString(), vehicle]);
}

async function capture(list, theme, vehicle) {
  const { context, page, setCurrent } = await session(theme);
  try {
    await boot(page, theme, vehicle);
    const known = await ids(page, vehicle);
    for (const [name, action] of list) {
      setCurrent(name);
      const file = `${name}-${WIDTH}-${theme}.png`;
      try {
        // Reset to a fresh home per shot so a crashed sheet cannot poison the next one.
        await page.evaluate(() => { window.__TM_A.close(); window.__TM_A.tab("home"); });
        // Actions return undefined when they ran; `ids.x && …` yields null when the id is missing.
        const ran = await page.evaluate(([code, i]) => {
          const result = (0, eval)(`(A, ids) => { return (${code.replaceAll(";", ",")}); }`)(window.__TM_A, i);
          return result === undefined || result === true;
        }, [action, known]);
        await page.waitForTimeout(450);
        const alive = await page.evaluate(() => (document.getElementById("root")?.childElementCount ?? 0) > 0);
        if (!ran || !alive) throw new Error(alive ? "action skipped (no id)" : "React tree unmounted (sheet crashed)");
        await page.screenshot({ path: resolve(OUT, file), animations: "disabled" });
        report.captured.push({ name, theme, vehicle, file });
      } catch (error) {
        report.failed.push({ name, theme, vehicle, error: String(error.message ?? error).split("\n")[0] });
        if (!(await page.evaluate(() => !!window.__TM_A && (document.getElementById("root")?.childElementCount ?? 0) > 0).catch(() => false))) {
          await boot(page, theme, vehicle);
        }
      }
    }
  } finally { await context.close(); }
}

try {
  for (const theme of ["light", "dark"]) {
    await capture([...SCREENS, ...SHEETS], theme, "v1");
    await capture(EV_SCREENS, theme, "v3");
  }
} catch (error) {
  report.fatal = String(error.stack ?? error);
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(OUT, "capture.json"), JSON.stringify(report, null, 2));
  console.log(`captured ${report.captured.length}, failed ${report.failed.length}, console errors ${report.consoleErrors.length}, request failures ${report.requestFailures.length}`);
  for (const f of report.failed) console.log(`  FAILED ${f.name} (${f.theme}): ${f.error}`);
  if (report.fatal) { console.error(report.fatal); process.exitCode = 1; }
}
