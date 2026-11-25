/** Collect project-wide service counts without exporting request bodies or identities. */
import { pathToFileURL } from 'node:url';
import { monitoringToken } from './monitoringToken.mjs';
import { applicationDefault, cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { probe, publishOwnerTelemetry } from './collectOwnerTelemetry.mjs';

import { collectProductJourney } from './collectProductJourney.mjs';

const PROJECT = 'tank-malle';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const dbFilter = 'resource.type="firestore.googleapis.com/Database" AND resource.labels.database_id="(default)"';
const metrics = {
  calls: {
    type: 'serviceruntime.googleapis.com/api/request_count',
    resource: 'resource.type="consumed_api"',
    groups: ['resource.labels.service', 'resource.labels.method', 'metric.labels.response_code'],
  },
  reads: { type: 'firestore.googleapis.com/document/read_ops_count', resource: dbFilter },
  writes: { type: 'firestore.googleapis.com/document/write_ops_count', resource: dbFilter },
  deletes: { type: 'firestore.googleapis.com/document/delete_ops_count', resource: dbFilter },
  bandwidth: {
    type: 'firebasehosting.googleapis.com/network/sent_bytes_count',
    resource: 'resource.type="firebase_domain" AND resource.labels.site_name="tank-malle"',
  },
};

async function series(token, metric, end) {
  const params = new URLSearchParams({
    filter: `project="${PROJECT}" AND metric.type="${metric.type}" AND ${metric.resource}`,
    'interval.startTime': new Date(end - 7 * DAY).toISOString(),
    'interval.endTime': new Date(end).toISOString(),
    'aggregation.alignmentPeriod': '86400s',
    'aggregation.perSeriesAligner': 'ALIGN_SUM',
    'aggregation.crossSeriesReducer': 'REDUCE_SUM',
    view: 'FULL',
    pageSize: '1000',
  });
  for (const group of metric.groups ?? []) params.append('aggregation.groupByFields', group);
  const rows = [];
  for (let page = 0; page < 10; page += 1) {
    const response = await fetch(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const reason = payload?.error?.details?.find(item => /^[A-Z_]{3,100}$/.test(item.reason ?? ''))?.reason;
      return { status: response.status === 403 ? 'forbidden' : 'unavailable', http: response.status, ...(reason ? { reason } : {}) };
    }
    const result = await response.json();
    if (result.executionErrors?.length || result.unreachable?.length) return { status: 'unavailable' };
    rows.push(...(result.timeSeries ?? []));
    if (!result.nextPageToken) return { status: rows.length ? 'ok' : 'empty', rows };
    params.set('pageToken', result.nextPageToken);
  }
  return { status: 'unavailable' };
}

function daily(points, end) {
  const days = Array(7).fill(null);
  for (const point of points) {
    const index = 6 - Math.round((end - Date.parse(point.interval?.endTime)) / DAY);
    const value = Number(point.value?.int64Value);
    if (Number.isInteger(index) && index >= 0 && index <= 6 && Number.isSafeInteger(value) && value >= 0) {
      days[index] = (days[index] ?? 0) + value;
    }
  }
  return days;
}

function summarize(key, result, end) {
  if (result.status !== 'ok') return result;
  const days = daily(result.rows.flatMap(row => row.points ?? []), end);
  if (key !== 'calls') return { status: 'ok', days };
  const codes = new Map();
  const calls = [];
  for (const row of result.rows) {
    const service = row.resource?.labels?.service?.slice(0, 120) || 'unknown';
    const method = row.resource?.labels?.method?.slice(0, 180) || 'unknown';
    const label = row.metric?.labels?.response_code ?? '';
    const code = /^\d{3}$/.test(label) ? label : 'other';
    const dailyCounts = daily(row.points ?? [], end);
    const total = dailyCounts.reduce((sum, value) => sum + (value ?? 0), 0);
    if (!total) continue;
    codes.set(code, (codes.get(code) ?? 0) + total);
    calls.push({ service, method, code, count: total });
  }
  calls.sort((a, b) => b.count - a.count);
  return {
    status: 'ok', days, codes: [...codes.entries()].map(([code, count]) => ({ code, count })),
    calls: calls.slice(0, 300), breakdownSize: calls.length,
  };
}

export async function collectOperations(token, now = Date.now()) {
  // Use complete 24-hour windows, leaving more than the metric visibility lag.
  const end = Math.floor((now - 2 * HOUR) / HOUR) * HOUR;
  if (!token) return { version: 1, collectedAt: now, end, metrics: Object.fromEntries(
    Object.keys(metrics).map(name => [name, { status: 'billing_required' }])) };
  const results = await Promise.all(Object.entries(metrics).map(async ([key, metric]) => {
    try { return [key, summarize(key, await series(token, metric, end), end)]; }
    catch { return [key, { status: 'unavailable' }]; }
  }));
  return { version: 1, collectedAt: now, end, metrics: Object.fromEntries(results) };
}

async function main() {
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('The production collector cannot run with a Firestore emulator.');
  const dryRun = process.argv.includes('--dry-run');
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  const key = inline ? JSON.parse(inline) : null;
  if (key && key.project_id !== PROJECT) throw new Error('Unexpected monitoring project.');
  if (!dryRun && !key) throw new Error('The repository service account is required to publish.');
  const credential = key ? cert(key) : applicationDefault();
  const app = initializeApp({ projectId: PROJECT, credential });
  try {
    const { access_token: token } = await credential.getAccessToken();
    const spark = process.argv.includes('--spark');
    const monitoring = spark ? null : process.env.GITHUB_ACTIONS === 'true' ? await monitoringToken() : token;
    const [snapshot, journey] = await Promise.all([collectOperations(monitoring), collectProductJourney(key ?? undefined)]);
    console.log(`Product journey: funnel ${journey.funnel.status}, writes ${journey.operations.status}`);
    const db = getFirestore(app);
    const check = await probe(db, snapshot.collectedAt);
    console.log(`Availability: Hosting ${check.hostingMs ?? 'failed'} ms, Firestore ${check.firestoreMs ?? 'failed'} ms`);
    if ([journey.funnel, journey.operations, journey.recent].some(r => !['ok', 'empty'].includes(r.status)) ||
        check.hostingMs === null || check.firestoreMs === null) process.exitCode = 1;
    if (!dryRun) {
      const unavailable = Object.values(snapshot.metrics).some(metric => ['forbidden', 'unavailable'].includes(metric.status));
      await Promise.all([
        unavailable ? Promise.resolve() : db.doc('adminOperations/latest').set(snapshot),
        db.doc('adminOperations/journey').set(journey),
        publishOwnerTelemetry(db, token, snapshot.collectedAt, snapshot.end, monitoring, check),
      ]);
    }
    for (const [key, value] of Object.entries(snapshot.metrics)) {
      console.log(`${key}: ${value.status}${value.http ? ` (HTTP ${value.http}${value.reason ? ` · ${value.reason}` : ''})` : ''}`);
    }
    if (Object.values(snapshot.metrics).some(metric => ['forbidden', 'unavailable'].includes(metric.status))) process.exitCode = 1;
  } finally {
    await deleteApp(app);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const diagnostic = typeof error?.message === 'string' && /^(GitHub|Cloud Monitoring workload) token unavailable \(HTTP [1-5][0-9]{2}\)$/.test(error.message)
      ? error.message : 'Admin operations snapshot could not be published.';
    console.error(diagnostic);
    process.exitCode = 1;
  });
}
