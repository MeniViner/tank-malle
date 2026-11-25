const PROJECT = 'tank-malle';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HOST = 'https://tank-malle.web.app';
const REGISTRY = 'https://data.gov.il/api/3/action/datastore_search?resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3&limit=0';
const COLLECTIONS = ['users', 'userSummaries', 'feedback', 'scanSamples', 'benchmarks', 'costBenchmarks', 'stationPriceAggregates', 'appConfig'];

async function request(url, token) {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function timed(read) {
  const start = performance.now();
  try {
    await read();
    return { ms: Math.max(1, Math.round(performance.now() - start)) };
  }
  catch { return { ms: null }; }
}

export async function probe(db, now) {
  let build = null;
  const [hosting, firestore, registry] = await Promise.all([
    timed(async () => {
      const body = await request(`${HOST}/build-info.json`);
      if (typeof body.version !== 'string' || !/^[a-f0-9]{40}$/.test(body.commit)) throw new Error('Invalid Hosting response.');
      build = { version: body.version.slice(0, 24), commit: body.commit };
    }),
    timed(() => db.doc('appConfig/fuelPrices').get()),
    timed(async () => {
      if ((await request(REGISTRY)).success !== true) throw new Error('Invalid registry response.');
    }),
  ]);
  return { at: now, hostingMs: hosting.ms, firestoreMs: firestore.ms, registryMs: registry.ms, version: build?.version ?? null, commit: build?.commit ?? null };
}

async function percentile(token, end, reducer) {
  const params = new URLSearchParams({
    filter: `project="${PROJECT}" AND metric.type="firestore.googleapis.com/api/request_latencies" AND resource.type="firestore.googleapis.com/Database" AND resource.labels.database_id="(default)"`,
    'interval.startTime': new Date(end - 7 * DAY).toISOString(),
    'interval.endTime': new Date(end).toISOString(),
    'aggregation.alignmentPeriod': '86400s',
    'aggregation.perSeriesAligner': 'ALIGN_SUM',
    'aggregation.crossSeriesReducer': reducer,
    view: 'FULL',
  });
  const result = await request(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?${params}`, token);
  if (result.executionErrors?.length || result.unreachable?.length || result.nextPageToken || result.timeSeries?.length !== 1) return null;
  const days = Array(7).fill(null);
  for (const point of result.timeSeries[0].points ?? []) {
    const index = 6 - Math.round((end - Date.parse(point.interval?.endTime)) / DAY);
    const value = point.value?.doubleValue;
    if (index >= 0 && index < 7 && typeof value === 'number' && Number.isFinite(value) && value >= 0) days[index] = Math.round(value * 1000);
  }
  return days;
}

export async function collectLatency(token, end) {
  try {
    const [p50, p95] = await Promise.all([percentile(token, end, 'REDUCE_PERCENTILE_50'), percentile(token, end, 'REDUCE_PERCENTILE_95')]);
    return p50 && p95 ? { end, p50, p95 } : null;
  } catch { return null; }
}

async function backups(token) {
  try {
    const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}`;
    const database = await request(`${base}/databases/(default)`, token);
    if (!/^[a-z0-9-]+$/.test(database.locationId)) return null;
    const result = await request(`${base}/locations/${database.locationId}/backups?pageSize=100`, token);
    return (result.backups ?? []).filter(row => row.database === database.name)
      .flatMap(row => {
        const at = Date.parse(row.snapshotTime);
        return Number.isFinite(at) ? [{ at, expiresAt: Date.parse(row.expireTime) || null, state: row.state ?? 'STATE_UNSPECIFIED' }] : [];
      })
      .sort((a, b) => b.at - a.at).slice(0, 20);
  } catch { return null; }
}

export async function publishOwnerTelemetry(db, token, now, end, monitoring, check) {
  const [latency, inventory, managedBackups] = await Promise.all([
    monitoring ? collectLatency(monitoring, end) : null,
    Promise.all(COLLECTIONS.map(async name => {
      try { return [name, (await db.collection(name).count().get()).data().count]; }
      catch { return [name, null]; }
    })),
    backups(token),
  ]);
  const ref = db.doc('ownerConsole/telemetry');
  await db.runTransaction(async transaction => {
    const existing = (await transaction.get(ref)).data();
    if ((existing?.checkedAt ?? 0) > now) return;
    const history = Array.isArray(existing?.probes) ? existing.probes : [];
    // A retry within the same scheduled hour replaces the previous sample.
    const probes = history.filter(item => Math.floor(item.at / HOUR) < Math.floor(now / HOUR)).slice(-27);
    transaction.set(ref, {
      version: 1, checkedAt: now, probes: [...probes, check],
      latency: latency ?? existing?.latency ?? null,
      inventory: Object.fromEntries(inventory), backups: managedBackups,
    });
  });
  console.log(`Owner console: Hosting ${check.hostingMs === null ? 'unavailable' : 'ok'}, Firestore ${check.firestoreMs === null ? 'unavailable' : 'ok'}, registry ${check.registryMs === null ? 'unavailable' : 'ok'}, latency ${latency ? 'ok' : 'unavailable'}, backups ${managedBackups ? 'ok' : 'unavailable'}`);
}
