// Saves the camera-replay suite's results (Playwright JSON report) for RESULTS.md.
//   PLAYWRIGHT_JSON_OUTPUT_NAME=replay.json npx playwright test --config playwright.replay.config.ts --reporter=list,json
//   node scripts/scan-benchmark/replay-report.mjs replay.json benchmarks/scan/runs/replay-chromium.json
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
const [input, out] = process.argv.slice(2);
const report = JSON.parse(await readFile(input, 'utf8')), tests = [];
const walk = suite => { for (const spec of suite.specs ?? []) for (const t of spec.tests) { const result = t.results.at(-1); if (t.status === 'skipped' || result?.status === 'skipped') continue; tests.push({ project: t.projectName, title: spec.title, status: result?.status ?? t.status, ms: result?.duration ?? null, notes: (t.annotations ?? []).filter(a => a.description).map(a => `${a.type}: ${a.description}`) }); } for (const s of suite.suites ?? []) walk(s); };
for (const s of report.suites) walk(s);
const browser = execFileSync('npx', ['--no-install', 'playwright', '--version'], { encoding: 'utf8' }).trim();
const saved = { format: 'tank-maleh-scan-replay-v1', at: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), playwright: browser, machine: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim(),
  note: 'Chromium fake capture device playing rendered 1280x720 displays at 3 fps; the built app with the pinned models, emulators for data. Times are camera-open to reading on a desktop CPU, one test at a time; they are not phone measurements.',
  passed: tests.filter(t => t.status === 'passed').length, failed: tests.filter(t => t.status !== 'passed').length, tests };
await writeFile(out, JSON.stringify(saved, null, 1) + '\n');
console.log(JSON.stringify({ passed: saved.passed, failed: saved.failed }));
