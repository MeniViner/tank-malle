// Saves the camera-replay suite's results (Playwright JSON report) for RESULTS.md.
//   PLAYWRIGHT_JSON_OUTPUT_NAME=replay.json npx playwright test --config playwright.replay.config.ts --reporter=list,json
//   node scripts/scan-benchmark/replay-report.mjs replay.json benchmarks/scan/runs/replay-chromium.json
// Scan outcomes (each test's `outcome` annotations: correct, wrong, abstained,
// correctly-empty) are counted apart from test results: a passing safety test
// can be an abstention, and an expected failure is an open recognition gap.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
const [input, out] = process.argv.slice(2);
const report = JSON.parse(await readFile(input, 'utf8')), tests = [];
const walk = suite => {
  for (const spec of suite.specs ?? []) for (const t of spec.tests) {
    const result = t.results.at(-1);
    if (t.status === 'skipped' || result?.status === 'skipped') continue;
    // Playwright: 'expected' (passed, or failed under test.fail), 'unexpected', 'flaky'.
    const status = t.expectedStatus === 'failed' ? (result?.status === 'passed' ? 'unexpectedly-passed' : 'expected-failure') : result?.status ?? t.status;
    const notes = [...(t.annotations ?? []), ...(result?.annotations ?? [])].filter(a => a.description && a.type !== 'fail');
    tests.push({ project: t.projectName, title: spec.title, status, ms: result?.duration ?? null, outcomes: notes.filter(a => a.type === 'outcome').map(a => a.description), notes: notes.filter(a => a.type !== 'outcome').map(a => `${a.type}: ${a.description}`) });
  }
  for (const s of suite.suites ?? []) walk(s);
};
for (const s of report.suites) walk(s);
const scans = { correct: 0, wrong: 0, abstained: 0, 'correctly-empty': 0 };
for (const t of tests) for (const o of t.outcomes) scans[o.split(':')[0]]++;
const count = status => tests.filter(t => t.status === status).length;
const browser = execFileSync('npx', ['--no-install', 'playwright', '--version'], { encoding: 'utf8' }).trim();
const machine = process.platform === 'darwin' ? execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim() : `${process.platform} ${process.arch}`;
const saved = { format: 'tank-maleh-scan-replay-v2', at: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), playwright: browser, machine,
  note: 'Chromium fake capture device playing rendered 1280x720 displays at 3 fps (pinned pixels, e2e/fixtures/replay-scenes.json); the built app with the pinned models, emulators for data. Times are camera-open to reading on a desktop CPU, one test at a time; they are not phone measurements.',
  tests: { passed: count('passed'), failed: count('failed') + count('timedOut') + count('interrupted') + count('unexpectedly-passed'), expectedFailures: count('expected-failure') },
  scans, results: tests };
await writeFile(out, JSON.stringify(saved, null, 1) + '\n');
console.log(JSON.stringify({ tests: saved.tests, scans }));
